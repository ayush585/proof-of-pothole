import { genEd25519, sha256, bufToBase64url, base64urlToBuf, toBase58, fromBase58 } from "./crypto.js";

const LS_KEY = "pothole.identity.v1";
let cachedIdentity = null;

export async function ensureIdentity() {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      cachedIdentity = await normalizeIdentity(parsed);
      persistIdentity(cachedIdentity);
      return cachedIdentity;
    } catch (err) {
      console.warn("Identity parse failed, regenerating.", err);
    }
  }

  const { publicKey, privateKey } = await genEd25519();
  const recoveryBytes = crypto.getRandomValues(new Uint8Array(32));
  cachedIdentity = await buildIdentity(publicKey, privateKey, recoveryBytes);
  persistIdentity(cachedIdentity);
  return cachedIdentity;
}

export function exportIdentity() {
  if (!cachedIdentity) {
    const stored = localStorage.getItem(LS_KEY);
    return stored || null;
  }
  return JSON.stringify(cachedIdentity);
}

export async function importIdentity(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  cachedIdentity = await normalizeIdentity(parsed);
  persistIdentity(cachedIdentity);
  return cachedIdentity;
}

export async function anonIdFromPubKey(pubRawOrB64) {
  const publicKeyBytes = typeof pubRawOrB64 === "string" ? base64urlToBuf(pubRawOrB64) : pubRawOrB64;
  const hash = await sha256(publicKeyBytes);
  return toBase58(hash);
}

export async function deriveNullifier(dateStr, recoverySecretB58) {
  if (!recoverySecretB58) throw new Error("Missing recovery secret");
  const secretBytes = fromBase58(recoverySecretB58);
  const encoder = new TextEncoder();
  const pieces = [secretBytes, encoder.encode(dateStr), encoder.encode("pothole")];
  const combined = concatUint8(pieces);
  const hash = await sha256(combined);
  return bufToBase64url(hash);
}

function persistIdentity(identity) {
  localStorage.setItem(LS_KEY, JSON.stringify(identity));
}

async function normalizeIdentity(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid identity payload");
  }
  const { publicKey, privateKey, recoverySecret } = raw;
  if (!publicKey || !privateKey || !recoverySecret) {
    throw new Error("Identity missing required fields");
  }
  const identity = {
    version: "1",
    publicKey,
    privateKey,
    recoverySecret,
    anonId: raw.anonId || (await anonIdFromPubKey(publicKey)),
  };
  return identity;
}

async function buildIdentity(pubRaw, privRaw, recoveryBytes) {
  const identity = {
    version: "1",
    publicKey: bufToBase64url(pubRaw),
    privateKey: bufToBase64url(privRaw),
    recoverySecret: toBase58(recoveryBytes),
    anonId: await anonIdFromPubKey(pubRaw),
  };
  return identity;
}

function concatUint8(views) {
  const total = views.reduce((sum, view) => sum + view.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const view of views) {
    out.set(view, offset);
    offset += view.length;
  }
  return out;
}
