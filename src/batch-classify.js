/* DevTools usage:
   await window.batchClassify([
     "/samples/1-crack-sun.jpg",
     "/samples/2-shallow-shade.jpg",
     // ...
   ]);
*/
import { scoreFromFeatures } from "../score.js";
import { extractFeatures } from "../classify.js"; // export it if not already

async function classifyURL(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await new Promise(r => { img.onload = r; img.onerror = r; });
  const { area_px, meanDark, edgeCount } = await extractFeatures(img);
  const { score, severity } = scoreFromFeatures({ area_px, meanDark, edgeCount });
  const row = { file: url.split("/").pop(), area_px, meanDark, edgeCount, score, severity };
  console.log(JSON.stringify(row));
  return row;
}

export async function batchClassify(urls) {
  const out = [];
  for (const u of urls) out.push(await classifyURL(u));
  return out;
}
window.batchClassify = batchClassify;
