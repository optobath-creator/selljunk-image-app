import { hammingHex } from './image.js';

export function groupHybrid(images, { timeThresholdMs = 12000, sureHash = 10, unsureHash = 18 } = {}) {
  // images: [{imgId, capturedAt, hash, ...}]
  if (!images.length) return [];
  const sorted = [...images].sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = Math.abs((cur.capturedAt || 0) - (prev.capturedAt || 0));
    const hd = prev.hash && cur.hash ? hammingHex(prev.hash, cur.hash) : 999;

    const definitelySame = (dt <= timeThresholdMs && hd <= sureHash);
    const definitelyDifferent = (dt > timeThresholdMs * 2) || (hd >= 32);
    const borderline = !definitelySame && !definitelyDifferent && (dt <= timeThresholdMs * 2) && (hd <= unsureHash);

    if (definitelySame) groups[groups.length - 1].push(cur);
    else if (borderline) {
      // mark boundary for optional AI; place in same group for now but tagged
      cur._maybeBoundary = { from: prev.imgId, hd, dt };
      groups[groups.length - 1].push(cur);
    } else {
      groups.push([cur]);
    }
  }
  return groups;
}

export function extractUncertainPairs(groups, maxPairs = 30) {
  // Return consecutive pairs where _maybeBoundary exists (those are candidates to split)
  const pairs = [];
  for (const g of groups) {
    for (const img of g) {
      if (img._maybeBoundary?.from) {
        pairs.push({ a: img._maybeBoundary.from, b: img.imgId, score: img._maybeBoundary.hd, dt: img._maybeBoundary.dt });
      }
    }
  }
  // prioritize larger hash distance (more likely different), but still uncertain
  pairs.sort((p1, p2) => (p2.score - p1.score) || (p2.dt - p1.dt));
  return pairs.slice(0, maxPairs);
}

export function applyBoundarySplits(imagesSorted, splitAfterSet) {
  // imagesSorted: array of images in order; splitAfterSet contains imgId (the "a") after which to split
  const out = [];
  let cur = [];
  for (let i = 0; i < imagesSorted.length; i++) {
    cur.push(imagesSorted[i]);
    const id = imagesSorted[i].imgId;
    if (splitAfterSet.has(id)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

