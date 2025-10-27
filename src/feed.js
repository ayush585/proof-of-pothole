import { listPacks } from "./firebase.js";
import { urlFromCid } from "./ipfs.js";
import { unzipAndVerifyPack } from "./pack.js";
import { initMap, addPin, flyTo } from "./map.js";
import { showToast } from "./utils.js";
import { verifyBytes, base64urlToBuf } from "./crypto.js";
import { DEFAULT_CHANNEL } from "./config.js";

const channelSel = document.getElementById("channel");
const btnRefresh = document.getElementById("btnRefresh");
const tbody = document.querySelector("#packsTable tbody");

const channelOptions = Array.from(new Set([DEFAULT_CHANNEL, "kolkata-south", "kolkata-north", "delhi-cp", "global"]));
populateChannels(channelOptions);

const map = initMap({ zoom: 4 });
const publicKeyCache = new Map();
const globalDedupe = new Set();

await refreshPacks();

btnRefresh?.addEventListener("click", refreshPacks);
channelSel?.addEventListener("change", refreshPacks);

async function refreshPacks() {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;
  try {
    const selected = channelSel?.value;
    const packs = await listPacks(selected || undefined);
    if (!packs.length) {
      tbody.innerHTML = `<tr><td colspan="6">No packs published yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    for (const meta of packs) {
      const tr = document.createElement("tr");
      const when = toDate(meta.createdAt);
      const counts = formatCounts(meta.counts, meta.reportCount);
      tr.innerHTML = `
        <td>${when.toLocaleString()}</td>
        <td>${ellipsis(meta.uploaderId)}</td>
        <td>${meta.channel || "-"}</td>
        <td><a href="${urlFromCid(meta.cid)}" target="_blank" rel="noopener">${ellipsis(meta.cid, 16)}</a></td>
        <td>${counts}</td>
        <td><button type="button" class="btn btn-mini" data-cid="${meta.cid}">Import</button></td>
      `;
      tr.querySelector("button").addEventListener("click", () => importPack(meta));
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error("Failed to load packs", err);
    tbody.innerHTML = `<tr><td colspan="6">Could not load packs. Check console.</td></tr>`;
    showToast("Failed to load feed. Verify Firebase config and network.", 5000);
  }
}

async function importPack(meta) {
  try {
    showToast("Downloading pack...");
    const response = await fetch(urlFromCid(meta.cid));
    if (!response.ok) {
      throw new Error(`IPFS fetch failed (${response.status})`);
    }
    const blob = await response.blob();

    const { pack, packHash, results } = await unzipAndVerifyPack(blob, {
      verifyReportSig: verifyReportSignature,
    });

    if (meta.packHash && meta.packHash !== packHash) {
      showToast("Pack hash mismatch. Proceed with caution.", 5000);
    }

    let added = 0;
    let skipped = 0;
    let firstLatLng = null;

    for (const item of results) {
      const { report } = item;
      const globalKey = `${report.nullifier}:${report.payload?.ts}`;
      const seenBefore = globalDedupe.has(globalKey);

      const accept = item.okSig && item.okImg && !item.duplicate && !seenBefore;
      if (accept) {
        addPin({
          lat: report.payload.lat,
          lng: report.payload.lng,
          severity: report.payload.severity,
          when: report.payload.ts,
        });
        globalDedupe.add(globalKey);
        added += 1;
        if (!firstLatLng) {
          firstLatLng = { lat: report.payload.lat, lng: report.payload.lng };
        }
      } else {
        skipped += 1;
      }
    }

    if (firstLatLng) {
      flyTo(firstLatLng.lat, firstLatLng.lng, 13);
    }

    showToast(`Imported ${added} pins. Skipped ${skipped}.`, 5000);
  } catch (err) {
    console.error("Import failed", err);
    showToast(`Import failed: ${err.message}`, 5000);
  }
}

async function verifyReportSignature(pubkeyB64, sigB64, canonicalBytes) {
  let cached = publicKeyCache.get(pubkeyB64);
  if (!cached) {
    const keyData = base64urlToBuf(pubkeyB64);
    cached = await crypto.subtle.importKey("raw", keyData, { name: "Ed25519" }, true, ["verify"]);
    publicKeyCache.set(pubkeyB64, cached);
  }
  return verifyBytes(cached, sigB64, canonicalBytes);
}

function populateChannels(channels) {
  if (!channelSel) return;
  channelSel.innerHTML = `<option value="">All Channels</option>`;
  for (const channel of channels) {
    if (!channel || channel.startsWith("REPLACE")) continue;
    const option = document.createElement("option");
    option.value = channel;
    option.textContent = channel;
    channelSel.appendChild(option);
  }
  channelSel.value = DEFAULT_CHANNEL || "";
}

function ellipsis(value, max = 12) {
  if (!value) return "-";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function toDate(value) {
  if (!value) return new Date(0);
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date(value);
}

function formatCounts(counts = {}, fallback) {
  const total =
    typeof counts.MINOR === "number" || typeof counts.MODERATE === "number" || typeof counts.CRITICAL === "number"
      ? (counts.MINOR || 0) + (counts.MODERATE || 0) + (counts.CRITICAL || 0)
      : fallback || 0;
  const pieces = [];
  if (counts.MINOR) pieces.push(`MINOR ${counts.MINOR}`);
  if (counts.MODERATE) pieces.push(`MOD ${counts.MODERATE}`);
  if (counts.CRITICAL) pieces.push(`CRIT ${counts.CRITICAL}`);
  return pieces.length ? pieces.join(" / ") : `${total} reports`;
}
