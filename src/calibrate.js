// run with: node src/calibrate.js
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { classifyImageCV } from "./classify.js";

const folder = path.resolve("./src/samples");
const out = [];

for (const f of fs.readdirSync(folder)) {
  if (!/\.(jpe?g|png)$/i.test(f)) continue;
  const img = await loadImage(path.join(folder, f));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const result = await classifyImageCV(canvas);
  out.push({ file: f, ...result });
  console.log(f, result);
}

// Write CSV
fs.writeFileSync(
  "./calibration_results.csv",
  "file,area_px,meanDark,edgeCount,score,severity\n" +
  out.map(r => `${r.file},${r.area_px},${r.meanDark},${r.edgeCount},${r.score},${r.severity}`).join("\n")
);
console.log("Saved calibration_results.csv");
