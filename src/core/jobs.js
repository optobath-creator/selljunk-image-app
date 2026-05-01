import { fb, storage, db } from './firebase.js';
import { toast } from './toast.js';
import { ensureIdToken, fileToJpegDataUrl, dataUrlToBlob, yieldToUI } from './image.js';
import { extractExifTimestamp } from './exif.js';
import { groupByTime } from './grouping.js';

export class JobQueue {
  constructor({ onProgress }) {
    this.onProgress = onProgress || (() => {});
    this.pending = 0;
    this.total = 0;
  }

  _tick(pending, total) {
    this.pending = pending;
    this.total = total;
    this.onProgress({ pending, total });
  }

  async uploadAndProcess({ uid, files }) {
    const picked = files.slice(0, 100);
    if (files.length > 100) toast('Only first 100 images were added', true);

    await ensureIdToken();
    const steps = picked.length * 3; // preprocess + upload + finalize
    let done = 0;
    this._tick(steps, steps);

    // 1. Preprocess: EXIF + compress
    const prepared = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      const [exifTs, fullDataUrl, thumbDataUrl] = await Promise.all([
        extractExifTimestamp(f),
        fileToJpegDataUrl(f, 1600, 0.82),
        fileToJpegDataUrl(f, 320, 0.70),
      ]);
      const capturedAt = exifTs || f.lastModified || Date.now();
      prepared.push({ file: f, capturedAt, fullDataUrl, thumbDataUrl, filename: f.name });
      done++;
      this._tick(steps - done, steps);
      if ((i + 1) % 3 === 0) await yieldToUI();
    }

    // 2. Upload to Storage (4 concurrent)
    const uploaded = [];
    let idx = 0;
    const worker = async () => {
      while (idx < prepared.length) {
        const cur = prepared[idx++];
        const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const fullPath = `users/${uid}/images/${imgId}.jpg`;
        const thumbPath = `users/${uid}/thumbs/${imgId}.jpg`;
        await Promise.all([
          fb.uploadBytes(fb.sRef(storage, fullPath), dataUrlToBlob(cur.fullDataUrl), { contentType: 'image/jpeg' }),
          fb.uploadBytes(fb.sRef(storage, thumbPath), dataUrlToBlob(cur.thumbDataUrl), { contentType: 'image/jpeg' }),
        ]);
        uploaded.push({
          imgId,
          capturedAt: cur.capturedAt,
          storagePath: fullPath,
          thumbPath,
          filename: cur.filename,
        });
        done++;
        this._tick(steps - done, steps);
        await yieldToUI();
      }
    };
    await Promise.all(Array.from({ length: 4 }, () => worker()));

    // 3. Group by EXIF timestamp
    uploaded.sort((a, b) => a.capturedAt - b.capturedAt);
    const groups = groupByTime(uploaded, 15000);

    // 4. AI sort-check — verify first vs last image in each group (parallel, 3 at a time)
    const verifiedResults = new Array(groups.length).fill(null);
    const checkQueue = groups.map((g, i) => ({ group: g, index: i }));
    const checkWorker = async () => {
      while (checkQueue.length) {
        const item = checkQueue.shift();
        if (!item) break;
        const g = item.group;
        if (g.length <= 1) {
          verifiedResults[item.index] = [g];
          continue;
        }
        // Send first and last thumbnails for AI check
        const first = g[0];
        const last = g[g.length - 1];
        try {
          const [b1, b2] = await Promise.all([first, last].map(async img => {
            const blob = await fb.getBlob(fb.sRef(storage, img.thumbPath));
            const file = new File([blob], 't.jpg', { type: blob.type || 'image/jpeg' });
            const dataUrl = await fileToJpegDataUrl(file, 384, 0.55);
            return dataUrl.split(',')[1];
          }));
          const resp = await fetch('/.netlify/functions/sort-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image1: b1, image2: b2 }),
          });
          const out = await resp.json().catch(() => ({}));
          if (out.same === false && g.length >= 2) {
            const mid = Math.ceil(g.length / 2);
            verifiedResults[item.index] = [g.slice(0, mid), g.slice(mid)];
          } else {
            verifiedResults[item.index] = [g];
          }
        } catch {
          verifiedResults[item.index] = [g]; // fail open
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, () => checkWorker()));
    const verifiedGroups = verifiedResults.flat();

    // 5. Write groups to Firestore + auto-trigger analysis
    const batch = fb.writeBatch(db);
    const now = Date.now();
    const groupIds = [];

