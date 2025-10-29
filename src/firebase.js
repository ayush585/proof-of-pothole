import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./config.js";

function ensureConfig() {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.projectId || FIREBASE_CONFIG.projectId === "REPLACE_ME") {
    throw new Error("FIREBASE_CONFIG missing or incomplete. Update src/config.js with your Firebase project details.");
  }
}

let appInstance = null;
let dbInstance = null;

export async function publishPackMeta({ packId, channel, cid, packHash, reportCount, uploaderId }) {
  if (!packId) throw new Error("packId required");
  const db = ensureDb();
  const payload = {
    packId,
    channel,
    cid,
    packHash,
    reportCount,
    uploaderId,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(collection(db, "packs"), packId), payload, { merge: true });
}

export async function listPacks(channel, lim = 50) {
  const db = ensureDb();
  const colRef = collection(db, "packs");
  let q = query(colRef, orderBy("createdAt", "desc"), limit(lim));
  if (channel) {
    q = query(colRef, where("channel", "==", channel), orderBy("createdAt", "desc"), limit(lim));
  }
  const snap = await getDocs(q);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function saveCalibrationResult(record) {
  const db = ensureDb();
  const docRef = doc(collection(db, "calibrations"));
  const payload = {
    fileName: record.fileName ?? null,
    area_px: record.area_px ?? null,
    score: record.score ?? null,
    severity: record.severity ?? null,
    meanDark: record.meanDark ?? null,
    edgeCount: record.edgeCount ?? null,
    img_w: record.img_w ?? null,
    img_h: record.img_h ?? null,
    timestamp: record.timestamp ?? new Date().toISOString(),
    runId: record.runId ?? null,
    lat: record.lat ?? null,
    lng: record.lng ?? null,
    createdAt: serverTimestamp(),
  };
  await setDoc(docRef, payload);
  return docRef.id;
}

export async function listCalibrationRuns(limitCount = 500) {
  const db = ensureDb();
  const colRef = collection(db, "calibrations");
  let snap;
  try {
    snap = await getDocs(query(colRef, orderBy("timestamp", "desc"), limit(limitCount)));
  } catch (err) {
    // Fall back to basic query in case an index is missing.
    snap = await getDocs(query(colRef, limit(limitCount)));
  }
  const runs = new Map();
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const runId = data.runId;
    if (!runId) {
      continue;
    }
    const sortDate = coerceDate(data.timestamp) || coerceDate(data.createdAt);
    const sortValue = sortDate ? sortDate.getTime() : 0;
    const existing = runs.get(runId);
    if (!existing || sortValue > existing.sortValue) {
      runs.set(runId, {
        runId,
        latestTimestamp: sortDate ? sortDate.toISOString() : null,
        sortValue,
      });
    }
  }
  return Array.from(runs.values())
    .sort((a, b) => (b.sortValue || 0) - (a.sortValue || 0))
    .map(({ runId, latestTimestamp }) => ({ runId, latestTimestamp }));
}

export async function fetchCalibrationsByRun(runId, limitCount = 0) {
  if (!runId) {
    throw new Error("runId required");
  }
  const db = ensureDb();
  const colRef = collection(db, "calibrations");
  let snap;
  try {
    const orderedConstraints = [where("runId", "==", runId), orderBy("timestamp", "desc")];
    if (limitCount > 0) {
      orderedConstraints.push(limit(limitCount));
    }
    snap = await getDocs(query(colRef, ...orderedConstraints));
  } catch (err) {
    const fallbackConstraints = [where("runId", "==", runId)];
    if (limitCount > 0) {
      fallbackConstraints.push(limit(limitCount));
    }
    snap = await getDocs(query(colRef, ...fallbackConstraints));
  }
  const items = snap.docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
    };
  });
  items.sort((a, b) => {
    const aDate = coerceDate(a.timestamp) || coerceDate(a.createdAt);
    const bDate = coerceDate(b.timestamp) || coerceDate(b.createdAt);
    const aValue = aDate ? aDate.getTime() : 0;
    const bValue = bDate ? bDate.getTime() : 0;
    return bValue - aValue;
  });
  return items;
}

function ensureDb() {
  if (dbInstance) {
    return dbInstance;
  }
  ensureConfig();
  appInstance = initializeApp(FIREBASE_CONFIG);
  dbInstance = getFirestore(appInstance);
  return dbInstance;
}

function coerceDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  return null;
}
