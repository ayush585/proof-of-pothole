import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { sha256, bufToBase64url } from "./crypto.js";
import { canonicalize } from "./canonical.js";
import { dataURLToUint8Array } from "./utils.js";

export async function buildPackZip({ channel, uploaderId, reports, getPhotoByReportId }) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error("No reports to pack.");
  }
  if (typeof getPhotoByReportId !== "function") {
    throw new Error("getPhotoByReportId helper is required.");
  }

  const sanitizedReports = reports.map((report) => sanitizeReport(report));
  const zip = new JSZip();

  for (const report of sanitizedReports) {
    const dataURL = getPhotoByReportId(report.id);
    if (!dataURL) {
      throw new Error(`Missing image data for report ${report.id}`);
    }
    const imageBytes = dataURLToUint8Array(dataURL);
    const imageHash = bufToBase64url(await sha256(imageBytes));
    if (imageHash !== report.media.img_hash) {
      throw new Error(`Image hash mismatch for report ${report.id}`);
    }
    const filename = `images/${report.id}.jpg`;
    report.media.img_filename = filename;
    zip.file(filename, imageBytes);
  }

  const pack = {
    version: "1",
    channel,
    uploaderId,
    createdAt: Date.now(),
    reports: sanitizedReports,
    counts: summarize(sanitizedReports),
    reportCount: sanitizedReports.length,
  };

  zip.file("pack.json", JSON.stringify(pack));

  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const packHash = bufToBase64url(await sha256(zipBytes));
  const blob = new Blob([zipBytes], { type: "application/zip" });

  return { blob, packHash, pack };
}

export async function unzipAndVerifyPack(zipBlob, { verifyReportSig, fetchImageBytesFor } = {}) {
  if (!zipBlob) {
    throw new Error("zipBlob is required");
  }
  if (typeof verifyReportSig !== "function") {
    throw new Error("verifyReportSig function is required");
  }

  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const packHash = bufToBase64url(await sha256(zipBytes));
  const zip = await JSZip.loadAsync(zipBytes);
  const packJson = await zip.file("pack.json")?.async("string");
  if (!packJson) {
    throw new Error("pack.json missing from archive");
  }
  const pack = JSON.parse(packJson);

  const results = [];
  const dedupe = new Set();

  for (const report of pack.reports || []) {
    const canonicalBytes = canonicalize({
      payload: report.payload,
      media: {
        img_hash: report.media?.img_hash,
        img_mime: report.media?.img_mime,
      },
    });

    const okSig = await verifyReportSig(report.pubkey, report.sig, canonicalBytes);

    let imgBytes = null;
    let okImg = false;

    const filename = report.media?.img_filename;
    if (filename && zip.file(filename)) {
      imgBytes = new Uint8Array(await zip.file(filename).async("uint8array"));
    } else if (fetchImageBytesFor) {
      imgBytes = await fetchImageBytesFor(report);
    }

    if (imgBytes) {
      const hash = bufToBase64url(await sha256(imgBytes));
      okImg = hash === report.media?.img_hash;
    }

    const dedupeKey = `${report.nullifier}:${report.payload?.ts}`;
    const duplicate = dedupe.has(dedupeKey);
    if (!duplicate) {
      dedupe.add(dedupeKey);
    }

    results.push({
      report,
      okSig,
      okImg,
      duplicate,
    });
  }

  return { pack, packHash, results };
}

function sanitizeReport(report) {
  if (!report) throw new Error("Report missing");
  const clone = {
    id: report.id,
    pubkey: report.pubkey,
    anonId: report.anonId,
    nullifier: report.nullifier,
    payload: structuredCloneSafe(report.payload),
    media: structuredCloneSafe(report.media),
    sig: report.sig,
  };
  if ("photoDataURL" in clone) {
    delete clone.photoDataURL;
  }
  if ("verified" in clone) {
    delete clone.verified;
  }
  return clone;
}

function structuredCloneSafe(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function summarize(reports) {
  const counts = { MINOR: 0, MODERATE: 0, CRITICAL: 0 };
  for (const report of reports) {
    const severity = report?.payload?.severity;
    if (severity && typeof counts[severity] === "number") {
      counts[severity] += 1;
    }
  }
  return counts;
}
