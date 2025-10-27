import { resizeImageToCanvas, dataURLFromCanvas, createId, showToast } from "./utils.js";
import { classifyImage } from "./classify.js";
import { initMap, addPin, flyTo } from "./map.js";
import { exportCSV } from "./csv.js";

const inputFile = document.getElementById("file");
const btnLocate = document.getElementById("btnLocate");
const btnClassify = document.getElementById("btnClassify");
const btnExport = document.getElementById("btnExport");
const preview = document.getElementById("preview");
const result = document.getElementById("result");
const canvas = document.getElementById("canvas");
const tableBody = document.querySelector("#list tbody");

const records = [];
const current = {
  lat: null,
  lng: null,
  canvas: null,
};

initMap();

function updateResultBadge({ severity, score }) {
  result.className = `badge ${severity.toLowerCase()}`;
  result.textContent = `${severity} (score ${score})`;
}

function appendRecordRow(record) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><img src="${record.photoDataURL}" alt="Pothole thumbnail"/></td>
    <td>${record.severity}</td>
    <td>${record.lat.toFixed(5)}</td>
    <td>${record.lng.toFixed(5)}</td>
    <td>${new Date(record.createdAt).toLocaleTimeString()}</td>
  `;
  tableBody.prepend(row);
}

function handleLocationSuccess(position) {
  current.lat = position.coords.latitude;
  current.lng = position.coords.longitude;
  showToast("Location locked.");
  flyTo(current.lat, current.lng);
}

function handleLocationError(err) {
  console.warn("Geolocation error", err);
  if (err.code === err.PERMISSION_DENIED) {
    showToast("Location denied. Allow in settings and tap again.");
  } else {
    showToast("Could not get location. Try again.");
  }
}

btnLocate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported on this device.");
    return;
  }

  navigator.geolocation.getCurrentPosition(handleLocationSuccess, handleLocationError, {
    enableHighAccuracy: true,
    timeout: 8000,
    maximumAge: 0,
  });
});

inputFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    current.canvas = await resizeImageToCanvas(file, 720);
    const dataUrl = dataURLFromCanvas(current.canvas, 0.9);
    preview.src = dataUrl;
    preview.classList.remove("hidden");
    showToast("Photo ready. Add location and classify.");
  } catch (err) {
    console.error("Image resize failed", err);
    showToast("Could not process image. Try another photo.");
  }
});

btnClassify.addEventListener("click", () => {
  if (!current.canvas) {
    showToast("Add a photo first.");
    return;
  }
  if (current.lat == null || current.lng == null) {
    showToast('Tap "Use Location" to lock position first.');
    return;
  }

  const classification = classifyImage(current.canvas);
  const photoDataURL = dataURLFromCanvas(current.canvas, 0.9);
  const record = {
    id: createId("pot"),
    severity: classification.severity,
    score: classification.score,
    area_px: classification.area_px,
    depth_cm: classification.depth_cm,
    lat: current.lat,
    lng: current.lng,
    createdAt: new Date().toISOString(),
    photoDataURL,
  };

  records.push(record);
  updateResultBadge(classification);
  addPin({ lat: record.lat, lng: record.lng, severity: record.severity, when: record.createdAt });
  appendRecordRow(record);
  showToast("Report added to this session.");
});

btnExport.addEventListener("click", () => {
  if (!records.length) {
    showToast("No reports yet. Capture and classify first.");
    return;
  }
  exportCSV(records);
  showToast("Exported potholes.csv");
});
