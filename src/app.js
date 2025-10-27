import {
  resizeImageToCanvas,
  dataURLFromCanvas,
  dataURLToUint8Array,
  createId,
  showToast,
  formatDateKey,
} from "./utils.js";
import { classifyImage } from "./classify.js";
import { initMap, addPin, flyTo } from "./map.js";
import { exportCSV } from "./csv.js";
import {
  ensureIdentity,
  exportIdentity as exportIdentityJSON,
  importIdentity as importIdentityJSON,
  deriveNullifier,
} from "./id.js";
import { importKeys, signBytes, verifyBytes, sha256, bufToBase64url } from "./crypto.js";
import { canonicalize } from "./canonical.js";
import { buildPackZip } from "./pack.js";
import { putToIPFS } from "./ipfs.js";
import { publishPackMeta } from "./firebase.js";
import { DEFAULT_CHANNEL } from "./config.js";

const inputFile = document.getElementById("file");
const btnLocate = document.getElementById("btnLocate");
const btnClassify = document.getElementById("btnClassify");
const btnExport = document.getElementById("btnExport");
const preview = document.getElementById("preview");
const result = document.getElementById("result");
const tableBody = document.querySelector("#list tbody");

const anonIdEl = document.getElementById("anonId");
const nullifierEl = document.getElementById("nullifierToday");
const copyAnonIdBtn = document.getElementById("copyAnonId");
const exportIdBtn = document.getElementById("exportId");
const importIdBtn = document.getElementById("importId");
const btnPublish = document.getElementById("btnPublish");

const reports = [];
const photoByReportId = new Map();
const current = {
  lat: null,
  lng: null,
  canvas: null,
  photoDataURL: null,
};

let identity = null;
let keys = null;
let identityReady = refreshIdentity();
let isPublishing = false;

initMap();

btnLocate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported on this device.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      current.lat = position.coords.latitude;
      current.lng = position.coords.longitude;
      flyTo(current.lat, current.lng);
      showToast("Location locked.");
    },
    (err) => handleLocationError(err),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
});

inputFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    current.canvas = await resizeImageToCanvas(file, 720);
    const dataUrl = dataURLFromCanvas(current.canvas, 0.9);
    preview.src = dataUrl;
    preview.classList.remove("hidden");
    current.photoDataURL = dataUrl;
    showToast("Photo ready. Add location and classify.");
  } catch (err) {
    console.error("Image resize failed", err);
    showToast("Could not process image. Try another photo.");
  }
});

btnClassify.addEventListener("click", async () => {
  await identityReady;

  if (!identity || !keys) {
    showToast("Identity not ready yet. Please wait a moment.");
    return;
  }
  if (!current.canvas) {
    showToast("Add a photo first.");
    return;
  }
  if (current.lat == null || current.lng == null) {
    showToast('Tap "Use Location" to lock position first.');
    return;
  }

  const classification = classifyImage(current.canvas);
  const photoDataURL = current.photoDataURL || dataURLFromCanvas(current.canvas, 0.9);
  const imageBytes = dataURLToUint8Array(photoDataURL);
  const imageHash = bufToBase64url(await sha256(imageBytes));
  const timestampIso = new Date().toISOString();

  const payload = {
    lat: current.lat,
    lng: current.lng,
    severity: classification.severity,
    score: classification.score,
    area_px: classification.area_px,
    depth_cm: classification.depth_cm,
    ts: timestampIso,
  };
  const media = {
    img_hash: imageHash,
    img_mime: "image/jpeg",
  };

  const nullifier = await deriveNullifier(formatDateKey(), identity.recoverySecret);
  const canonicalBytes = canonicalize({ payload, media });
  const signature = await signBytes(keys.privateKey, canonicalBytes);
  const verified = await verifyBytes(keys.publicKey, signature, canonicalBytes);

  if (!verified) {
    showToast("Signature verification failed.", 4000);
    return;
  }

  const report = {
    id: createId("pot"),
    pubkey: identity.publicKey,
    anonId: identity.anonId,
    nullifier,
    payload,
    media,
    sig: signature,
    photoDataURL,
    verified,
  };

  reports.push(report);
  photoByReportId.set(report.id, photoDataURL);
  updateResultBadge(classification);
  addPin({ lat: payload.lat, lng: payload.lng, severity: payload.severity, when: payload.ts });
  appendReportRow(report);
  showToast("Signed report added to this session.");
});

