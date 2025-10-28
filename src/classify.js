// src/classify.js
// OpenCV.js-driven pothole classification with shared scoring logic.
// Falls back to a lighter heuristic when OpenCV is unavailable.

import { USE_CV } from "./classify-config.js";
import { computeScore, bucket, SCORE_CFG } from "./score.js";

const DEPTH_SCALE_CM = 25;

async function ensureCV() {
  if (!USE_CV || typeof window === "undefined") {
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
    (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) ||
    (source && typeof source.getContext === "function" && typeof source.width === "number" && typeof source.height === "number")
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
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 40, 120);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let summedArea = 0;
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area > 20) {
        summedArea += area;
      }
      contour.delete();
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
      img_w: canvas.width,
      img_h: canvas.height,
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
    return {
      area_px: 0,
      meanDark: 0,
      edgeCount: 0,
      coverage: 0,
      depth_cm: null,
      img_w: width,
      img_h: height,
      mode: "fallback",
    };
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
      count += 1;
    }
  }

  if (!count) {
    return {
      area_px: 0,
      meanDark: 0,
      edgeCount: 0,
      coverage: 0,
      depth_cm: null,
      img_w: width,
      img_h: height,
      mode: "fallback",
    };
  }

  const avgBrightness = sum / count;
  const darkness = Math.max(0, 255 - avgBrightness);
  const normalizedDarkness = Math.min(darkness / 255, 1);
  const diffAvg = diffSum / Math.max(count - 1, 1);
  const textureFactor = Math.min(diffAvg / 64, 1);
  const coverage = Math.min(Math.max((normalizedDarkness * 0.7) + (textureFactor * 0.3), 0), 1);
  const area_px = Math.round(coverage * 120);
  const edgeCount = Math.round(diffAvg * 1.2);
  const depth_cm = Number.isFinite(coverage) ? Number((coverage * DEPTH_SCALE_CM).toFixed(1)) : null;

  return {
    area_px,
    meanDark: Math.round(darkness),
    edgeCount,
    coverage,
    depth_cm,
    img_w: width,
    img_h: height,
    mode: "fallback",
  };
}

function evaluateFeatures(features, cfg = SCORE_CFG) {
  const score = computeScore(
    {
      meanDark: features.meanDark,
      area_px: features.area_px,
      edgeCount: features.edgeCount,
      img_w: features.img_w,
      img_h: features.img_h,
    },
    cfg,
  );
  const severity = bucket(score, cfg);
  return { score, severity };
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

function buildResult(features) {
  const { score, severity } = evaluateFeatures(features);
  return {
    severity,
    score,
    area_px: features.area_px,
    depth_cm: features.depth_cm ?? null,
    meanDark: features.meanDark ?? null,
    edgeCount: features.edgeCount ?? null,
    img_w: features.img_w ?? null,
    img_h: features.img_h ?? null,
  };
}

export async function classifyImageCV(canvas) {
  try {
    const features = await extractFeatures(canvas);
    return buildResult(features);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("OpenCV classification failed, falling back", err);
    const fallback = computeFallbackFeatures(canvas);
    return buildResult(fallback);
  }
}

export function classifyFallback(canvas) {
  const features = computeFallbackFeatures(canvas);
  return buildResult(features);
}
