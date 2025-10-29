import {
  resizeImageToCanvas,
  dataURLFromCanvas,
  dataURLToUint8Array,
  createId,
  showToast,
  formatDateKey,
  toast,
  retry,
} from "./utils.js";
import { classifyImageCV } from "./classify.js";
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
import { DEMO, DEMO_FAKE_GPS, DEMO_SAMPLE_CIDS_STORAGE_KEY } from "./demo-config.js";
import "./batch-classify.js";

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
const btnSamplePack = document.getElementById("btnSamplePack");
const sampleButtonDefaultLabel = btnSamplePack?.textContent ?? "Create Sample Pack";

const signedReports = [];
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
let isCreatingSample = false;

initMap();

btnLocate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    if (DEMO) {
      current.lat = DEMO_FAKE_GPS.lat;
      current.lng = DEMO_FAKE_GPS.lng;
      flyTo(current.lat, current.lng);
      showToast("Demo mode: using sample GPS location.");
    } else {
      showToast("Geolocation not supported on this device.");
    }
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
  if ((current.lat == null || current.lng == null) && DEMO) {
    current.lat = DEMO_FAKE_GPS.lat;
    current.lng = DEMO_FAKE_GPS.lng;
    showToast("Demo mode: using sample GPS location.");
    flyTo(current.lat, current.lng);
  }
  if (current.lat == null || current.lng == null) {
    showToast('Tap "Use Location" to lock position first.');
    return;
  }

  const classification = await classifyImageCV(current.canvas);
  const {
    severity,
    score,
    area_px,
    depth_cm,
    meanDark,
    edgeCount,
    img_w,
    img_h,
  } = classification;

  toast(`Classified as ${severity}`);
  const photoDataURL = current.photoDataURL || dataURLFromCanvas(current.canvas, 0.9);
  const imageBytes = dataURLToUint8Array(photoDataURL);
  const imageHash = bufToBase64url(await sha256(imageBytes));
  const timestampIso = new Date().toISOString();

  const payload = {
    lat: current.lat,
    lng: current.lng,
    severity,
    score,
    area_px,
    depth_cm,
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
    metrics: { meanDark, edgeCount, img_w, img_h },
    photoDataURL,
    verified,
  };

  signedReports.push(report);
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
  if (!signedReports.length) {
    toast("No reports to publish", "warn");
    return;
  }
  if (!DEFAULT_CHANNEL || DEFAULT_CHANNEL.startsWith("REPLACE")) {
    toast("Set DEFAULT_CHANNEL in config.js before publishing.", "warn");
    return;
  }
  if (isPublishing || isCreatingSample) {
    showToast("Another pack task is running. Please wait.");
    return;
  }

  isPublishing = true;
  togglePublishButton(true);

  try {
    toast("Building pack...");
    const clone = typeof structuredClone === "function"
      ? structuredClone(signedReports)
      : JSON.parse(JSON.stringify(signedReports));
    if (DEMO) {
      for (const item of clone) {
        if (!item?.payload) continue;
        if (item.payload.lat == null || Number.isNaN(item.payload.lat)) {
          item.payload.lat = DEMO_FAKE_GPS.lat;
        }
        if (item.payload.lng == null || Number.isNaN(item.payload.lng)) {
          item.payload.lng = DEMO_FAKE_GPS.lng;
        }
      }
    }
    const { blob, packHash } = await buildPackZip({
      channel: DEFAULT_CHANNEL,
      uploaderId: identity.anonId,
      reports: clone,
      getPhotoByReportId,
    });

    toast("Uploading to IPFS...");
    const cid = await retry(() => putToIPFS(blob, `pothole-pack-${Date.now()}.zip`));

    toast("Publishing feed entry...");
    const packId = `pack-${Date.now().toString(36)}`;
    await retry(() =>
      publishPackMeta({
        packId,
        channel: DEFAULT_CHANNEL,
        cid,
        packHash,
        reportCount: signedReports.length,
        uploaderId: identity.anonId,
      })
    );

    toast(`Published OK. CID ${cid.slice(0, 8)}...`, "success");
  } catch (err) {
    console.error("Publish failed", err);
    toast(`Publish failed: ${err.message}`, "error");
  } finally {
    togglePublishButton(false);
    isPublishing = false;
  }
});

