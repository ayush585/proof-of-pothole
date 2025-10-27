export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function showToast(message, duration = 3200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(el._hideTimer);
  el._hideTimer = window.setTimeout(() => {
    el.classList.remove("show");
  }, duration);
}

export function resizeImageToCanvas(file, maxWidth = 720) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const width = Math.round(img.naturalWidth * scale);
      const height = Math.round(img.naturalHeight * scale);
      const canvas = document.getElementById("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

export function dataURLFromCanvas(canvas, quality = 0.85) {
  return canvas.toDataURL("image/jpeg", quality);
}

export function createId(prefix = "r") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}
