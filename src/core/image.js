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
  return new Promise(r => requestAnimationFrame(() => r()));
}

export async function fileToJpegDataUrl(file, maxPx, quality) {
  const bmp = await createImageBitmap(file);
  let w = bmp.width, h = bmp.height;
  if (w > maxPx || h > maxPx) {
    if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
    else        { w = Math.round(w * maxPx / h); h = maxPx; }
  }
  const c = 'OffscreenCanvas' in window ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(res => {
    if (c.convertToBlob) c.convertToBlob({ type: 'image/jpeg', quality }).then(res);
    else c.toBlob(res, 'image/jpeg', quality);
  });
  return blobToDataUrl(blob);
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

export async function fileToBase64(file, maxPx, quality) {
  const dataUrl = await fileToJpegDataUrl(file, maxPx, quality);
  return dataUrl.split(',')[1];
}
