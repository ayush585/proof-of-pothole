// Toggle between stub / real CV quickly
export const USE_CV = true;

// Start values; we'll tune then lock
export const THRESHOLDS = {
  criticalScore: 140,
  moderateMin: 95,
};

// weights for features you already compute in classify.js
export const WEIGHTS = {
  area_px: 0.50,   // footprint
  meanDark: 0.30,  // darkness as depth proxy
  edgeCount: 0.20, // texture / roughness
};
