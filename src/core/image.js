import { fb, auth, storage } from './firebase.js';
import { cacheGet, cacheSet } from './cache.js';

export async function getStorageObjectUrl(path) {
  if (!path) throw new Error('Missing storage path');
  const cached = cacheGet(path);
  if (cached) return cached;
  const blob = await fb.getBlob(fb.sRef(storage, path));
  const url = URL.createObjectURL(blob);
  cacheSet(path, url);
  return url;
}

export function yieldToUI() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export async function fileToJpegDataUrl(file, maxPx, quality) {
  // createImageBitmap path
  const bmp = await createImageBitmap(file);
  let w = bmp.width, h = bmp.height;
  if (w > maxPx || h > maxPx) {
    if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
    else { w = Math.round(w * maxPx / h); h = maxPx; }
  }
  const canvas = 'OffscreenCanvas' in window ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(res => {
    if (canvas.convertToBlob) canvas.convertToBlob({ type: 'image/jpeg', quality }).then(res);
    else canvas.toBlob(res, 'image/jpeg', quality);
  });
  return await blobToDataUrl(blob);
}

export function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read image'));
    r.readAsDataURL(blob);
  });
}

export async function ensureIdToken() {
  if (!auth.currentUser) throw new Error('Not signed in');
  await auth.currentUser.getIdToken?.().catch(() => {});
}

export function dhashFromImageData(imgData, w, h) {
  // imgData is Uint8ClampedArray RGBA at size (w,h). Expect w=9, h=8.
  // Convert to grayscale + compare horizontal adjacents.
  const bits = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i1 = (y * w + x) * 4;
      const i2 = (y * w + x + 1) * 4;
      const g1 = (imgData[i1] * 0.299 + imgData[i1 + 1] * 0.587 + imgData[i1 + 2] * 0.114);
      const g2 = (imgData[i2] * 0.299 + imgData[i2 + 1] * 0.587 + imgData[i2 + 2] * 0.114);
      bits.push(g1 > g2 ? 1 : 0);
    }
  }
  // Pack into hex string length 16 (64 bits)
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const v = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += v.toString(16);
  }
  return hex;
}

export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  const lut = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += lut[x];
  }
  return dist;
}

export async function computeDhashFromFile(file) {
  const bmp = await createImageBitmap(file, { resizeWidth: 9, resizeHeight: 8, resizeQuality: 'low' });
  const canvas = 'OffscreenCanvas' in window ? new OffscreenCanvas(9, 8) : document.createElement('canvas');
  canvas.width = 9; canvas.height = 8;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bmp, 0, 0, 9, 8);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, 9, 8).data;
  return dhashFromImageData(data, 9, 8);
}

