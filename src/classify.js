// OpenCV.js-driven pothole classification with contour-based severity scoring.
// Falls back to a brightness-based heuristic when the WASM runtime is unavailable.

export async function classifyImageCV(canvas) {
  try {
    if (typeof window.loadCV === "function") {
      await window.loadCV();
    }
    const cv = window.cv;
    if (!cv || !cv.Mat) {
      return classifyFallback(canvas);
    }

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
    const hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let summedArea = 0;
    let largestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > 20) {
        summedArea += area;
        if (area > largestArea) {
          largestArea = area;
        }
      }
      cnt.delete();
    }

    const totalPixels = canvas.width * canvas.height || 1;
    const coverage = Math.min(summedArea / totalPixels, 1);
    const severity = coverage >= 0.07 ? "CRITICAL" : coverage >= 0.03 ? "MODERATE" : "MINOR";
    const score = Math.round(Math.min(200, 60 + coverage * 800 + largestArea / 25));
    const depth_cm = Number((coverage * 25).toFixed(1));
    const area_px = Math.round(summedArea);

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
    console.warn("OpenCV classification failed, falling back", err);
    return classifyFallback(canvas);
  }
}

export function classifyFallback(canvas) {
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

  const avgBrightness = sum / pixels || 1;
  const area_px = Math.round((width * height) / 4);
  const score = Math.round(Math.min(200, 180 - avgBrightness));
  let severity = "MINOR";
  if (score >= 120) {
    severity = "CRITICAL";
  } else if (score >= 90) {
    severity = "MODERATE";
  }

  return { severity, score, area_px, depth_cm: null };
}
