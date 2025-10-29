import { listCalibrationRuns, fetchCalibrationsByRun } from "./firebase.js";

const runSelect = document.getElementById("runSelect");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadCsv");
const summaryRunId = document.getElementById("summaryRunId");
const summaryDate = document.getElementById("summaryDate");
const summaryTotal = document.getElementById("summaryTotal");
const summarySplit = document.getElementById("summarySplit");
const tableBody = document.getElementById("runsTableBody");
const emptyState = document.getElementById("emptyState");
const pageInfo = document.getElementById("pageInfo");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const barCanvas = document.getElementById("severityBar");
const scatterCanvas = document.getElementById("scatterPlot");

const PAGE_SIZE = 12;
const severityOrder = ["LOW", "MOD", "CRIT"];
const rootStyles = getComputedStyle(document.documentElement);
const severityColors = {
  LOW: rootStyles.getPropertyValue("--accent").trim() || "#22c55e",
  MOD: rootStyles.getPropertyValue("--warn").trim() || "#f59e0b",
  CRIT: rootStyles.getPropertyValue("--crit").trim() || "#ef4444",
  UNKNOWN: "#94a3b8",
};

const state = {
  runs: [],
  currentRunId: null,
  rows: [],
  page: 1,
};

let resizeTimer = null;

init().catch((err) => {
  console.error(err);
  setStatus("Failed to initialise runs view.");
});

async function init() {
  setStatus("Loading runs...");
  toggleControls(false);
  try {
    const runs = await listCalibrationRuns();
    state.runs = runs;
    populateRunSelect(runs);
    if (runs.length) {
      await loadRun(runs[0].runId);
    } else {
      setStatus("No calibration runs found.");
    }
  } catch (err) {
    console.error("Failed to load run list", err);
    setStatus("Could not load runs. Check your Firebase configuration.");
  } finally {
    toggleControls(true);
  }

  runSelect?.addEventListener("change", async (event) => {
    const runId = event.target.value;
    if (!runId || runId === state.currentRunId) {
      return;
    }
    await loadRun(runId);
  });

  downloadBtn?.addEventListener("click", () => {
    if (!state.rows.length) {
      alert("No data available for this run yet.");
      return;
    }
    downloadCsvForCurrentRun();
  });

  prevPageBtn?.addEventListener("click", () => {
    if (state.page <= 1) {
      return;
    }
    state.page -= 1;
    renderTable();
  });

  nextPageBtn?.addEventListener("click", () => {
    const pageCount = getPageCount();
    if (state.page >= pageCount) {
      return;
    }
    state.page += 1;
    renderTable();
  });

  window.addEventListener("resize", () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      renderCharts();
    }, 120);
  });
}

function populateRunSelect(runs) {
  if (!runSelect) {
    return;
  }
  runSelect.innerHTML = "";
  if (!runs.length) {
    const placeholder = document.createElement("option");
    placeholder.textContent = "No runs available";
    placeholder.disabled = true;
    placeholder.selected = true;
    runSelect.appendChild(placeholder);
    runSelect.disabled = true;
    return;
  }
  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.runId;
    option.textContent = formatRunOption(run);
    runSelect.appendChild(option);
  }
  runSelect.disabled = false;
}

function formatRunOption(run) {
  if (!run.latestTimestamp) {
    return run.runId;
  }
  const time = new Date(run.latestTimestamp);
  if (Number.isNaN(time.getTime())) {
    return run.runId;
  }
  return `${run.runId} (${time.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })})`;
}

async function loadRun(runId) {
  if (!runId) {
    return;
  }
  if (runSelect) {
    runSelect.value = runId;
  }
  setStatus(`Loading run ${runId}…`);
  toggleControls(false);
  try {
    const rawRows = await fetchCalibrationsByRun(runId);
    const normalized = rawRows.map(normalizeRow);
    state.currentRunId = runId;
    state.rows = normalized;
    state.page = 1;
    updateSummary();
    renderCharts();
    renderTable();
    updateDownloadState();
    if (normalized.length) {
      setStatus(`Loaded ${normalized.length} entries for run ${runId}.`);
    } else {
      setStatus(`Run ${runId} has no entries yet.`);
    }
  } catch (err) {
    console.error(`Failed to load run ${runId}`, err);
    setStatus(`Could not load data for run ${runId}.`);
    state.rows = [];
    renderTable();
    renderCharts();
    updateDownloadState();
  } finally {
    toggleControls(true);
  }
}

