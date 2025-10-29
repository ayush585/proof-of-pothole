import { computeScore, bucket, SCORE_CFG } from "./score.js";

let readyPromise = null;
let loadPromise = null;

function resolvePath(path) {
  try {
    return new URL(path, import.meta.url).href;
  } catch (err) {
    return path;
  }
}

function loadOpenCV(path) {
  if (loadPromise) {
    return loadPromise;
  }
  const resolved = resolvePath(path);
  loadPromise = new Promise((resolve, reject) => {
    try {
      if (typeof importScripts === "function") {
        importScripts(resolved);
        resolve();
      } else {
        fetch(resolved)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch OpenCV: ${response.status}`);
            }
            return response.text();
          })
          .then((source) => {
            // eslint-disable-next-line no-eval
            (0, eval)(source);
            resolve();
          })
          .catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
  return loadPromise;
}

async function ensureReady(path) {
  if (!readyPromise) {
    readyPromise = loadOpenCV(path).then(
      () => new Promise((resolve, reject) => {
        if (typeof cv === "undefined") {
          reject(new Error("OpenCV not available"));
          return;
        }
        if (cv && cv.Mat) {
          resolve();
          return;
        }
        cv.onRuntimeInitialized = () => resolve();
        setTimeout(() => {
          if (cv && cv.Mat) {
            resolve();
          }
        }, 0);
      }),
    );
  }
  return readyPromise;
}

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};
  if (type === "init") {
    try {
      const { opencvPath } = payload || {};
      await ensureReady(opencvPath);
      postMessage({ type: "ready" });
    } catch (err) {
      postMessage({ type: "error", payload: { stage: "init", message: err.message } });
    }
    return;
  }

  if (type === "classify") {
    const { runId, index, buffer, width, height, dataURL, name } = payload || {};
    try {
      if (!buffer) {
        throw new Error("Missing image buffer");
      }
      if (!readyPromise) {
        throw new Error("Worker not initialized");
      }
      await readyPromise;

      if (typeof OffscreenCanvas === "undefined") {
        throw new Error("OffscreenCanvas not supported");
      }

      const bytes = new Uint8Array(buffer);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const imageData = ctx.getImageData(0, 0, width, height);

      const src = cv.matFromImageData(imageData);
      const gray = new cv.Mat();
      const blur = new cv.Mat();
      const thresh = new cv.Mat();
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
      const morph = new cv.Mat();
      const edges = new cv.Mat();
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();

      try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 5);
        cv.morphologyEx(thresh, morph, cv.MORPH_OPEN, kernel);
        cv.Canny(blur, edges, 80, 160);
        cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let largestArea = 0;
        let largestIndex = -1;
        for (let i = 0; i < contours.size(); i += 1) {
          const contour = contours.get(i);
          const area = cv.contourArea(contour);
          if (area > largestArea) {
            largestArea = area;
            largestIndex = i;
          }
          contour.delete();
        }

        let area_px = Math.round(largestArea);
        let meanDark = 0;
        let edgeCount = 0;

        if (largestIndex >= 0) {
          const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U);
          cv.drawContours(mask, contours, largestIndex, new cv.Scalar(255, 255, 255, 255), -1);
          const mean = cv.mean(gray, mask);
          meanDark = Number((255 - mean[0]).toFixed(2));
          const maskedEdges = new cv.Mat();
          cv.bitwise_and(edges, mask, maskedEdges);
          edgeCount = cv.countNonZero(maskedEdges);
          maskedEdges.delete();
          mask.delete();
        } else {
          area_px = 0;
          meanDark = 0;
          edgeCount = 0;
        }

        const score = computeScore({
          meanDark,
          area_px,
          edgeCount,
          img_w: width,
          img_h: height,
        }, SCORE_CFG);
        const severity = bucket(score, SCORE_CFG);

        postMessage({
          type: "classified",
          payload: {
            runId,
            index,
            name,
            dataURL,
            res: {
              severity,
              score,
              area_px,
              depth_cm: null,
              meanDark,
              edgeCount,
              img_w: width,
              img_h: height,
            },
          },
        });
      } finally {
        src.delete();
        gray.delete();
        blur.delete();
        thresh.delete();
        morph.delete();
        edges.delete();
        kernel.delete();
        contours.delete();
        hierarchy.delete();
      }
    } catch (err) {
      postMessage({ type: "error", payload: { runId, index, message: err.message } });
    }
  }
};