btnPublish?.addEventListener("click", async () => {
  await identityReady;

  if (!identity) {
    showToast("Identity not ready yet. Please wait a moment.");
    return;
  }
  if (!reports.length) {
    showToast("No signed reports yet.");
    return;
  }
  if (!DEFAULT_CHANNEL || DEFAULT_CHANNEL.startsWith("REPLACE")) {
    showToast("Set DEFAULT_CHANNEL in config.js before publishing.", 5000);
    return;
  }
  if (isPublishing) {
    return;
  }

  isPublishing = true;
  togglePublishButton(true);

  try {
    const { blob, packHash, pack } = await buildPackZip({
      channel: DEFAULT_CHANNEL,
      uploaderId: identity.anonId,
      reports,
      getPhotoByReportId,
    });

    showToast(`Uploading pack to ${DEFAULT_CHANNEL}...`);
    const cid = await putToIPFS(blob, `pothole-pack-${Date.now()}.zip`);

    await publishPackMeta({
      packId: `pack-${Date.now().toString(36)}`,
      channel: DEFAULT_CHANNEL,
      cid,
      packHash,
      reportCount: pack.reportCount ?? reports.length,
      uploaderId: identity.anonId,
    });

    showToast(`Published! CID ${cid.slice(0, 12)}...`, 6000);
  } catch (err) {
    console.error("Publish failed", err);
    showToast(`Publish failed: ${err.message}`, 6000);
  } finally {
    togglePublishButton(false);
    isPublishing = false;
  }
});

btnExport.addEventListener("click", () => {
  if (!reports.length) {
    showToast("No reports yet. Capture and classify first.");
    return;
  }
  exportCSV(reports);
  showToast("Exported potholes.csv");
});

exportIdBtn.addEventListener("click", async () => {
  await identityReady;
  const raw = exportIdentityJSON();
  if (!raw) {
    showToast("No identity available to export.");
    return;
  }
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch (err) {
    // keep raw string if parsing fails
    console.warn("Identity stringify failed", err);
  }
  downloadFile("identity.json", pretty, "application/json");
  showToast("Identity exported.");
});

importIdBtn.addEventListener("click", () => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "application/json";
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importIdentityJSON(text);
      identityReady = refreshIdentity();
      await identityReady;
      showToast("Identity imported.");
    } catch (err) {
      console.error("Identity import failed", err);
      showToast("Import failed. Check the identity file and try again.", 4000);
    }
  });
  picker.click();
});

copyAnonIdBtn.addEventListener("click", async () => {
  await identityReady;
  if (!identity) return;
  const copied = await copyText(identity.anonId);
  if (copied) {
    showToast("Anon ID copied.");
  } else {
    showToast("Copy not supported in this browser.", 4000);
  }
});

function updateResultBadge({ severity, score }) {
  result.className = `badge ${severity.toLowerCase()}`;
  result.textContent = `${severity} (score ${score})`;
}

function appendReportRow(report) {
  const indicatorClass = report.verified ? "sig-ok" : "sig-fail";
  const indicatorIcon = report.verified ? "&#10003;" : "&#10007;";
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><img src="${report.photoDataURL}" alt="Pothole thumbnail"/></td>
    <td>${report.payload.severity}<span class="sig-indicator ${indicatorClass}" title="${
    report.verified ? "Signature verified" : "Signature failed"
  }">${indicatorIcon}</span></td>
    <td>${report.payload.lat.toFixed(5)}</td>
    <td>${report.payload.lng.toFixed(5)}</td>
    <td>${new Date(report.payload.ts).toLocaleTimeString()}</td>
  `;
  tableBody.prepend(row);
}

function handleLocationError(err) {
  console.warn("Geolocation error", err);
  if (err.code === err.PERMISSION_DENIED) {
    showToast("Location denied. Allow in settings and try again.");
  } else if (err.code === err.POSITION_UNAVAILABLE) {
    showToast("Location unavailable. Move to a clearer area or try again.");
  } else if (err.code === err.TIMEOUT) {
    showToast("Location request timed out. Try again.");
  } else {
    showToast("Could not get location. Try again.");
  }
}

async function refreshIdentity() {
  identity = await ensureIdentity();
  keys = await importKeys(identity);
  await updateIdentityUI();
  return identity;
}

async function updateIdentityUI() {
  if (!identity) {
    anonIdEl.textContent = "--";
    nullifierEl.textContent = "--";
    return;
  }
  anonIdEl.textContent = identity.anonId;
  const nullifier = await deriveNullifier(formatDateKey(), identity.recoverySecret);
  nullifierEl.textContent = nullifier;
}

function downloadFile(name, text, mime = "application/octet-stream") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function togglePublishButton(busy) {
  if (!btnPublish) return;
  btnPublish.disabled = busy;
  btnPublish.textContent = busy ? "Publishing..." : "Publish Pack";
}

function getPhotoByReportId(reportId) {
  return photoByReportId.get(reportId) || null;
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("Clipboard write failed", err);
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    console.warn("Legacy copy failed", err);
    return false;
  }
}