function normalizeRow(raw) {
  const score = coerceNumber(raw.score);
  const area = coerceNumber(raw.area_px);
  const meanDark = coerceNumber(raw.meanDark);
  const edgeCount = coerceNumber(raw.edgeCount);
  const imgW = coerceNumber(raw.img_w);
  const imgH = coerceNumber(raw.img_h);
  const timestamp =
    typeof raw.timestamp === "string"
      ? raw.timestamp
      : typeof raw.timestamp?.toDate === "function"
        ? raw.timestamp.toDate().toISOString()
        : typeof raw.createdAt?.toDate === "function"
          ? raw.createdAt.toDate().toISOString()
          : null;
  const displayTimestamp = timestamp ? formatDisplayDate(timestamp) : "--";
  return {
    id: raw.id,
    file: raw.fileName || "",
    score,
    severity: raw.severity || "UNKNOWN",
    area_px: area,
    meanDark,
    edgeCount,
    img_w: imgW,
    img_h: imgH,
    timestampISO: timestamp,
    timestampDisplay: displayTimestamp,
  };
}

function formatDisplayDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function coerceNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function updateSummary() {
  const runId = state.currentRunId || "--";
  summaryRunId.textContent = runId;
  const rows = state.rows;
  summaryTotal.textContent = rows.length ? rows.length.toLocaleString() : "0";

  const latest = rows.length ? rows[0].timestampISO : null;
  summaryDate.textContent = latest ? formatDisplayDate(latest) : "--";

  const counts = computeSeverityCounts(rows);
  const parts = severityOrder.map((level) => counts[level] || 0);
  summarySplit.textContent = parts.join(" / ");
}

