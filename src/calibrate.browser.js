import { classifyImageCV } from "./classify.js";
import { classifyImageCV } from "./classify.js";
import { saveCalibrationResult } from "./firebase.js";

const $ = (selector) => document.querySelector(selector);
const filesInp = $("#files");
const runBtn = $("#run");
const dlBtn = $("#dl");
const grid = $("#grid");
const stats = $("#stats");
const prog = $("#prog");
const work = $("#work");

let rows = [];
let worker = null;
let workerReadyPromise = null;
const runStats = new Map();
const syncQueue = [];
let syncActive = false;

try {
  worker = new Worker("./calibrate.worker.js", { type: "module" });
} catch (err) {
  console.warn("Module worker unavailable", err);
  try {
    worker = new Worker("./calibrate.worker.js");
  } catch (classicErr) {
    console.warn("Fallback worker creation failed", classicErr);
    worker = null;
  }
}

async function ensureWorkerReady() {
  if (!worker) {
    throw new Error("Worker not available");
  }
  if (!workerReadyPromise) {
    workerReadyPromise = new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const { type, payload } = event.data || {};
        if (type === "ready") {
          worker.removeEventListener("message", onMessage);
          resolve();
        }
        if (type === "error" && payload?.stage === "init") {
          worker.removeEventListener("message", onMessage);
          reject(new Error(payload.message || "Worker init failed"));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ type: "init", payload: { opencvPath: "../public/opencv.min.js" } });
    });
  }
  return workerReadyPromise;
}

function registerRun(runId, total) {
  if (!runId) {
    return;
  }
  runStats.set(runId, { total, synced: 0 });
}

function enqueueSync(item) {
  syncQueue.push(item);
  scheduleFlush();
}

function scheduleFlush() {
  if (syncActive) {
    return;
  }
  syncActive = true;
  setTimeout(() => {
    flushSyncQueue().catch((err) => {
      console.warn("Calibration sync batch failed", err);
      syncActive = false;
      if (syncQueue.length) {
        scheduleFlush();
      }
    });
  }, 0);
}

