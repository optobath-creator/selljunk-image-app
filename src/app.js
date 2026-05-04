import { fb, auth, db, storage } from './core/firebase.js';
import { cacheClear } from './core/cache.js';
import { toast } from './core/toast.js';
import { getStorageObjectUrl, fileToJpegDataUrl, dataUrlToBlob, yieldToUI, ensureIdToken } from './core/image.js';
import { $, $$, setHidden } from './ui/dom.js';

/* ── State ─────────────────────────────────────── */
let currentUser = null;
let scans = [];
let scanUnsub = null;

let photos = [];
const MAX_PHOTOS = 5;

/* ── Router ────────────────────────────────────── */
function getRoute() {
  const h = location.hash || '#/';
  if (h.startsWith('#/results')) return 'results';
  return 'scanner';
}

function onRoute() {
  const route = getRoute();
  $('#pageScanner').style.display = route === 'scanner' ? '' : 'none';
  $('#pageResults').style.display = route === 'results' ? '' : 'none';
  $$('.bottomnav__item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === route);
  });
  if (route === 'results') renderResults();
}

window.addEventListener('hashchange', onRoute);

/* ── Auth ──────────────────────────────────────── */
function setAppVisible(visible) {
  const app = $('#app');
  const authScreen = $('#authScreen');
  if (visible) {
    authScreen.style.display = 'none';
    app.style.display = '';
    app.setAttribute('aria-hidden', 'false');
  } else {
    authScreen.style.display = '';
    app.style.display = 'none';
    app.setAttribute('aria-hidden', 'true');
  }
}

$('#googleSignInBtn').onclick = async () => {
  $('#authErr').textContent = '';
  try { await fb.signIn(); }
  catch (e) { $('#authErr').textContent = e?.message || 'Sign-in failed'; }
};

$('#signOutBtn').onclick = async () => {
  if (scanUnsub) { scanUnsub(); scanUnsub = null; }
  await fb.signOut();
};

fb.onAuthStateChanged(user => {
  currentUser = user;
  if (!user) {
    cacheClear();
    scans = [];
    clearPhotos();
    setAppVisible(false);
    return;
  }

  setAppVisible(true);
  const av = $('#userAvatar');
  if (user.photoURL) { av.src = user.photoURL; av.style.display = ''; }
  else av.style.display = 'none';

  startSync();
  onRoute();
});

/* ── Firestore Sync ────────────────────────────── */
function startSync() {
  if (!currentUser) return;
  if (scanUnsub) scanUnsub();
  const q = fb.userScansQuery(currentUser.uid);
  scanUnsub = fb.onScansSnapshot(q, snap => {
    scans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (getRoute() === 'results') renderResults();
    updateProcessingStatus();
  }, err => {
    console.error(err);
    toast('Sync error', true);
  });
}

/* ── Scanner: Photo Management ─────────────────── */
function addPhotos(files) {
  const remaining = MAX_PHOTOS - photos.length;
  if (remaining <= 0) { toast(`Maximum ${MAX_PHOTOS} photos`, true); return; }
  const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
  if (!toAdd.length) return;

  for (const file of toAdd) {
    const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    const dataUrl = URL.createObjectURL(file);
    photos.push({ id, file, dataUrl });
  }
  if (Array.from(files).filter(f => f.type.startsWith('image/')).length > remaining) {
    toast(`Only ${remaining} more photo(s) added`, true);
  }
  renderPreviews();
}

function removePhoto(id) {
  const idx = photos.findIndex(p => p.id === id);
  if (idx >= 0) {
    URL.revokeObjectURL(photos[idx].dataUrl);
    photos.splice(idx, 1);
    renderPreviews();
  }
}

function clearPhotos() {
  photos.forEach(p => URL.revokeObjectURL(p.dataUrl));
  photos = [];
  renderPreviews();
}

function renderPreviews() {
  const container = $('#photoPreviews');
  const thumbs = $('#photoThumbs');
  const count = $('#photoCount');
  const submitBtn = $('#submitBtn');

  if (!photos.length) {
    container.setAttribute('aria-hidden', 'true');
    submitBtn.setAttribute('aria-hidden', 'true');
    return;
  }

  container.setAttribute('aria-hidden', 'false');
  submitBtn.setAttribute('aria-hidden', 'false');
  count.textContent = `${photos.length}/${MAX_PHOTOS} photos`;

  thumbs.innerHTML = '';
  for (const p of photos) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    wrap.innerHTML = `<img src="${p.dataUrl}" alt="" /><button class="thumb__remove" data-id="${p.id}" type="button" aria-label="Remove">\u00d7</button>`;
    thumbs.appendChild(wrap);
  }
}

