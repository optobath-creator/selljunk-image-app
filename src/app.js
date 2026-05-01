import { fb, auth, db, storage } from './core/firebase.js';
import { cacheClear } from './core/cache.js';
import { toast } from './core/toast.js';
import { JobQueue } from './core/jobs.js';
import { getStorageObjectUrl } from './core/image.js';
import { $ } from './ui/dom.js';
import { renderListings, renderSheet, closeSheet } from './ui/render.js';

let currentUser = null;
let groups = [];
let unsub = null;
const selectedGroupIds = new Set();
let openGroupId = null;
const selectedImageIds = new Set();

const queue = new JobQueue({
  onProgress: ({ pending, total }) => {
    const bar = $('#progressBar');
    const fill = $('#progressFill');
    if (!total || pending <= 0) {
      bar.hidden = true;
      fill.style.width = '0%';
      return;
    }
    bar.hidden = false;
    const pct = Math.round(((total - pending) / total) * 100);
    fill.style.width = pct + '%';
  },
});

// ─── Auth ───────────────────────────────────────────────
$('#googleSignInBtn').onclick = async () => {
  $('#authErr').textContent = '';
  try { await fb.signIn(); }
  catch (e) { $('#authErr').textContent = e?.message || 'Sign-in failed'; }
};
$('#signOutBtn').onclick = async () => {
  if (unsub) { unsub(); unsub = null; }
  await fb.signOut();
};

fb.onAuth(user => {
  currentUser = user;
  if (!user) {
    cacheClear();
    groups = [];
    selectedGroupIds.clear();
    $('#app').hidden = true;
    $('#authScreen').hidden = false;
    return;
  }
  $('#app').hidden = false;
  $('#authScreen').hidden = true;
  const av = $('#userAvatar');
  if (user.photoURL) { av.src = user.photoURL; av.hidden = false; }
  else av.hidden = true;
  startSync();
});

function startSync() {
  if (!currentUser) return;
  if (unsub) unsub();
  unsub = fb.onSnap(
    fb.groupsQuery(currentUser.uid),
    snap => {
      groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const idSet = new Set(groups.map(g => g.id));
      for (const id of [...selectedGroupIds]) if (!idSet.has(id)) selectedGroupIds.delete(id);
      if (openGroupId && !idSet.has(openGroupId)) doCloseSheet();
      render();
      // Re-render open sheet if data changed (skip if user is editing)
      if (openGroupId) {
        const focused = document.activeElement;
        const isEditing = focused && (focused.id === 'sheetTitleInput' || focused.id === 'sheetPrice' || focused.id === 'sheetDesc');
        if (!isEditing) {
          const g = groups.find(x => x.id === openGroupId);
          if (g) renderSheet({ group: g, selectedImageIds });
        }
      }
    },
    err => { console.error(err); toast('Sync error', true); },
  );
}

// ─── Upload ─────────────────────────────────────────────
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) await handleUpload(files);
});
['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('upload--over'); }));
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('upload--over'); }));
dropzone.addEventListener('drop', async e => {
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) await handleUpload(files);
});

async function handleUpload(files) {
  if (!currentUser) return;
  try {
    await queue.uploadAndProcess({ uid: currentUser.uid, files });
    toast('Done');
  } catch (e) {
    console.error(e);
    toast(e?.message || 'Upload failed', true);
  }
}

// ─── Card interactions ──────────────────────────────────
let longPressHandled = false;

$('#listings').addEventListener('click', e => {
  if (longPressHandled) { longPressHandled = false; return; }
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.shiftKey || e.ctrlKey || e.metaKey || selectedGroupIds.size > 0) {
    if (selectedGroupIds.has(id)) selectedGroupIds.delete(id);
    else selectedGroupIds.add(id);
    render();
  } else {
    openGroup(id);
  }
});

// Long-press for multi-select on mobile
let pressTimer = null;
$('#listings').addEventListener('pointerdown', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  pressTimer = setTimeout(() => {
    const id = card.dataset.id;
    if (selectedGroupIds.has(id)) selectedGroupIds.delete(id);
    else selectedGroupIds.add(id);
    render();
    longPressHandled = true;
    pressTimer = null;
  }, 500);
});
['pointerup', 'pointercancel'].forEach(ev =>
  $('#listings').addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }));

// ─── Action bar ─────────────────────────────────────────
$('#mergeBtn').onclick = async () => {
  if (!currentUser || selectedGroupIds.size < 2) return;
  await queue.mergeGroups({ uid: currentUser.uid, groups, groupIds: Array.from(selectedGroupIds) });
  selectedGroupIds.clear();
  render();
  toast('Groups merged');
};

