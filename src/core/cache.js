// Simple object URL cache for Storage paths.
const MAX = 250;
const map = new Map(); // path -> { url, ts }

export function cacheGet(path) {
  const v = map.get(path);
  if (!v) return null;
  v.ts = Date.now();
  return v.url;
}

export function cacheSet(path, url) {
  map.set(path, { url, ts: Date.now() });
  if (map.size <= MAX) return;
  const entries = Array.from(map.entries()).sort((a, b) => a[1].ts - b[1].ts);
  for (let i = 0; i < Math.max(10, Math.floor(MAX * 0.1)); i++) {
    const [p, v] = entries[i] || [];
    if (!p) continue;
    map.delete(p);
    try { URL.revokeObjectURL(v.url); } catch {}
  }
}

export function cacheClear() {
  for (const v of map.values()) {
    try { URL.revokeObjectURL(v.url); } catch {}
  }
  map.clear();
}