async function flushSyncQueue() {
  while (syncQueue.length) {
    const item = syncQueue.shift();
    try {
      await saveCalibrationResult(item.data);
      const statsEntry = item.runId ? runStats.get(item.runId) : null;
      if (statsEntry) {
        statsEntry.synced += 1;
        console.log(`Synced ${statsEntry.synced}/${statsEntry.total} results to Firebase \u2705`);
        if (statsEntry.synced >= statsEntry.total) {
          runStats.delete(item.runId);
        }
      } else if (item.total) {
        const count = item.index ?? 1;
        console.log(`Synced ${count}/${item.total} results to Firebase \u2705`);
      } else {
        console.log("Synced calibration result to Firebase \u2705");
      }
    } catch (err) {
      console.warn("Calibration sync failed", err);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  syncActive = false;
  if (syncQueue.length) {
    scheduleFlush();
  }
}


runBtn?.addEventListener("click", async () => {
  const files = Array.from(filesInp?.files || []);
  if (!files.length) {
    alert("Select images first");
    return;
  }

  rows = [];
  grid.innerHTML = "";
  stats.textContent = "Preparing...";
  prog.textContent = "";

  if (worker) {
    try {
      await runWithWorker(files);
    } catch (err) {
      console.warn("Worker run failed, falling back", err);
      worker.terminate();
      worker = null;
      workerReadyPromise = null;
      await runOnMainThread(files);
    }
  } else {
    await runOnMainThread(files);
  }

  const counts = rows.reduce((acc, row) => {
    const key = row.severity || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}:${v}`)
    .join("  ");
  stats.textContent = `Done - ${rows.length} images${summary ? ` - ${summary}` : ""}`;
  prog.textContent = "";
});

dlBtn?.addEventListener("click", () => {
  if (!rows.length) {
    alert("Run calibration first");
    return;
  }
  const header = [
    "file",
    "area_px",
    "depth_cm",
    "score",
    "severity",
    "meanDark",
    "edgeCount",
    "img_w",
    "img_h",
  ];
  const lines = rows.map((row) => header.map((key) => row[key] ?? "").join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "calibration_results.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

async function runWithWorker(files) {
  const max = Math.min(files.length, 25);
  const inputs = await Promise.all(files.slice(0, max).map((file) => fileToResizedBytes(file, 640)));
  const total = inputs.length;
  if (!total) {
    return;
  }

  stats.textContent = "Running (worker)...";
  prog.textContent = `(0/${total})`;

  await ensureWorkerReady();

  const runId = `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  registerRun(runId, total);

  try {
    await new Promise((resolve) => {
      let completed = 0;
      const handleMessage = (event) => {
        const { type, payload } = event.data || {};
        if (!payload || payload.runId !== runId) {
          return;
        }
        if (type === "classified") {
          completed += 1;
          prog.textContent = `(${completed}/${total})`;
          if (payload.res) {
            const timestamp = new Date().toISOString();
            addRow(payload.name, payload.dataURL, payload.res, {
              runId,
              total,
              index: completed,
              timestamp,
            });
          }
          if (completed === total) {
            worker.removeEventListener("message", handleMessage);
            resolve();
          }
        } else if (type === "error") {
          completed += 1;
          console.error("Worker classification error", payload.message);
          if (completed === total) {
            worker.removeEventListener("message", handleMessage);
            resolve();
          }
        }
      };

      worker.addEventListener("message", handleMessage);

      inputs.forEach((job, index) => {
        const buffer = job.bytes.buffer;
        worker.postMessage(
          {
            type: "classify",
            payload: {
              runId,
              index,
              width: job.width,
              height: job.height,
              dataURL: job.dataURL,
              name: job.name,
              buffer,
            },
          },
          [buffer],
        );
      });
    });
  } catch (err) {
    runStats.delete(runId);
    throw err;
  }
}

async function runOnMainThread(files) {
  stats.textContent = "Running (main thread)...";
  await window.loadCV?.();

  const max = Math.min(files.length, 15);
  if (!max) {
    return;
  }

  const runId = `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  registerRun(runId, max);

  for (let i = 0; i < max; i += 1) {
    const file = files[i];
    const { canvas, dataURL } = await fileToCanvas(file, 640);
    prog.textContent = `(${i + 1}/${max})`;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const res = await classifyImageCV(canvas);
    const enriched = { ...res, img_w: canvas.width, img_h: canvas.height };
    const timestamp = new Date().toISOString();
    addRow(file.name, dataURL, enriched, {
      runId,
      total: max,
      index: i + 1,
      timestamp,
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
}

function addRow(name, dataURL, res = {}, context = {}) {
  const row = {
    file: name,
    area_px: res.area_px ?? "",
    depth_cm: res.depth_cm ?? "",
    score: res.score ?? "",
    severity: res.severity ?? "",
    meanDark: res.meanDark ?? "",
    edgeCount: res.edgeCount ?? "",
    img_w: res.img_w ?? "",
    img_h: res.img_h ?? "",
  };
  rows.push(row);

  const syncPayload = {
    fileName: name,
    area_px: res.area_px ?? null,
    score: res.score ?? null,
    severity: res.severity ?? null,
    meanDark: res.meanDark ?? null,
    edgeCount: res.edgeCount ?? null,
    img_w: res.img_w ?? null,
    img_h: res.img_h ?? null,
    timestamp: context.timestamp || new Date().toISOString(),
    runId: context.runId || null,
  };

  enqueueSync({
    runId: context.runId || null,
    total: context.total || null,
    index: context.index || null,
    data: syncPayload,
  });

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <img class="thumb" src="${dataURL}" alt="${name}"/>
    <div style="margin-top:6px;font-size:12px">
      <div><b>${name}</b></div>
      <div>Severity: ${row.severity || "-"}</div>
      <div>Score: ${row.score || "-"}</div>
      <div>Area px: ${row.area_px || "-"}</div>
    </div>`;
  grid.appendChild(card);
}

async function fileToResizedBytes(file, maxWidth = 640) {
  const { canvas, dataURL } = await fileToCanvas(file, maxWidth);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) {
        resolve(b);
      } else {
        reject(new Error("Could not create blob"));
      }
    }, "image/jpeg", 0.9);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    width: canvas.width,
    height: canvas.height,
    dataURL,
    name: file.name,
  };
}

function fileToCanvas(file, maxWidth = 640) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const width = Math.round(img.naturalWidth * scale);
      const height = Math.round(img.naturalHeight * scale);
      work.width = width;
      work.height = height;
      const ctx = work.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const dataURL = work.toDataURL("image/jpeg", 0.9);
      URL.revokeObjectURL(url);
      resolve({ canvas: work, dataURL });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
