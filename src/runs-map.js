import { listCalibrationRuns, fetchCalibrationsByRun } from "./firebase.js";

const runSelect = document.getElementById("runSelect");
const statusEl = document.getElementById("status");
const filtersContainer = document.getElementById("severityFilters");
const counterEl = document.getElementById("counter");

const severityConfig = [
  { key: "LOW", label: "Low", color: "#22c55e" },
  { key: "MOD", label: "Moderate", color: "#f59e0b" },
  { key: "CRIT", label: "Critical", color: "#ef4444" },
];

const DEFAULT_CENTER = [22.5726, 88.3639];
const DEFAULT_ZOOM = 5;

const state = {
  runs: [],
  currentRunId: null,
  rows: [],
  filters: new Set(severityConfig.map((item) => item.key)),
  skippedWithoutLocation: 0,
};

let mapInstance = null;
let markersLayer = null;

init().catch((err) => {
  console.error(err);
  setStatus("Failed to initialise run map.");
});

async function init() {
  initMap();
  buildSeverityFilters();
  setStatus("Loading runs...");
  toggleRunSelect(false);
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
    toggleRunSelect(true);
  }

  runSelect?.addEventListener("change", async (event) => {
    const selected = event.target.value;
    if (!selected || selected === state.currentRunId) {
      return;
    }
    await loadRun(selected);
  });
}

function initMap() {
  mapInstance = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapInstance);

  markersLayer = L.layerGroup().addTo(mapInstance);
  setTimeout(() => {
    mapInstance.invalidateSize();
  }, 50);
}

function buildSeverityFilters() {
  if (!filtersContainer) {
    return;
  }
  filtersContainer.innerHTML = "";
  severityConfig.forEach((item) => {
    const wrapper = document.createElement("label");
    wrapper.className = "filter-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.key;
    checkbox.checked = true;

    const dot = document.createElement("span");
    dot.className = "color-dot";
    dot.style.background = item.color;

    const text = document.createElement("span");
    text.textContent = item.label;

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.filters.add(item.key);
      } else {
        state.filters.delete(item.key);
      }
      renderMarkers();
    });

    wrapper.append(checkbox, dot, text);
    filtersContainer.appendChild(wrapper);
  });
}

async function loadRun(runId) {
  if (!runId) {
    return;
  }
  setStatus(`Loading run ${runId}...`);
  toggleRunSelect(false);
  try {
    const rawRows = await fetchCalibrationsByRun(runId);
    const normalised = rawRows.map(normaliseRow);
    const withCoords = normalised.filter((row) => row.lat != null && row.lng != null);
    state.currentRunId = runId;
    state.rows = withCoords;
    state.skippedWithoutLocation = normalised.length - withCoords.length;
    renderMarkers();
    if (withCoords.length) {
      const skippedText = state.skippedWithoutLocation
        ? ` (${state.skippedWithoutLocation} without location)`
        : "";
      setStatus(`Loaded ${withCoords.length} markers for run ${runId}${skippedText}.`);
      fitToMarkers(withCoords);
    } else {
      const skippedText = state.skippedWithoutLocation
        ? ` ${state.skippedWithoutLocation} entries are missing location data.`
        : "";
      setStatus(`Run ${runId} has no geotagged entries.${skippedText}`);
      resetMapView();
    }
    if (runSelect) {
      runSelect.value = runId;
    }
  } catch (err) {
    console.error(`Failed to load run ${runId}`, err);
    setStatus(`Could not load markers for run ${runId}.`);
    state.rows = [];
    renderMarkers();
  } finally {
    toggleRunSelect(true);
  }
}

function normaliseRow(raw) {
  return {
    id: raw.id,
    file: raw.fileName || "",
    severity: raw.severity || "UNKNOWN",
    score: coerceNumber(raw.score),
    area_px: coerceNumber(raw.area_px),
    lat: coerceNumber(raw.lat),
    lng: coerceNumber(raw.lng),
  };
}

function renderMarkers() {
  if (!markersLayer) {
    return;
  }
  markersLayer.clearLayers();
  const filtered = state.rows.filter((row) =>
    state.filters.size === 0 ? false : state.filters.has(row.severity),
  );

  filtered.forEach((row) => {
    const color = getSeverityColor(row.severity);
    const marker = L.circleMarker([row.lat, row.lng], {
      radius: 9,
      color,
      fillColor: color,
      fillOpacity: 0.4,
      weight: 2,
    });
    const popupLines = [
      row.file ? `<strong>${escapeHtml(row.file)}</strong>` : "<strong>Unnamed file</strong>",
      row.score != null ? `Score: ${formatNumber(row.score, 3)}` : "Score: --",
      row.area_px != null ? `Area px: ${formatNumber(row.area_px, 0)}` : "Area px: --",
    ];
    marker.bindPopup(popupLines.join("<br/>"));
    marker.addTo(markersLayer);
  });

  updateCounter(filtered);
}

function fitToMarkers(rows) {
  if (!mapInstance || !rows.length) {
    return;
  }
  if (rows.length === 1) {
    mapInstance.setView([rows[0].lat, rows[0].lng], 15);
    return;
  }
  const bounds = L.latLngBounds(rows.map((row) => [row.lat, row.lng]));
  mapInstance.fitBounds(bounds.pad(0.12));
}

function resetMapView() {
  if (!mapInstance) {
    return;
  }
  mapInstance.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
}

function updateCounter(filteredRows) {
  if (!counterEl) {
    return;
  }
  const total = filteredRows.length;
  const counts = severityConfig.reduce((acc, item) => {
    acc[item.key] = 0;
    return acc;
  }, {});
  filteredRows.forEach((row) => {
    if (counts[row.severity] != null) {
      counts[row.severity] += 1;
    }
  });
  const parts = [`${total} marker${total === 1 ? "" : "s"}`];
  severityConfig.forEach((item) => {
    const value = counts[item.key] || 0;
    if (filteredRows.length || value) {
      parts.push(`${value} ${item.key}`);
    }
  });
  counterEl.textContent = parts.join(" · ");
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
  runs.forEach((run) => {
    const option = document.createElement("option");
    option.value = run.runId;
    option.textContent = formatRunOption(run);
    runSelect.append(option);
  });
  runSelect.disabled = false;
}

function formatRunOption(run) {
  if (!run.latestTimestamp) {
    return run.runId;
  }
  const date = new Date(run.latestTimestamp);
  if (Number.isNaN(date.getTime())) {
    return run.runId;
  }
  return `${run.runId} (${date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })})`;
}

function toggleRunSelect(enabled) {
  if (!runSelect) {
    return;
  }
  if (!state.runs.length) {
    runSelect.disabled = true;
    return;
  }
  runSelect.disabled = !enabled;
}

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text || "";
  }
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

function getSeverityColor(severity) {
  const entry = severityConfig.find((item) => item.key === severity);
  return entry ? entry.color : "#60a5fa";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function formatNumber(value, fractionDigits = 0) {
  if (value == null) {
    return "--";
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}
