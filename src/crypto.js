// Ed25519 helpers, hashing, and lightweight encoders.

const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export async function genEd25519() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  return { publicKey, privateKey };
}

export async function importKeys({ publicKey, privateKey }) {
  const pub = await crypto.subtle.importKey("raw", base64urlToBuf(publicKey), { name: "Ed25519" }, true, ["verify"]);
  const priv = await crypto.subtle.importKey("pkcs8", base64urlToBuf(privateKey), { name: "Ed25519" }, false, ["sign"]);
  return { publicKey: pub, privateKey: priv };
}

export async function signBytes(privateKey, bytes) {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, bytes);
  return bufToBase64url(new Uint8Array(sig));
}

export async function verifyBytes(publicKey, signatureB64, bytes) {
  return crypto.subtle.verify("Ed25519", publicKey, base64urlToBuf(signatureB64), bytes);
}

export async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

export function bufToBase64url(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64urlToBuf(b64url) {
  const normalized = b64url.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = normalized.length % 4 ? 4 - (normalized.length % 4) : 0;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function toBase58(bytes) {
  if (!bytes || !bytes.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      const val = digits[j] * 256 + carry;
      digits[j] = val % 58;
      carry = Math.floor(val / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b === 0) zeros++;
    else break;
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPH[d]).join("");
}

export function fromBase58(str) {
  if (!str) return new Uint8Array(0);
  let value = 0n;
  for (const char of str) {
    const digit = ALPH.indexOf(char);
    if (digit === -1) {
      throw new Error("Invalid base58 character");
    }
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.push(Number(value & 0xffn));
    value >>= 8n;
  }
  bytes.reverse();
  let zeros = 0;
  for (const char of str) {
    if (char === "1") zeros++;
    else break;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) {
    out[i] = 0;
  }
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + i] = bytes[i];
  }
  return out;
}