/* ── Scanner: Input Handlers ───────────────────── */
$('#snapBtn').onclick = () => {
  if (photos.length >= MAX_PHOTOS) { toast(`Maximum ${MAX_PHOTOS} photos`, true); return; }
  $('#cameraInput').click();
};
$('#cameraInput').onchange = (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) addPhotos(files);
};

const uploadZone = $('#uploadZone');
uploadZone.onclick = () => {
  if (photos.length >= MAX_PHOTOS) { toast(`Maximum ${MAX_PHOTOS} photos`, true); return; }
  $('#fileInput').click();
};
uploadZone.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); uploadZone.click(); }
};
$('#fileInput').onchange = (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) addPhotos(files);
};

['dragenter', 'dragover'].forEach(ev =>
  uploadZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploadZone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach(ev =>
  uploadZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); uploadZone.classList.remove('dragover'); })
);
uploadZone.addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) addPhotos(files);
});

$('#photoThumbs').addEventListener('click', e => {
  const btn = e.target.closest('.thumb__remove');
  if (btn) removePhoto(btn.dataset.id);
});

$('#clearPhotosBtn').onclick = clearPhotos;

/* ── Scanner: Submit ───────────────────────────── */
$('#submitBtn').onclick = submitForAnalysis;

async function submitForAnalysis() {
  if (!photos.length || !currentUser) return;

  const submitBtn = $('#submitBtn');
  submitBtn.disabled = true;

  const uid = currentUser.uid;
  const scanId = 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const photosCopy = photos.map(p => ({ ...p }));

  try {
    await ensureIdToken();

    await fb.setScan(uid, scanId, {
      status: 'processing',
      imageCount: photosCopy.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      analysis: null,
      images: {},
      imageIds: [],
    });

    // Brief success animation
    submitBtn.classList.add('success');
    submitBtn.textContent = 'Sent!';
    setTimeout(() => {
      submitBtn.classList.remove('success');
      submitBtn.textContent = 'See what it\u2019s worth';
      submitBtn.disabled = false;
    }, 600);

    clearPhotos();
    toast('Analyzing item\u2026');

    processInBackground(scanId, photosCopy, uid);
  } catch (e) {
    console.error(e);
    toast(e?.message || 'Failed to start analysis', true);
    submitBtn.disabled = false;
  }
}

/* ── Background Processing ─────────────────────── */
async function processInBackground(scanId, photoItems, uid) {
  try {
    const heroBase64 = [];
    for (const p of photoItems.slice(0, 3)) {
      const dataUrl = await fileToJpegDataUrl(p.file, 768, 0.65);
      heroBase64.push(dataUrl.split(',')[1]);
      await yieldToUI();
    }

    const [analysis, imageData] = await Promise.all([
      analyzeImages(heroBase64),
      uploadPhotosToStorage(scanId, photoItems, uid),
    ]);

    await fb.setScan(uid, scanId, {
      status: 'complete',
      analysis,
      images: imageData.images,
      imageIds: imageData.imageIds,
      updatedAt: Date.now(),
    });

    toast('Analysis complete!');
  } catch (err) {
    console.error('Processing error:', err);
    await fb.setScan(uid, scanId, {
      status: 'error',
      error: err.message || 'Processing failed',
      updatedAt: Date.now(),
    }).catch(() => {});
    toast('Analysis failed', true);
  } finally {
    photoItems.forEach(p => { try { URL.revokeObjectURL(p.dataUrl); } catch {} });
  }
}

async function analyzeImages(heroBase64) {
  const resp = await fetch('/.netlify/functions/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ heroImages: heroBase64 }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `Analysis failed (${resp.status})`);
  }
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result;
}

async function uploadPhotosToStorage(scanId, photoItems, uid) {
  const images = {};
  const imageIds = [];

  for (const p of photoItems) {
    const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const fullPath = `users/${uid}/images/${imgId}.jpg`;
    const thumbPath = `users/${uid}/thumbs/${imgId}.jpg`;

    const [fullDataUrl, thumbDataUrl] = await Promise.all([
      fileToJpegDataUrl(p.file, 1600, 0.82),
      fileToJpegDataUrl(p.file, 320, 0.70),
    ]);

    await Promise.all([
      fb.uploadBytes(fb.sRef(storage, fullPath), dataUrlToBlob(fullDataUrl), { contentType: 'image/jpeg' }),
      fb.uploadBytes(fb.sRef(storage, thumbPath), dataUrlToBlob(thumbDataUrl), { contentType: 'image/jpeg' }),
    ]);

    images[imgId] = { storagePath: fullPath, thumbPath, filename: p.file.name };
    imageIds.push(imgId);
    await yieldToUI();
  }

  return { images, imageIds };
}

