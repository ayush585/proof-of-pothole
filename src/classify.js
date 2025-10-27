// src/classify.js
// OpenCV.js-driven pothole classification with contour-based severity scoring.
// Falls back to a brightness-based heuristic when the WASM runtime is unavailable.

import { USE_CV } from "./classify-config.js";
import { scoreFromFeatures } from "./score.js";

/**
 * Classify an image drawn on a <canvas> using OpenCV (if enabled and available).
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{severity: "MINOR"|"MODERATE"|"CRITICAL", score: number, area_px: number, depth_cm: number|null}>}
 */
export async function classifyImageCV(canvas) {
  try {
    // Hard stub gate for demos/tests
    if (!USE_CV) {
      return { score: 100, severity: "MODERATE", area_px: 0, depth_cm: null };
    }

    // Load OpenCV if a lazy loader exists
    if (typeof window !== "undefined" && typeof window.loadCV === "function") {
      await window.loadCV();
    }

    const cv = typeof window !== "undefined" ? window.cv : undefined;
    if (!cv || !cv.Mat) {
      // WASM not present -> use fallback
      return classifyFallback(canvas);
    }

    // ---- OpenCV pipeline ----
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 40, 120);

    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    const closed = new cv.Mat();
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat(); // unused data but required by API
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let summedArea = 0;
    let largestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > 20) {
        summedArea += area;
        if (area > largestArea) largestArea = area;
      }
      cnt.delete();
    }

    // --- Feature derivation for scorer ---
    const area_px = Math.round(summedArea);

    // cv.mean returns a Scalar-like object; access the first channel robustly
    const meanScalar = cv.mean(gray);
    const meanGray = Array.isArray(meanScalar) ? meanScalar[0] : (meanScalar?.[0] ?? 0);
    const meanDark = 255 - (Number.isFinite(meanGray) ? meanGray : 0); // higher => darker overall

    // number of edge pixels (edges is single-channel 8U after Canny)
    const edgeCount = cv.countNonZero(edges);

    // Optional derived for UI
    const totalPixels = Math.max(1, canvas.width * canvas.height);
    const coverage = Math.min(summedArea / totalPixels, 1);
    const depth_cm = Number((coverage * 25).toFixed(1));

    // --- Score using shared scorer ---
    const { score, severity } = scoreFromFeatures({ area_px, meanDark, edgeCount });

    // TEMP telemetry for quick tuning (remove after demo)
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ area_px, meanDark, edgeCount, score, severity }));

    // ---- Cleanup ----
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    closed.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();

    return { severity, score, area_px, depth_cm };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("OpenCV classification failed, falling back", err);
    return classifyFallback(canvas);
  }
}

/**
 * Brightness heuristic fallback when OpenCV/WASM isn't available.
 * @param {HTMLCanvasElement} canvas
 */
export function classifyFallback(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  let sum = 0;
  let pixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    // average of RGB (ignore alpha)
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += avg;
    pixels++;
  }

  const avgBrightness = sum / (pixels || 1);
  const area_px = Math.round((width * height) / 4);
  const score = Math.round(Math.min(200, 180 - avgBrightness));

  let severity = "MINOR";
  if (score >= 120) severity = "CRITICAL";
  else if (score >= 90) severity = "MODERATE";

  return { severity, score, area_px, depth_cm: null };
}