$('#deleteBtn').onclick = async () => {
  if (!currentUser || !selectedGroupIds.size) return;
  const n = selectedGroupIds.size;
  if (!confirm(`Delete ${n} group${n > 1 ? 's' : ''} and all photos?`)) return;
  const ids = Array.from(selectedGroupIds);
  selectedGroupIds.clear();
  render();
  await queue.deleteGroups({ uid: currentUser.uid, groups, groupIds: ids });
  toast('Deleted');
};

$('#deselectBtn').onclick = () => { selectedGroupIds.clear(); render(); };

// ─── Sheet ──────────────────────────────────────────────
function openGroup(id) {
  const g = groups.find(x => x.id === id);
  if (!g) return;
  openGroupId = id;
  selectedImageIds.clear();
  renderSheet({ group: g, selectedImageIds });
}

function doCloseSheet() {
  openGroupId = null;
  selectedImageIds.clear();
  closeSheet();
}

$('#sheetClose').onclick = doCloseSheet;
$('#sheet').querySelector('.sheet-backdrop').addEventListener('click', doCloseSheet);

// Image selection in sheet
$('#sheetImages').addEventListener('click', e => {
  const dl = e.target.closest('.sheet-img-dl');
  if (dl) {
    e.stopPropagation();
    const wrap = dl.closest('.sheet-img');
    const img = wrap?.querySelector('img');
    if (img?.dataset.url) downloadFile(img.dataset.url, img.dataset.filename || 'image.jpg');
    return;
  }
  const wrap = e.target.closest('.sheet-img');
  if (!wrap) return;
  const id = wrap.dataset.id;
  if (selectedImageIds.has(id)) selectedImageIds.delete(id);
  else selectedImageIds.add(id);
  wrap.classList.toggle('sheet-img--selected', selectedImageIds.has(id));
  updateSheetActions();
});

function updateSheetActions() {
  const removeBtn = $('#sheetRemoveBtn');
  if (removeBtn) removeBtn.hidden = selectedImageIds.size === 0;
}

// Download all
$('#sheetDownloadAll').onclick = () => {
  const imgs = Array.from(document.querySelectorAll('#sheetImages .sheet-img img'));
  imgs.forEach(img => {
    if (img.dataset.url) downloadFile(img.dataset.url, img.dataset.filename || 'image.jpg');
  });
};

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Remove selected images from group
$('#sheetRemoveBtn').onclick = async () => {
  if (!currentUser || !openGroupId || !selectedImageIds.size) return;
  const g = groups.find(x => x.id === openGroupId);
  if (!g) return;
  await queue.removeImages({ uid: currentUser.uid, group: g, imageIds: Array.from(selectedImageIds) });
  selectedImageIds.clear();
  toast('Removed');
};

// Delete entire group from sheet
$('#sheetDeleteGroup').onclick = async () => {
  if (!currentUser || !openGroupId) return;
  if (!confirm('Delete this group and all its photos?')) return;
  const gid = openGroupId;
  doCloseSheet();
  await queue.deleteGroups({ uid: currentUser.uid, groups, groupIds: [gid] });
  toast('Deleted');
};

// Re-analyze from sheet
$('#sheetReanalyze').onclick = async () => {
  if (!currentUser || !openGroupId) return;
  const g = groups.find(x => x.id === openGroupId);
  if (!g) return;
  toast('Re-analyzing…');
  await queue.reanalyze({ uid: currentUser.uid, group: g });
};

// Inline edits (save on blur)
$('#sheetTitleInput').addEventListener('blur', saveEdits);
$('#sheetPrice').addEventListener('blur', saveEdits);
$('#sheetDesc').addEventListener('blur', saveEdits);

async function saveEdits() {
  if (!currentUser || !openGroupId) return;
  const g = groups.find(x => x.id === openGroupId);
  if (!g || !g.analysis) return;
  const title = $('#sheetTitleInput').value.trim();
  const priceRaw = $('#sheetPrice').value.trim();
  const priceMid = priceRaw !== '' ? (parseInt(priceRaw) || 0) : null;
  const description = $('#sheetDesc').value.trim();
  if (title === g.analysis.title && priceMid === g.analysis.priceMid && description === g.analysis.description) return;
  await fb.updateGroup(currentUser.uid, openGroupId, {
    'analysis.title': title !== '' ? title : g.analysis.title,
    'analysis.priceMid': priceMid != null ? priceMid : g.analysis.priceMid,
    'analysis.description': description !== '' ? description : g.analysis.description,
  });
}

// ─── Render ─────────────────────────────────────────────
function render() {
  renderListings({ groups, selectedIds: selectedGroupIds });
}
