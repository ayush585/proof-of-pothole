// src/calibrate.worker.js - classic worker + importScripts OpenCV + local scorer (mirrors score.js)
let ready = null;

// Mirror of SCORE_CFG / computeScore / bucket (keep in sync with score.js defaults)
const SCORE_CFG = { w_dark: 0.25, w_area: 0.60, w_edge: 0.15, t_mod: 105, t_crit: 170, normalizeArea: true };

function computeScore(meta, cfg = SCORE_CFG) {
  const meanDark = Number(meta?.meanDark ?? 0);
  const area_px = Number(meta?.area_px ?? 0);
  const edgeCount = Number(meta?.edgeCount ?? 0);
  const img_w = Number(meta?.img_w ?? 720);
  const img_h = Number(meta?.img_h ?? 720);
  const md = Math.max(0, Math.min(meanDark, 180)); // clamp shadows
  let areaTerm;
  if (cfg.normalizeArea) {
    const area_norm = area_px / (img_w * img_h); // 0..1
    areaTerm = Math.log10(1 + area_norm * 1e5) * 100; // ~0..200
  } else {
    areaTerm = Math.log10(1 + area_px / 500) * 100;
  }
  const darkTerm = md;
  const edgeTerm = Math.log10(1 + edgeCount) * 60;
  return Math.round(cfg.w_dark * darkTerm + cfg.w_area * areaTerm + cfg.w_edge * edgeTerm);
}
function bucket(score, cfg = SCORE_CFG) {
  return score > cfg.t_crit ? "CRITICAL" : score > cfg.t_mod ? "MODERATE" : "LOW";
}

self.onmessage = async (e) => {
  const { type, payload } = e.data || {};
  if (type === "init") {
    if (!ready) {
      ready = new Promise((resolve) => {
        try {
          // IMPORTANT: opencv.min.js must exist in /src/
          self.importScripts("./opencv.min.js");
          const cvRef = self.cv;
          if (cvRef && cvRef.Mat) {
            resolve();
            return;
          }
          if (cvRef && typeof cvRef.onRuntimeInitialized === "function") {
            const original = cvRef.onRuntimeInitialized;
            cvRef.onRuntimeInitialized = () => {
              if (typeof original === "function") {
                try {
                  original();
                } catch (err) {
                  // ignore original handler errors
                }
              }
              resolve();
            };
          } else if (cvRef) {
            cvRef.onRuntimeInitialized = resolve;
          } else {
            resolve();
          }
        } catch (err) {
          // Allow fallback even if OpenCV fails
          resolve();
        }
      });
    }
    await ready;
    self.postMessage({ type: "ready" });
    return;
  }

  if (type === "classify") {
    if (!ready) {
      ready = Promise.resolve();
    }
    await ready;
    const { runId, index, bytes, width, height, dataURL, name } = payload || {};

    const cvRef = self.cv;
    // If cv missing, return a neutral LOW result so UI doesn't hang
    if (!cvRef || !cvRef.Mat) {
      const res = { severity: "LOW", score: 80, area_px: 0, depth_cm: null, meanDark: 0, edgeCount: 0 };
      self.postMessage({ type: "classified", payload: { runId, index, name, dataURL, res } });
      return;
    }

    try {
      const cv = cvRef;
      if (typeof OffscreenCanvas === "undefined") {
        const res = { severity: "LOW", score: 80, area_px: 0, depth_cm: null, meanDark: 0, edgeCount: 0 };
        self.postMessage({ type: "classified", payload: { runId, index, name, dataURL, res } });
        return;
      }
      const byteSource = bytes instanceof ArrayBuffer ? bytes : bytes?.buffer;
      if (!byteSource) {
        const res = { severity: "LOW", score: 80, area_px: 0, depth_cm: null, meanDark: 0, edgeCount: 0 };
        self.postMessage({ type: "classified", payload: { runId, index, name, dataURL, res } });
        return;
      }

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const blob = new Blob([byteSource], { type: "image/jpeg" });
      const bmp = await createImageBitmap(blob);
      ctx.drawImage(bmp, 0, 0, width, height);
      if (typeof bmp.close === "function") {
        bmp.close();
      }
      const img = ctx.getImageData(0, 0, width, height);

      const src = cv.matFromImageData(img);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      const thresh = new cv.Mat();
      cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 5);
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      const morph = new cv.Mat();
      cv.morphologyEx(thresh, morph, cv.MORPH_OPEN, kernel);
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const edges = new cv.Mat();
      cv.Canny(blur, edges, 80, 160);

      let maxArea = 0;
      let maxIdx = -1;
      for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        if (area > maxArea) {
          maxArea = area;
          maxIdx = i;
        }
        contour.delete();
      }

      let area_px = 0;
      let meanDark = 0;
      let edgeCount = 0;
      if (maxIdx >= 0) {
        area_px = Math.round(maxArea);
        const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U);
        cv.drawContours(mask, contours, maxIdx, new cv.Scalar(255), -1);
        const mean = cv.mean(gray, mask);
        meanDark = 255 - mean[0];
        const maskedEdges = new cv.Mat();
        cv.bitwise_and(edges, mask, maskedEdges);
        edgeCount = cv.countNonZero(maskedEdges);
        maskedEdges.delete();
        mask.delete();
      }

      const score = computeScore({ meanDark, area_px, edgeCount, img_w: width, img_h: height }, SCORE_CFG);
      const severity = bucket(score, SCORE_CFG);

      [src, gray, blur, thresh, kernel, morph, contours, hierarchy, edges].forEach((mat) => {
        if (mat && typeof mat.delete === "function") {
          mat.delete();
        }
      });

      self.postMessage({
        type: "classified",
        payload: {
          runId,
          index,
          name,
          dataURL,
          res: { severity, score, area_px, depth_cm: null, meanDark, edgeCount, img_w: width, img_h: height },
        },
      });
    } catch (err) {
      self.postMessage({ type: "error", payload: { runId, index, message: err?.message || String(err) } });
    }
  }
};
