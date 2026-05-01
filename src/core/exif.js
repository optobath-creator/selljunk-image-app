// Lightweight EXIF DateTimeOriginal extractor — reads first 128KB of JPEG only.
// No external dependencies.

export async function extractExifTimestamp(file) {
  try {
    const buf = await file.slice(0, 131072).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null; // not JPEG
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off);
      if (marker === 0xFFE1) return parseApp1(v, off + 4, v.getUint16(off + 2) - 2);
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + v.getUint16(off + 2);
    }
  } catch {}
  return null;
}

function parseApp1(v, start, len) {
  // "Exif\0\0"
  const hdr = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  for (let i = 0; i < 6; i++) if (v.getUint8(start + i) !== hdr[i]) return null;

  const ts = start + 6; // TIFF start
  const le = v.getUint16(ts) === 0x4949;
  if (v.getUint16(ts + 2, le) !== 42) return null;

  const ifd0 = ts + v.getUint32(ts + 4, le);
  // Find ExifIFD pointer (tag 0x8769) in IFD0
  const exifOff = tagVal(v, ts, ifd0, le, 0x8769);

  if (exifOff != null) {
    const exifIfd = ts + exifOff;
    // DateTimeOriginal (0x9003)
    const d1 = tagStr(v, ts, exifIfd, le, 0x9003);
    if (d1) return parseDate(d1);
    // DateTimeDigitized (0x9004)
    const d2 = tagStr(v, ts, exifIfd, le, 0x9004);
    if (d2) return parseDate(d2);
  }

  // Fallback: DateTime (0x0132) from IFD0
  const d3 = tagStr(v, ts, ifd0, le, 0x0132);
  if (d3) return parseDate(d3);
  return null;
}

function tagVal(v, ts, ifd, le, tag) {
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    if (v.getUint16(e, le) === tag) return v.getUint32(e + 8, le);
  }
  return null;
}

function tagStr(v, ts, ifd, le, tag) {
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    if (v.getUint16(e, le) !== tag) continue;
    const type = v.getUint16(e + 2, le);
    const cnt = v.getUint32(e + 4, le);
    if (type !== 2) continue; // ASCII
    const off = cnt <= 4 ? e + 8 : ts + v.getUint32(e + 8, le);
    if (off + cnt > v.byteLength) return null;
    let s = '';
    for (let j = 0; j < cnt - 1; j++) s += String.fromCharCode(v.getUint8(off + j));
    return s;
  }
  return null;
}

function parseDate(str) {
  const m = str.match(/(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
