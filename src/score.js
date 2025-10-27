import { THRESHOLDS, WEIGHTS } from "./classify-config.js";

export function scoreFromFeatures({ area_px, meanDark, edgeCount }) {
  const s =
    (area_px * WEIGHTS.area_px) +
    (meanDark * WEIGHTS.meanDark) +
    (edgeCount * WEIGHTS.edgeCount);

  let severity = "LOW";
  if (s > THRESHOLDS.criticalScore) severity = "CRITICAL";
  else if (s >= THRESHOLDS.moderateMin) severity = "MODERATE";

  return { score: Math.round(s), severity };
}