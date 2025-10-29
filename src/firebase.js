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
    createdAt: serverTimestamp(),
  };
  await setDoc(docRef, payload);
  return docRef.id;
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
