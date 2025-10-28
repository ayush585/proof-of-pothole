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

const header = ["file", "area_px", "meanDark", "edgeCount", "img_w", "img_h", "score", "severity"];
const lines = out.map((row) =>
  header
    .map((key) => {
      const value = row[key];
      return value == null ? "" : value;
    })
    .join(","),
);
fs.writeFileSync(
  "./calibration_results.csv", 
  `${header.join(",")}\n${lines.join("\n")}`,
);
console.log("Saved calibration_results.csv");