    for (let gi = 0; gi < verifiedGroups.length; gi++) {
      const set = verifiedGroups[gi];
      const groupId = 'grp_' + now + '_' + gi + '_' + Math.random().toString(36).slice(2, 7);
      groupIds.push(groupId);
      const imageIds = set.map(x => x.imgId);
      const heroImageIds = imageIds.slice(0, 3);
      const images = {};
      set.forEach(img => {
        images[img.imgId] = {
          storagePath: img.storagePath,
          thumbPath: img.thumbPath,
          capturedAt: img.capturedAt,
          filename: img.filename,
        };
      });
      batch.set(fb.doc(db, 'users', uid, 'groups', groupId), {
        imageIds,
        heroImageIds,
        images,
        state: 'grouped',
        analysis: null,
        createdAt: now + gi,
      });
    }
    await batch.commit();
    done = steps;
    this._tick(0, 0);

    // 6. Auto-analyze each group (parallel, 2 at a time)
    this._autoAnalyze(uid, verifiedGroups, groupIds).catch(e => console.error('Auto-analyze error:', e));
  }

  async _autoAnalyze(uid, groups, groupIds) {
    let i = 0;
    const worker = async () => {
      while (i < groups.length) {
        const ci = i++;
        const set = groups[ci];
        const groupId = groupIds[ci];
        try {
          const heroImgs = set.slice(0, 3);
          const heroB64 = await Promise.all(heroImgs.map(async img => {
            const blob = await fb.getBlob(fb.sRef(storage, img.thumbPath));
            const file = new File([blob], 'h.jpg', { type: blob.type || 'image/jpeg' });
            const dataUrl = await fileToJpegDataUrl(file, 512, 0.65);
            return dataUrl.split(',')[1];
          }));
          const resp = await fetch('/.netlify/functions/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ heroImages: heroB64 }),
          });
          if (resp.ok) {
            const analysis = await resp.json();
            await fb.updateGroup(uid, groupId, { analysis, state: 'analyzed' });
          }
        } catch (e) {
          console.error('Auto-analyze failed for', groupId, e);
        }
      }
    };
    await Promise.all(Array.from({ length: 2 }, () => worker()));
  }

  async deleteGroups({ uid, groups, groupIds }) {
    for (const gid of groupIds) {
      const g = groups.find(x => x.id === gid);
      if (!g) continue;
      // Delete storage files
      const imgs = Object.values(g.images || {});
      const deletes = imgs.flatMap(img => [
        fb.deleteObject(fb.sRef(storage, img.storagePath)).catch(() => {}),
        fb.deleteObject(fb.sRef(storage, img.thumbPath)).catch(() => {}),
      ]);
      await Promise.all(deletes);
      await fb.deleteGroup(uid, gid);
    }
  }

  async removeImages({ uid, group, imageIds }) {
    const remaining = (group.imageIds || []).filter(id => !imageIds.includes(id));
    if (!remaining.length) {
      await this.deleteGroups({ uid, groups: [group], groupIds: [group.id] });
      return;
    }
    const images = { ...group.images };
    for (const id of imageIds) {
      const img = images[id];
      if (img) {
        fb.deleteObject(fb.sRef(storage, img.storagePath)).catch(() => {});
        fb.deleteObject(fb.sRef(storage, img.thumbPath)).catch(() => {});
        delete images[id];
      }
    }
    const heroImageIds = remaining.slice(0, 3);
    await fb.updateGroup(uid, group.id, { imageIds: remaining, heroImageIds, images, analysis: null, state: 'grouped' });
  }

  async mergeGroups({ uid, groups, groupIds }) {
    if (groupIds.length < 2) return;
    const toMerge = groupIds.map(id => groups.find(g => g.id === id)).filter(Boolean);
    if (toMerge.length < 2) return;

    const allImages = {};
    const allIds = [];
    for (const g of toMerge) {
      Object.assign(allImages, g.images || {});
      allIds.push(...(g.imageIds || []));
    }
    // Sort by capturedAt
    allIds.sort((a, b) => (allImages[a]?.capturedAt || 0) - (allImages[b]?.capturedAt || 0));
    const heroImageIds = allIds.slice(0, 3);

    // Keep first group, delete rest
    const keepId = groupIds[0];
    await fb.updateGroup(uid, keepId, {
      imageIds: allIds,
      heroImageIds,
      images: allImages,
      analysis: null,
      state: 'grouped',
    });
    for (let i = 1; i < groupIds.length; i++) {
      await fb.deleteGroup(uid, groupIds[i]);
    }

    // Re-analyze merged group
    const mergedGroup = toMerge[0];
    const set = allIds.map(id => ({ ...allImages[id], imgId: id }));
    this._autoAnalyze(uid, [set], [keepId]).catch(e => console.error('Auto-analyze error:', e));
  }

  async reanalyze({ uid, group }) {
    const set = (group.imageIds || []).map(id => ({
      ...(group.images?.[id] || {}),
      imgId: id,
    }));
    await this._autoAnalyze(uid, [set], [group.id]);
  }
}