function computeSeverityCounts(rows) {
  return rows.reduce(
    (acc, row) => {
      const key = severityOrder.includes(row.severity) ? row.severity : "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { UNKNOWN: 0 },
  );
}

function renderCharts() {
  renderSeverityBar();
  renderScatter();
}

function renderSeverityBar() {
  if (!barCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas(barCanvas);
  if (!ctx || !width || !height) {
    return;
  }

  const counts = computeSeverityCounts(state.rows);
  const values = severityOrder.map((key) => counts[key] || 0);
  const max = Math.max(...values, 1);
  const padding = 32;
  const chartHeight = height - padding * 2;
  const chartWidth = width - padding * 2;
  const barWidth = chartWidth / (severityOrder.length * 1.6);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;

  // Axes
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(padding, padding);
  ctx.stroke();

  severityOrder.forEach((key, index) => {
    const value = values[index];
    const xBase = padding + index * (chartWidth / severityOrder.length) + (chartWidth / severityOrder.length - barWidth) / 2;
    const barHeight = max ? (value / max) * chartHeight : 0;
    const y = height - padding - barHeight;

    ctx.fillStyle = severityColors[key] || severityColors.UNKNOWN;
    ctx.fillRect(xBase, y, barWidth, barHeight);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(value), xBase + barWidth / 2, y - 6);

    ctx.fillStyle = "#94a3b8";
    ctx.textBaseline = "top";
    ctx.fillText(key, xBase + barWidth / 2, height - padding + 6);
  });
}

function renderScatter() {
  if (!scatterCanvas) {
    return;
  }
  const { ctx, width, height } = prepareCanvas(scatterCanvas);
  if (!ctx || !width || !height) {
    return;
  }

  ctx.clearRect(0, 0, width, height);

  const margin = 40;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin, height - margin);
  ctx.lineTo(width - margin, height - margin);
  ctx.moveTo(margin, height - margin);
  ctx.lineTo(margin, margin);
  ctx.stroke();

  const points = state.rows
    .map((row) => ({
      area: row.area_px,
      score: row.score,
      severity: row.severity,
    }))
    .filter((point) => point.area != null && point.score != null);

  if (!points.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data available for scatter plot", width / 2, height / 2);
    return;
  }

  const xMin = 0;
  const xMax = Math.max(...points.map((point) => point.area)) || 1;
  const yValues = points.map((point) => point.score);
  const yMin = Math.min(...yValues, 0);
  const yMax = Math.max(...yValues) || 1;

  const drawWidth = width - margin * 2;
  const drawHeight = height - margin * 2;

  ctx.strokeStyle = "#1e293b";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 1; i <= 4; i += 1) {
    const y = margin + (drawHeight / 4) * i;
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  points.forEach((point) => {
    const color = severityColors[point.severity] || severityColors.UNKNOWN;
    const xRatio = (point.area - xMin) / (xMax - xMin || 1);
    const yRatio = (point.score - yMin) / (yMax - yMin || 1);
    const x = margin + xRatio * drawWidth;
    const y = height - margin - yRatio * drawHeight;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("area_px", margin + drawWidth / 2, height - margin + 10);
  ctx.save();
  ctx.translate(16, margin + drawHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillText("score", 0, 0);
  ctx.restore();
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return { ctx: null, width: rect.width, height: rect.height };
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { ctx: null, width: rect.width, height: rect.height };
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function renderTable() {
  if (!tableBody) {
    return;
  }
  tableBody.innerHTML = "";
  const rows = state.rows;
  const pageCount = getPageCount();
  if (state.page > pageCount) {
    state.page = pageCount || 1;
  }
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  if (!pageRows.length) {
    emptyState.hidden = false;
  } else {
    emptyState.hidden = true;
    for (const row of pageRows) {
      const tr = document.createElement("tr");
      appendCell(tr, row.file || "--");
      appendCell(tr, formatMetric(row.score, 3));
      appendCell(tr, row.severity || "--");
      appendCell(tr, formatMetric(row.area_px, 0));
      appendCell(tr, formatMetric(row.meanDark, 2));
      appendCell(tr, formatMetric(row.edgeCount, 0));
      appendCell(tr, formatMetric(row.img_w, 0));
      appendCell(tr, formatMetric(row.img_h, 0));
      appendCell(tr, row.timestampDisplay || "--");
      tableBody.appendChild(tr);
    }
  }

  updatePagination(pageCount);
}

function appendCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value;
  row.appendChild(td);
}

function formatMetric(value, fractionDigits = 0) {
  if (value == null) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function updatePagination(pageCount) {
  const count = pageCount || 0;
  pageInfo.textContent = count
    ? `Page ${state.page} / ${count}`
    : "Page 0 / 0";
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = !count || state.page >= count;
}

function getPageCount() {
  if (!state.rows.length) {
    return 0;
  }
  return Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
}

function downloadCsvForCurrentRun() {
  const header = [
    "file",
    "score",
    "severity",
    "area_px",
    "meanDark",
    "edgeCount",
    "img_w",
    "img_h",
    "timestamp",
  ];
  const lines = state.rows.map((row) =>
    header
      .map((key) => {
        switch (key) {
          case "file":
            return row.file ?? "";
          case "score":
            return row.score ?? "";
          case "severity":
            return row.severity ?? "";
          case "area_px":
            return row.area_px ?? "";
          case "meanDark":
            return row.meanDark ?? "";
          case "edgeCount":
            return row.edgeCount ?? "";
          case "img_w":
            return row.img_w ?? "";
          case "img_h":
            return row.img_h ?? "";
          case "timestamp":
            return row.timestampISO ?? "";
          default:
            return "";
        }
      })
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.currentRunId || "calibration_run"}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateDownloadState() {
  if (!downloadBtn) {
    return;
  }
  downloadBtn.disabled = !state.rows.length;
}

function setStatus(text) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text || "";
}

function toggleControls(enabled) {
  if (runSelect) {
    runSelect.disabled = !enabled || !state.runs.length;
  }
  if (downloadBtn) {
    downloadBtn.disabled = !enabled || !state.rows.length;
  }
  if (prevPageBtn) {
    prevPageBtn.disabled = !enabled || state.page <= 1;
  }
  if (nextPageBtn) {
    const pageCount = getPageCount();
    nextPageBtn.disabled = !enabled || pageCount <= 1 || state.page >= pageCount;
  }
}
