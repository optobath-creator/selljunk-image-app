import { fb, storage, db } from './firebase.js';
import { toast } from './toast.js';
import { ensureIdToken, fileToJpegDataUrl, dataUrlToBlob, computeDhashFromFile, yieldToUI } from './image.js';
import { groupHybrid, extractUncertainPairs, applyBoundarySplits } from './grouping.js';

export class JobQueue {
  constructor({ onProgress }) {
    this.onProgress = onProgress || (() => {});
    this.pending = 0;
    this.total = 0;
  }

  _setProgress(pending, total) {
    this.pending = pending;
    this.total = total;
    this.onProgress({ pending, total });
  }

  async uploadAndGroup({ uid, files }) {
    const picked = files.slice(0, 50);
    if (files.length > 50) toast('Only first 50 images were added', true);

    await ensureIdToken();

    // Preprocess (thumb+full + hash). We treat each image as 1 "remaining" unit.
    this._setProgress(picked.length, picked.length);

    const prepared = [];
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      const capturedAt = f.lastModified || Date.now();
      const [fullDataUrl, thumbDataUrl, hash] = await Promise.all([
        fileToJpegDataUrl(f, 1600, 0.82),
        fileToJpegDataUrl(f, 320, 0.70),
        computeDhashFromFile(f),
      ]);
      prepared.push({ file: f, capturedAt, fullDataUrl, thumbDataUrl, hash, filename: f.name });
      if ((i + 1) % 2 === 0) await yieldToUI();
    }

    // Upload concurrency (small to keep UI responsive on mobile)
    const uploaded = [];
    const concurrency = 3;
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
          hash: cur.hash,
        });
        this._setProgress(Math.max(0, this.pending - 1), this.total);
        await yieldToUI();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Group (free pass)
    uploaded.sort((a, b) => a.capturedAt - b.capturedAt);
    const initialGroups = groupHybrid(uploaded);

    // AI assist only on uncertain boundaries
    const uncertainPairs = extractUncertainPairs(initialGroups, 30);
    const splitAfter = new Set(); // imgId after which we split
    for (let i = 0; i < uncertainPairs.length; i++) {
      const p = uncertainPairs[i];
      const a = uploaded.find(x => x.imgId === p.a);
      const b = uploaded.find(x => x.imgId === p.b);
      if (!a || !b) continue;

      // Use cheap compare (small) to decide if same object
      const [ab, bb] = await Promise.all([a, b].map(async img => {
        // We already have thumb uploaded; reuse local thumbDataUrl if possible would be better, but we didn't retain it.
        // Downloading thumb here is still authenticated and small; only done for uncertain pairs.
        const blob = await fb.getBlob(fb.sRef(storage, img.thumbPath));
        const file = new File([blob], 't.jpg', { type: blob.type || 'image/jpeg' });
        const dataUrl = await fileToJpegDataUrl(file, 384, 0.55);
        return dataUrl.split(',')[1];
      }));

      const resp = await fetch('/.netlify/functions/sort-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image1: ab, image2: bb }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!out.same) splitAfter.add(p.a);
      await yieldToUI();
    }

    const finalGroups = splitAfter.size
      ? applyBoundarySplits(uploaded, splitAfter)
      : initialGroups;

    // Persist groups (only paths + metadata; no download URLs)
    const batch = fb.writeBatch(db);
    const now = Date.now();
    finalGroups.forEach((set, gi) => {
      const groupId = 'grp_' + now + '_' + gi + '_' + Math.random().toString(36).slice(2, 7);
      const imageIds = set.map(x => x.imgId);
      const heroImageIds = imageIds.slice(0, 3);
      const images = {};
      set.forEach(img => {
        images[img.imgId] = {
          storagePath: img.storagePath,
          thumbPath: img.thumbPath,
          capturedAt: img.capturedAt,
          filename: img.filename,
          hash: img.hash,
        };
      });
      batch.set(fb.doc(db, 'users', uid, 'groups', groupId), {
        imageIds,
        heroImageIds,
        images,
        state: 'grouped',
        analysis: null,
        analysisSig: null,
        createdAt: now + gi,
        updatedAt: now + gi,
      });
    });
    await batch.commit();
  }

  async analyzeGroups({ uid, groups, groupIds, getRepIdsForGroup }) {
    await ensureIdToken();
    // Analyze selected groups individually (never merge across groups)
    for (const groupId of groupIds) {
      const group = groups.find(g => g.id === groupId);
      if (!group) continue;

      const repIds = (getRepIdsForGroup?.(groupId) || []).slice(0, 3);
      const heroIds = repIds.length ? repIds : (group.heroImageIds || []).slice(0, 3);
      if (!heroIds.length) continue;

      // Cache signature to avoid reruns
      const sig = heroIds.join('|') + '::' + (heroIds.map(id => group.images?.[id]?.hash || '').join(','));
      if (group.analysisSig && group.analysisSig === sig && group.analysis) continue;

      await fb.setGroup(uid, groupId, { state: 'grouped', updatedAt: Date.now() });

      const heroImgs = heroIds.map(id => group.images?.[id]).filter(Boolean);
      const heroBase64 = [];
      for (const img of heroImgs) {
        const blob = await fb.getBlob(fb.sRef(storage, img.storagePath));
        const file = new File([blob], 'x.jpg', { type: blob.type || 'image/jpeg' });
        const dataUrl = await fileToJpegDataUrl(file, 768, 0.65);
        heroBase64.push(dataUrl.split(',')[1]);
        await yieldToUI();
      }

      const resp = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heroImages: heroBase64 }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        toast(errData.error || `Analyze failed (${resp.status})`, true);
        continue;
      }
      const analysis = await resp.json();
      if (analysis.error) {
        toast(analysis.error, true);
        continue;
      }

      await fb.setGroup(uid, groupId, {
        analysis,
        analysisSig: sig,
        state: 'analyzed',
        updatedAt: Date.now(),
      });
      await yieldToUI();
    }
  }

  async deleteGroupsFast({ uid, groups, groupIds }) {
    // Remove docs first (fast). Cleanup storage asynchronously.
    for (const groupId of groupIds) {
      await fb.deleteGroupDoc(uid, groupId).catch(() => {});
    }
    // Fire-and-forget storage cleanup
    setTimeout(async () => {
      for (const groupId of groupIds) {
        const group = groups.find(g => g.id === groupId);
        if (!group) continue;
        const imgs = Object.values(group.images || {});
        await Promise.all(imgs.flatMap(img => [
          img.storagePath ? fb.deleteObject(fb.sRef(storage, img.storagePath)).catch(() => {}) : null,
          img.thumbPath ? fb.deleteObject(fb.sRef(storage, img.thumbPath)).catch(() => {}) : null,
        ]).filter(Boolean));
      }
    }, 0);
  }
}

