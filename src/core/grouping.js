// Temporal clustering: group images by EXIF photo-taken time.
// Default 15 s gap — typical phone shooting cadence for one item.

export function groupByTime(images, thresholdMs = 15000) {
  if (!images.length) return [];
  const sorted = [...images].sort((a, b) => a.capturedAt - b.capturedAt);
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].capturedAt - sorted[i - 1].capturedAt;
    if (dt <= thresholdMs) {
      groups[groups.length - 1].push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }
  return groups;
}
