import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { urlFromCid } from "./ipfs.js";
import { sha256, bufToBase64url, base64urlToBuf, verifyBytes } from "./crypto.js";
import { canonicalize } from "./canonical.js";
import { initMap, addPin, clearPins, flyTo } from "./map.js";
import { toast } from "./utils.js";
import { DEMO, SAMPLE_CIDS } from "./demo-config.js";

const select = (s) => document.querySelector(s);

const cidInput = select("#cid");
const fetchButton = select("#btnFetch");
const zipInput = select("#zip");
const summaryEl = select("#summary");
const tbody = select("#results tbody");
const demoBanner = select("#demoBanner");
const switchCidLink = select("#switchCid");

const map = initMap({ zoom: 4 });

if (DEMO && demoBanner) {
  demoBanner.hidden = false;
}

fetchButton?.addEventListener("click", async () => {
  const cid = cidInput?.value.trim();
  if (!cid) {
    toast("Paste a CID first", "warn");
    return;
  }
  try {
    toast("Fetching pack...");
    const blob = await fetchAsBlob(urlFromCid(cid));
    await verifyFromBlob(blob);
  } catch (err) {
    console.error(err);
    toast(`CID fetch failed: ${err.message}`, "error");
  }
});

zipInput?.addEventListener("change", async () => {
  const file = zipInput.files?.[0];
  if (!file) return;
  try {
    toast("Loading ZIP...");
    await verifyFromBlob(file);
  } catch (err) {
    console.error(err);
    toast(`ZIP verify failed: ${err.message}`, "error");
  } finally {
    zipInput.value = "";
  }
});

async function fetchAsBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

async function verifyFromBlob(blob) {
  try {
    const zipBytes = new Uint8Array(await blob.arrayBuffer());
    const packHash = bufToBase64url(await sha256(zipBytes));
    const zip = await JSZip.loadAsync(zipBytes);
    const packEntry = zip.file("pack.json");
    if (!packEntry) {
      throw new Error("pack.json missing in archive");
    }
    const pack = JSON.parse(await packEntry.async("string"));

    let packSigOk = null;
    if (pack.packSig && pack.signer) {
      const packCopy = { ...pack };
      delete packCopy.packSig;
      delete packCopy.signer;
      const canonicalPack = canonicalize(packCopy);
      const signerKey = await crypto.subtle.importKey(
        "raw",
        base64urlToBuf(pack.signer),
        { name: "Ed25519" },
        true,
        ["verify"]
      );
      packSigOk = await verifyBytes(signerKey, pack.packSig, canonicalPack);
    }

    const seen = new Set();
    let okSig = 0;
    let okImg = 0;
    let duplicates = 0;
    let firstCoord = null;

    tbody.innerHTML = "";
    clearPins();

    for (const report of pack.reports || []) {
      const canonicalBytes = canonicalize({
        payload: report.payload,
        media: {
          img_hash: report.media?.img_hash,
          img_mime: report.media?.img_mime,
        },
      });

      const publicKey = await crypto.subtle.importKey(
        "raw",
        base64urlToBuf(report.pubkey),
        { name: "Ed25519" },
        true,
        ["verify"]
      );
      const sigOk = await verifyBytes(publicKey, report.sig, canonicalBytes);

      let imgOk = false;
      const filename = report.media?.img_filename;
      if (filename && zip.file(filename)) {
        const bytes = new Uint8Array(await zip.file(filename).async("uint8array"));
        const hash = bufToBase64url(await sha256(bytes));
        imgOk = hash === report.media?.img_hash;
      }

      const dedupeKey = `${report.nullifier}:${report.payload?.ts}`;
      const duplicate = seen.has(dedupeKey);
      if (!duplicate) {
        seen.add(dedupeKey);
      }

      if (sigOk) okSig += 1;
      if (imgOk) okImg += 1;
      if (duplicate) duplicates += 1;

      const { lat, lng, severity, ts } = report.payload;
      const row = document.createElement("tr");
      row.innerHTML = [
        `<td>${report.id}</td>`,
        `<td>${sigOk ? "OK" : "FAIL"}</td>`,
        `<td>${imgOk ? "OK" : "FAIL"}</td>`,
        `<td>${duplicate ? "YES" : "NO"}</td>`,
        `<td>${severity}</td>`,
        `<td>${formatCoord(lat)}</td>`,
        `<td>${formatCoord(lng)}</td>`,
        `<td>${new Date(ts).toLocaleString()}</td>`,
      ].join("");
      tbody.appendChild(row);

      if (sigOk && imgOk && !duplicate) {
        addPin({ lat, lng, severity, when: ts });
        if (!firstCoord) {
          firstCoord = { lat, lng };
        }
      }
    }

    if (firstCoord) {
      flyTo(firstCoord.lat, firstCoord.lng, 14);
    } else {
      clearPins();
    }

    renderSummary({
      pack,
      packHash,
      packSigOk,
      total: pack.reports ? pack.reports.length : 0,
      okSig,
      okImg,
      duplicates,
    });

    toast("Verification complete", "success");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8">Verification failed</td></tr>`;
    summaryEl.innerHTML = "";
    clearPins();
    throw err;
  }
}

function renderSummary({ pack, packHash, packSigOk, total, okSig, okImg, duplicates }) {
  const pieces = [];
  pieces.push(summaryItem("Total", total));
  pieces.push(summaryItem("Signatures OK", okSig));
  pieces.push(summaryItem("Images OK", okImg));
  pieces.push(summaryItem("Duplicates", duplicates));
  pieces.push(summaryItem("Channel", pack.channel || "-"));
  pieces.push(summaryItem("Uploader", pack.uploaderId ? pack.uploaderId.slice(0, 12) : "-"));
  pieces.push(summaryItem("Pack Hash", packHash.slice(0, 18) + "..."));
  const packSigLabel =
    packSigOk === null ? "Not provided" : packSigOk ? "OK" : "FAIL";
  pieces.push(summaryItem("Pack Signature", packSigLabel));
  summaryEl.innerHTML = pieces.join("");
}

function summaryItem(label, value) {
  return `<div class="summary-card"><div class="summary-label">${label}</div><div class="summary-value">${value}</div></div>`;
}

function formatCoord(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toFixed(5);
}
switchCidLink?.addEventListener("click", (event) => {
  event.preventDefault();
  const current = cidInput?.value.trim() || "";
  const next = prompt("Enter IPFS CID to verify", current);
  if (!next) {
    return;
  }
  cidInput.value = next.trim();
  fetchButton?.click();
});

if (DEMO && !getCidFromQuery()) {
  const sample = SAMPLE_CIDS[0];
  if (sample && cidInput) {
    cidInput.value = sample;
    fetchButton?.click();
  }
}

function getCidFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("cid");
}
