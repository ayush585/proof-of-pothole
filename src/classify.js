// TODO: Integrate OpenCV.js pipeline in next milestone.
// Hook ideas:
//  1. cv.imread(canvas) to Mat
//  2. Pre-process (grayscale, blur, edge detection)
//  3. Contour detection for pothole area + depth estimation heuristics
//  4. Return derived metrics alongside severity buckets

const SEVERITY_THRESHOLDS = {
  MODERATE: 80,
  CRITICAL: 120,
};

export function classifyImage(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let sum = 0;
  let pixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += avg;
    pixels++;
  }

  const avgBrightness = sum / pixels; // 0..255
  const area_px = Math.round((width * height) / 3); // placeholder for pothole pixel coverage
  const score = Math.round(200 - avgBrightness); // darker photo => higher severity

  let severity = "MINOR";
  if (score > SEVERITY_THRESHOLDS.CRITICAL) {
    severity = "CRITICAL";
  } else if (score > SEVERITY_THRESHOLDS.MODERATE) {
    severity = "MODERATE";
  }

  return { severity, score, area_px, depth_cm: null };
}
