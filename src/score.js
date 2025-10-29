// src/score.js
// One source of truth for pothole scoring & thresholds.
// Defaults tuned from first calibration pass; adjust only here.

export const SCORE_CFG = {
  w_dark: 0.35,   // darkness / shadow weight (down-weighted to avoid shadow bias)
  w_area: 0.50,   // area weight (up-weighted so big holes matter)
  w_edge: 0.15,   // texture/fracture weight
  t_mod: 85,      // MODERATE threshold (was 95)
  t_crit: 130,    // CRITICAL threshold (was 140)
  normalizeArea: true,  // normalize by frame size to be zoom-robust
};

// Compute the composite score from raw metrics.
// meta = { meanDark, area_px, edgeCount, img_w, img_h }
export function computeScore(meta, cfg = SCORE_CFG) {
  const meanDark = Number(meta?.meanDark ?? 0);
  const area_px = Number(meta?.area_px ?? 0);
  const edgeCount = Number(meta?.edgeCount ?? 0);
  const img_w = Number(meta?.img_w ?? 720);
  const img_h = Number(meta?.img_h ?? 720);

  // Normalize area if requested
  let areaTerm;
  if (cfg.normalizeArea) {
    const areaNorm = img_w > 0 && img_h > 0 ? area_px / (img_w * img_h) : 0;
    areaTerm = Math.log10(1 + areaNorm * 1e5) * 100;
  } else {
    areaTerm = Math.log10(1 + area_px / 500) * 100;
  }

  const darkTerm = meanDark;
  const edgeTerm = Math.log10(1 + edgeCount) * 60;

  return Math.round(cfg.w_dark * darkTerm + cfg.w_area * areaTerm + cfg.w_edge * edgeTerm);
}

export function bucket(score, cfg = SCORE_CFG) {
  if (score > cfg.t_crit) return "CRITICAL";
  if (score > cfg.t_mod) return "MODERATE";
  return "LOW";
}
