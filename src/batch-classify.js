/* DevTools usage:
   await window.batchClassify([
     "/samples/1-crack-sun.jpg",
     "/samples/2-shallow-shade.jpg",
     // ...
   ]);
*/
import { computeScore, bucket, SCORE_CFG } from "./score.js";
import { extractFeatures } from "./classify.js";

function evaluate(features) {
  const score = computeScore({
    meanDark: features.meanDark,
    area_px: features.area_px,
    edgeCount: features.edgeCount,
    img_w: features.img_w,
    img_h: features.img_h,
  }, SCORE_CFG);
  const severity = bucket(score, SCORE_CFG);
  return { score, severity };
}

async function classifyURL(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  });
  const features = await extractFeatures(img);
  const { score, severity } = evaluate(features);
  const row = {
    file: url.split("/").pop(),
    mode: features.mode,
    area_px: features.area_px,
    meanDark: features.meanDark,
    edgeCount: features.edgeCount,
    img_w: features.img_w,
    img_h: features.img_h,
    depth_cm: features.depth_cm ?? null,
    score,
    severity,
  };
  console.log(JSON.stringify(row));
  return row;
}

export async function batchClassify(urls) {
  const out = [];
  for (const u of urls) {
    out.push(await classifyURL(u));
  }
  return out;
}

window.batchClassify = batchClassify;
