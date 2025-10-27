import { WEB3_STORAGE_TOKEN, IPFS_GATEWAY } from "./config.js";

const UPLOAD_ENDPOINT = "https://api.web3.storage/upload";

function ensureToken() {
  if (!WEB3_STORAGE_TOKEN || WEB3_STORAGE_TOKEN.startsWith("REPLACE")) {
    throw new Error("WEB3_STORAGE_TOKEN missing. Update src/config.js with a valid Web3.Storage token.");
  }
}

export async function putToIPFS(fileBlob, name = "pack.zip") {
  ensureToken();

  const form = new FormData();
  form.append("file", fileBlob, name);

  const response = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEB3_STORAGE_TOKEN}`,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Web3.Storage upload failed");
  }

  const data = await response.json().catch(() => null);
  if (!data?.cid) {
    throw new Error("Web3.Storage response missing CID");
  }
  return data.cid;
}

export function urlFromCid(cid) {
  if (!cid) throw new Error("CID is required");
  const gateway = IPFS_GATEWAY && IPFS_GATEWAY.length ? IPFS_GATEWAY : "https://w3s.link";
  return `${gateway.replace(/\/+$/, "")}/ipfs/${cid}`;
}
