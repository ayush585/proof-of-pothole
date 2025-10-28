// src/classify.js
// OpenCV.js-driven pothole classification with contour-based severity scoring.
// Falls back to a brightness-based heuristic when the WASM runtime is unavailable.

import { USE_CV } from "./classify-config.js";
import { scoreFromFeatures } from "./score.js";

const DEPTH_SCALE_CM = 25;

async function ensureCV() {
  if (!USE_CV) {
    return null;
  }
  if (typeof window === "undefined") {
    return null;
  }
  if (typeof window.loadCV === "function") {
    await window.loadCV();
  }
  const cv = window.cv;
  if (!cv || !cv.Mat) {
    return null;
  }
  return cv;
}

function toCanvas(source) {
  if (
    source instanceof HTMLCanvasElement ||
    (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas)
  ) {
    return { canvas: source, cleanup: () => {} };
  }
  if (typeof document === "undefined") {
    throw new Error("Canvas conversion unavailable in this environment.");
  }
  const width = source?.naturalWidth || source?.videoWidth || source?.width || 0;
  const height = source?.naturalHeight || source?.videoHeight || source?.height || 0;
  if (!width || !height) {
    throw new Error("Source element has no drawable dimensions.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to acquire 2D context for feature extraction.");
  }
  ctx.drawImage(source, 0, 0, width, height);
  return {
    canvas,
    cleanup: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

function computeCvFeatures(cv, canvas) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const closed = new cv.Mat();
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat(); // required but unused output

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 40, 120);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let summedArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > 20) {
        summedArea += area;
      }
      cnt.delete();
    }

    const area_px = Math.round(summedArea);
    const meanScalar = cv.mean(gray);
    const meanGray = Array.isArray(meanScalar)
      ? meanScalar[0]
      : (meanScalar?.[0] ?? meanScalar ?? 0);
    const meanDark = 255 - (Number.isFinite(meanGray) ? meanGray : 0);
    const edgeCount = cv.countNonZero(edges);
    const totalPixels = Math.max(1, canvas.width * canvas.height);
    const coverage = Math.min(area_px / totalPixels, 1);
    const depth_cm = Number((coverage * DEPTH_SCALE_CM).toFixed(1));

    return {
      area_px,
      meanDark,
      edgeCount,
      coverage,
      depth_cm,
      mode: "cv",
    };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    closed.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }
}

function computeFallbackFeatures(canvas) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width || 0;
  const height = canvas.height || 0;
  if (!ctx || !width || !height) {
    return { area_px: 0, meanDark: 0, edgeCount: 0, coverage: 0, depth_cm: null, mode: "fallback" };
  }

  const { data } = ctx.getImageData(0, 0, width, height);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  let sum = 0;
  let count = 0;
  let prev = null;
  let diffSum = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const avg = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      sum += avg;
      if (prev !== null) {
        diffSum += Math.abs(avg - prev);
      }
      prev = avg;
      count++;
    }
  }

  if (!count) {
    return { area_px: 0, meanDark: 0, edgeCount: 0, coverage: 0, depth_cm: null, mode: "fallback" };
  }

  const avgBrightness = sum / count;
  const darkness = Math.max(0, 255 - avgBrightness);
  const normalizedDarkness = Math.min(darkness / 255, 1);
  const diffAvg = diffSum / Math.max(count - 1, 1);
  const textureFactor = Math.min(diffAvg / 64, 1);
  const coverage = Math.min(Math.max((normalizedDarkness * 0.7) + (textureFactor * 0.3), 0), 1);
  const area_px = Math.round(coverage * 120);
  const edgeCount = Math.round(diffAvg * 1.2);
  const depth_cm = Number((coverage * DEPTH_SCALE_CM).toFixed(1));

  return {
    area_px,
    meanDark: Math.round(darkness),
    edgeCount,
    coverage,
    depth_cm: Number.isFinite(depth_cm) ? depth_cm : null,
    mode: "fallback",
  };
}

export async function extractFeatures(source) {
  const { canvas, cleanup } = toCanvas(source);
  try {
    if (!USE_CV) {
      return computeFallbackFeatures(canvas);
    }
    const cv = await ensureCV();
    if (cv) {
      return computeCvFeatures(cv, canvas);
    }
    return computeFallbackFeatures(canvas);
  } finally {
    if (cleanup) {
      cleanup();
    }
  }
}

/**
 * Classify an image drawn on a <canvas> using OpenCV (if enabled and available).
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{severity: string, score: number, area_px: number, depth_cm: number|null}>}
 */
export async function classifyImageCV(canvas) {
  if (!USE_CV) {
    return { score: 100, severity: "MODERATE", area_px: 0, depth_cm: null };
  }

  try {
    const features = await extractFeatures(canvas);
    const { score, severity } = scoreFromFeatures(features);

    if (features.mode === "cv") {
      // TEMP telemetry for quick tuning (remove after demo)
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        area_px: features.area_px,
        meanDark: features.meanDark,
        edgeCount: features.edgeCount,
        score,
        severity,
      }));
    }

    return {
      severity,
      score,
      area_px: features.area_px,
      depth_cm: features.depth_cm ?? null,
    };
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
  const features = computeFallbackFeatures(canvas);
  const { score, severity } = scoreFromFeatures(features);
  return {
    severity,
    score,
    area_px: features.area_px,
    depth_cm: features.depth_cm,
  };
}