btnSamplePack?.addEventListener("click", async () => {
  if (isPublishing || isCreatingSample) {
    showToast("Another pack task is running. Please wait.");
    return;
  }
  isCreatingSample = true;
  toggleSampleButton(true);
  try {
    await createSamplePack();
  } catch (err) {
    console.error("Sample pack creation failed", err);
    toast(`Sample pack failed: ${err.message}`, "error");
  } finally {
    isCreatingSample = false;
    toggleSampleButton(false);
  }
});

btnExport.addEventListener("click", () => {
  if (!signedReports.length) {
    showToast("No reports yet. Capture and classify first.");
    return;
  }
  exportCSV(signedReports);
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
  const indicatorText = report.verified ? "OK" : "X";
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><img src="${report.photoDataURL}" alt="Pothole thumbnail"/></td>
    <td>${report.payload.severity}<span class="sig-indicator ${indicatorClass}" title="${
    report.verified ? "Signature verified" : "Signature failed"
  }">${indicatorText}</span></td>
    <td>${report.payload.lat.toFixed(5)}</td>
    <td>${report.payload.lng.toFixed(5)}</td>
    <td>${new Date(report.payload.ts).toLocaleTimeString()}</td>
  `;
  tableBody.prepend(row);
}

function handleLocationError(err) {
  console.warn("Geolocation error", err);
  let message = "Could not get location. Try again.";
  if (err?.code === err?.PERMISSION_DENIED) {
    message = "Location denied. Allow in settings and try again.";
  } else if (err?.code === err?.POSITION_UNAVAILABLE) {
    message = "Location unavailable. Move to a clearer area or try again.";
  } else if (err?.code === err?.TIMEOUT) {
    message = "Location request timed out. Try again.";
  }
  if (DEMO && (current.lat == null || current.lng == null)) {
    current.lat = DEMO_FAKE_GPS.lat;
    current.lng = DEMO_FAKE_GPS.lng;
    flyTo(current.lat, current.lng);
    message = `${message} Using demo GPS location.`;
  }
  showToast(message);
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

function toggleSampleButton(busy) {
  if (!btnSamplePack) {
    return;
  }
  btnSamplePack.disabled = busy;
  btnSamplePack.textContent = busy ? "Creating..." : sampleButtonDefaultLabel;
}

async function createSamplePack() {
  await identityReady;

  if (!identity || !keys) {
    showToast("Identity not ready yet. Please wait a moment.");
    return;
  }

  let reportsSource = signedReports;
  let photoLookup = (id) => photoByReportId.get(id) || null;
  let sampleContext = null;

  if (!reportsSource.length) {
    sampleContext = await synthesizeSampleReports();
    reportsSource = sampleContext.reports;
    photoLookup = (id) => sampleContext.photoMap.get(id) || null;
  }

  if (!reportsSource.length) {
    toast("No reports available for a sample pack yet.", "warn");
    return;
  }

  const reportsClone = typeof structuredClone === "function"
    ? structuredClone(reportsSource)
    : JSON.parse(JSON.stringify(reportsSource));

  const channelValue =
    DEFAULT_CHANNEL && !DEFAULT_CHANNEL.startsWith("REPLACE") ? DEFAULT_CHANNEL : "demo";

  toast("Building sample pack...");
  const { blob } = await buildPackZip({
    channel: channelValue,
    uploaderId: identity.anonId || "demo-user",
    reports: reportsClone,
    getPhotoByReportId: (id) => photoLookup(id),
  });

  toast("Uploading sample pack...");
  const cid = await retry(() => putToIPFS(blob, `sample-pack-${Date.now()}.zip`));
  toast(`Sample pack CID: ${cid}`, "success");

  const copied = await copyText(cid);
  if (copied) {
    showToast("CID copied to clipboard.");
  } else {
    showToast("Sample pack ready. Copy not supported on this device.", 4000);
  }

  if (DEMO) {
    persistDemoSampleCid(cid);
  }

  console.log("[SamplePack] CID", cid);
  return cid;
}

async function synthesizeSampleReports() {
  const baseLat = Number.isFinite(current.lat) ? current.lat : DEMO_FAKE_GPS.lat;
  const baseLng = Number.isFinite(current.lng) ? current.lng : DEMO_FAKE_GPS.lng;
  const timestampBase = Date.now();
  const nullifier = await deriveNullifier(formatDateKey(), identity.recoverySecret);

  const specs = [
    {
      severity: "LOW",
      color: "#22c55e",
      label: "LOW",
      score: 72,
      area_px: 1200,
      meanDark: 28,
      edgeCount: 140,
      depth_cm: 2,
      offsetLat: 0.0002,
      offsetLng: 0.0001,
    },
    {
      severity: "MODERATE",
      color: "#f97316",
      label: "MOD",
      score: 118,
      area_px: 2400,
      meanDark: 74,
      edgeCount: 260,
      depth_cm: 4,
      offsetLat: -0.0001,
      offsetLng: 0.0003,
    },
    {
      severity: "CRITICAL",
      color: "#ef4444",
      label: "CRIT",
      score: 168,
      area_px: 3600,
      meanDark: 126,
      edgeCount: 340,
      depth_cm: 7,
      offsetLat: -0.0003,
      offsetLng: -0.0002,
    },
  ];

  const photoMap = new Map();
  const reports = [];

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const id = createId("sample");
    const dataURL = generateSampleImage(spec.color, spec.label);
    photoMap.set(id, dataURL);

    const imageBytes = dataURLToUint8Array(dataURL);
    const imgHash = bufToBase64url(await sha256(imageBytes));
    const timestampIso = new Date(timestampBase - i * 60_000).toISOString();
    const lat = baseLat + spec.offsetLat;
    const lng = baseLng + spec.offsetLng;

    const payload = {
      lat,
      lng,
      severity: spec.severity,
      score: spec.score,
      area_px: spec.area_px,
      depth_cm: spec.depth_cm,
      ts: timestampIso,
    };

    const media = {
      img_hash: imgHash,
      img_mime: "image/jpeg",
    };

    const canonicalBytes = canonicalize({ payload, media });
    const sig = await signBytes(keys.privateKey, canonicalBytes);
    const verified = await verifyBytes(keys.publicKey, sig, canonicalBytes);

    reports.push({
      id,
      pubkey: identity.publicKey,
      anonId: identity.anonId,
      nullifier,
      payload,
      media,
      sig,
      metrics: {
        meanDark: spec.meanDark,
        edgeCount: spec.edgeCount,
        img_w: 720,
        img_h: 720,
        area_px: spec.area_px,
        score: spec.score,
      },
      photoDataURL: dataURL,
      verified,
    });
  }

  return { reports, photoMap };
}

function generateSampleImage(color, label) {
  const canvas = document.createElement("canvas");
  const width = 360;
  const height = 240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhIVFRUVFRUVFRUVFRUVFRUVFRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGi0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAKgBLAMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAdwH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwB//9k=";
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function persistDemoSampleCid(cid) {
  if (!DEMO || !cid) {
    return;
  }
  try {
    const existingRaw = localStorage.getItem(DEMO_SAMPLE_CIDS_STORAGE_KEY);
    const list = existingRaw ? JSON.parse(existingRaw) : [];
    const buffer = Array.isArray(list) ? list : [];
    if (!buffer.includes(cid)) {
      buffer.unshift(cid);
      localStorage.setItem(
        DEMO_SAMPLE_CIDS_STORAGE_KEY,
        JSON.stringify(buffer.slice(0, 20)),
      );
    }
  } catch (err) {
    console.warn("Failed to persist demo sample CID", err);
  }
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