/* ── Processing Status ─────────────────────────── */
function updateProcessingStatus() {
  const processing = scans.filter(s => s.status === 'processing');
  const el = $('#processingStatus');
  const text = $('#processingText');

  if (processing.length > 0) {
    el.setAttribute('aria-hidden', 'false');
    text.textContent = processing.length === 1
      ? 'Analyzing item\u2026'
      : `Analyzing ${processing.length} items\u2026`;
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
}

/* ── Results Rendering ─────────────────────────── */
function renderResults() {
  const list = $('#resultsList');
  const empty = $('#resultsEmpty');

  if (!scans.length) {
    list.style.display = 'none';
    empty.style.display = '';
    return;
  }

  list.style.display = '';
  empty.style.display = 'none';
  list.innerHTML = '';

  for (const scan of scans) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.id = scan.id;

    if (scan.status === 'processing') {
      card.innerHTML = '<div class="result-card__processing"><div class="spinner spinner--sm"></div><span>Analyzing\u2026</span></div>';
    } else if (scan.status === 'error') {
      card.innerHTML = `<div class="result-card__error"><span>Analysis failed</span><button class="btn btn--ghost btn--sm result-card__delete" data-id="${scan.id}">Remove</button></div>`;
    } else if (scan.status === 'complete' && scan.analysis) {
      const a = scan.analysis;
      const thumbIds = (scan.imageIds || []).slice(0, 3);
      const condition = (a.condition || '').replace(/_/g, ' ');
      const meta = [a.category, condition].filter(Boolean).join(' \u00b7 ');

      card.innerHTML = `
        <div class="result-card__images" data-scan="${scan.id}"></div>
        <div class="result-card__body">
          <div class="result-card__title">${esc(a.title || 'Item')}</div>
          <div class="result-card__price">$${a.priceLow}\u2009\u2013\u2009$${a.priceHigh}</div>
          ${meta ? `<div class="result-card__meta">${esc(meta)}</div>` : ''}
          <div class="result-card__desc">${esc(a.description || '')}</div>
          <div class="result-card__actions">
            <button class="btn btn--primary btn--sm result-card__listing" data-id="${scan.id}">Create listing</button>
            <button class="btn btn--danger btn--sm result-card__delete" data-id="${scan.id}">Delete</button>
          </div>
        </div>`;

      const imgContainer = card.querySelector('.result-card__images');
      for (const imgId of thumbIds) {
        const img = scan.images?.[imgId];
        if (img?.thumbPath) {
          const imgEl = document.createElement('img');
          imgEl.alt = '';
          imgEl.className = 'result-card__img';
          imgContainer.appendChild(imgEl);
          getStorageObjectUrl(img.thumbPath).then(url => { imgEl.src = url; }).catch(() => {});
        }
      }
    }

    list.appendChild(card);
  }
}

/* ── Result Actions ────────────────────────────── */
$('#resultsList').addEventListener('click', async e => {
  const listingBtn = e.target.closest('.result-card__listing');
  if (listingBtn) {
    const scan = scans.find(s => s.id === listingBtn.dataset.id);
    if (scan?.analysis) copyListing(scan);
    return;
  }

  const deleteBtn = e.target.closest('.result-card__delete');
  if (deleteBtn) {
    if (!currentUser) return;
    const scanId = deleteBtn.dataset.id;
    if (!confirm('Delete this result?')) return;
    await fb.deleteScanDoc(currentUser.uid, scanId).catch(() => {});
    toast('Deleted');
  }
});

function copyListing(scan) {
  const a = scan.analysis;
  const lines = [
    a.title,
    '',
    a.description,
    '',
    `Condition: ${(a.condition || '').replace(/_/g, ' ')}`,
    `Category: ${a.category || 'N/A'}`,
    `Suggested price: $${a.priceLow} \u2013 $${a.priceHigh}`,
    `Keywords: ${(a.keywords || []).join(', ')}`,
  ];
  navigator.clipboard.writeText(lines.join('\n')).then(
    () => toast('Listing copied!'),
    () => toast('Could not copy', true)
  );
}

/* ── Helpers ───────────────────────────────────── */
function esc(str) {
  return String(str || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]
  );
}

/* ── Init ──────────────────────────────────────── */
setAppVisible(false);
onRoute();
