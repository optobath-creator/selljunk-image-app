import { fb, auth, db, storage } from './core/firebase.js';
import { cacheClear } from './core/cache.js';
import { toast } from './core/toast.js';
import { JobQueue } from './core/jobs.js';
import { $, $$, setHidden } from './ui/dom.js';
import { renderCards, renderGroupSheet } from './ui/render.js';
import { getStorageObjectUrl } from './core/image.js';

let currentUser = null;
let groups = [];
let unsub = null;

const selectedGroupIds = new Set();
let openGroupId = null;
const selectedImageIds = new Set();
const repOverride = new Map(); // groupId -> [imgIds] (uses selection at analyze-time)

const queue = new JobQueue({
  onProgress: ({ pending, total }) => {
    const el = $('#globalProgress');
    const count = $('#progressCount');
    const fill = $('#progressFill');
    if (!total || pending <= 0) {
      setHidden(el, true);
      count.textContent = '0';
      fill.style.width = '0%';
      return;
    }
    setHidden(el, false);
    count.textContent = String(pending);
    const done = Math.max(0, total - pending);
    fill.style.width = `${Math.round((done / total) * 100)}%`;
  }
});

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

// Auth
$('#googleSignInBtn').onclick = async () => {
  $('#authErr').textContent = '';
  try { await fb.signIn(); }
  catch (e) { $('#authErr').textContent = e?.message || 'Sign-in failed'; }
};
$('#signOutBtn').onclick = async () => {
  if (unsub) { unsub(); unsub = null; }
  await fb.signOut();
};

fb.onAuthStateChanged(user => {
  currentUser = user;
  if (!user) {
    cacheClear();
    groups = [];
    selectedGroupIds.clear();
    setAppVisible(false);
    return;
  }

  setAppVisible(true);
  const av = $('#userAvatar');
  if (user.photoURL) { av.src = user.photoURL; av.style.display = ''; }
  else av.style.display = 'none';

  startSync();
});

function startSync() {
  if (!currentUser) return;
  if (unsub) unsub();
  const q = fb.userGroupsQuery(currentUser.uid);
  unsub = fb.onGroupsSnapshot(q, snap => {
    groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // keep selections that still exist
    const idSet = new Set(groups.map(g => g.id));
    for (const id of Array.from(selectedGroupIds)) if (!idSet.has(id)) selectedGroupIds.delete(id);
    if (openGroupId && !idSet.has(openGroupId)) closeGroup();
    render();
  }, err => {
    console.error(err);
    toast('Sync error', true);
  });
}

// Upload dropzone
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  await handleUpload(files);
});

['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.add('dragover');
}));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', async (e) => {
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  await handleUpload(files);
});

async function handleUpload(files) {
  if (!currentUser) return;
  try {
    await queue.uploadAndGroup({ uid: currentUser.uid, files });
    toast('Uploaded');
  } catch (e) {
    console.error(e);
    toast(e?.message || 'Upload failed', true);
  }
}

// Global actions
const selectAllBtn = $('#selectAllBtn');
const deleteBtn = $('#deleteBtn');
const analyzeBtn = $('#analyzeBtn');

selectAllBtn.onclick = () => {
  if (!groups.length) return;
  const allSelected = selectedGroupIds.size === groups.length;
  selectedGroupIds.clear();
  if (!allSelected) groups.forEach(g => selectedGroupIds.add(g.id));
  render();
};

deleteBtn.onclick = async () => {
  if (!currentUser) return;
  if (!selectedGroupIds.size) return;
  if (!confirm(`Delete ${selectedGroupIds.size} group(s) and all photos?`)) return;
  const ids = Array.from(selectedGroupIds);
  selectedGroupIds.clear();
  render();
  await queue.deleteGroupsFast({ uid: currentUser.uid, groups, groupIds: ids });
  toast('Deleted');
};

analyzeBtn.onclick = async () => {
  if (!currentUser) return;
  const ids = Array.from(selectedGroupIds);
  if (!ids.length) return;
  analyzeBtn.disabled = true;
  try {
    await queue.analyzeGroups({
      uid: currentUser.uid,
      groups,
      groupIds: ids,
      getRepIdsForGroup: (gid) => repOverride.get(gid) || [],
    });
    toast('Ready');
  } finally {
    analyzeBtn.disabled = false;
  }
};

// Card interactions: tap selects, dblclick opens (desktop). Long-press opens (mobile).
let pressTimer = null;
$('#cards').addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  pressTimer = setTimeout(() => openGroup(id), 520);
});
$('#cards').addEventListener('pointerup', () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });
$('#cards').addEventListener('pointercancel', () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });

$('#cards').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (selectedGroupIds.has(id)) selectedGroupIds.delete(id);
  else selectedGroupIds.add(id);
  render();
});
$('#cards').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  openGroup(card.dataset.id);
});

// Group overlay
$('#closeGroupBtn').onclick = closeGroup;
$('#groupOverlay').addEventListener('click', (e) => {
  if (e.target === $('#groupOverlay')) closeGroup();
});

function openGroup(groupId) {
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  openGroupId = groupId;
  selectedImageIds.clear();
  renderGroup();
  updateGroupActions();
}
function closeGroup() {
  openGroupId = null;
  selectedImageIds.clear();
  const overlay = $('#groupOverlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// Group image tap selects; if 1-3 selected when Analyze pressed inside group, use those as reps.
const groupGrid = $('#groupGrid');
groupGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.img');
  if (!cell) return;
  const id = cell.dataset.id;
  if (selectedImageIds.has(id)) selectedImageIds.delete(id);
  else selectedImageIds.add(id);
  cell.classList.toggle('selected', selectedImageIds.has(id));
  updateGroupActions();
});

// Long press on any image in group view downloads ALL images in group
let imgPressTimer = null;
groupGrid.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.img');
  if (!cell) return;
  imgPressTimer = setTimeout(() => downloadOpenGroupAll(), 520);
});
groupGrid.addEventListener('pointerup', () => { if (imgPressTimer) clearTimeout(imgPressTimer); imgPressTimer = null; });
groupGrid.addEventListener('pointercancel', () => { if (imgPressTimer) clearTimeout(imgPressTimer); imgPressTimer = null; });

$('#groupSelectAllBtn').onclick = () => {
  const g = getOpenGroup();
  if (!g) return;
  const ids = g.imageIds || [];
  const allSelected = selectedImageIds.size === ids.length;
  selectedImageIds.clear();
  if (!allSelected) ids.forEach(id => selectedImageIds.add(id));
  renderGroup();
  updateGroupActions();
};

$('#groupDeleteBtn').onclick = async () => {
  const g = getOpenGroup();
  if (!g || !currentUser) return;
  const ids = Array.from(selectedImageIds);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} image(s) from this group?`)) return;

  // Update doc fast: remove images and imageIds; cleanup storage async
  const keep = (g.imageIds || []).filter(id => !selectedImageIds.has(id));
  const images = { ...(g.images || {}) };
  const removed = ids.map(id => images[id]).filter(Boolean);
  ids.forEach(id => delete images[id]);

  selectedImageIds.clear();
  if (keep.length === 0) {
    // deleting whole group
    closeGroup();
    await queue.deleteGroupsFast({ uid: currentUser.uid, groups, groupIds: [g.id] });
  } else {
    await fb.setGroup(currentUser.uid, g.id, {
      imageIds: keep,
      heroImageIds: keep.slice(0, 3),
      images,
      analysis: null,
      analysisSig: null,
      state: 'grouped',
      updatedAt: Date.now(),
    });
    // async cleanup
    setTimeout(async () => {
      for (const img of removed) {
        if (img?.storagePath) await fb.deleteObject(fb.sRef(storage, img.storagePath)).catch(() => {});
        if (img?.thumbPath) await fb.deleteObject(fb.sRef(storage, img.thumbPath)).catch(() => {});
      }
    }, 0);
  }
  toast('Deleted');
};

$('#groupAnalyzeBtn').onclick = async () => {
  const g = getOpenGroup();
  if (!g || !currentUser) return;
  const sel = Array.from(selectedImageIds);
  if (sel.length >= 1 && sel.length <= 3) repOverride.set(g.id, sel);
  await queue.analyzeGroups({
    uid: currentUser.uid,
    groups,
    groupIds: [g.id],
    getRepIdsForGroup: (gid) => repOverride.get(gid) || [],
  });
  selectedImageIds.clear();
  toast('Ready');
};

$('#groupSplitBtn').onclick = async () => {
  const g = getOpenGroup();
  if (!g || !currentUser) return;
  const move = Array.from(selectedImageIds);
  if (!move.length) return;
  if (move.length === (g.imageIds || []).length) return toast('Select fewer images to split', true);

  const keep = (g.imageIds || []).filter(id => !selectedImageIds.has(id));
  const newIds = move;
  const now = Date.now();
  const newGroupId = 'grp_' + now + '_split_' + Math.random().toString(36).slice(2, 7);
  const mkImages = (idList) => {
    const images = {};
    idList.forEach(id => { if (g.images?.[id]) images[id] = g.images[id]; });
    return images;
  };
  const batch = fb.writeBatch(db);
  batch.set(fb.doc(db, 'users', currentUser.uid, 'groups', g.id), {
    imageIds: keep,
    heroImageIds: keep.slice(0, 3),
    images: mkImages(keep),
    analysis: null,
    analysisSig: null,
    state: 'grouped',
    updatedAt: now,
  }, { merge: true });
  batch.set(fb.doc(db, 'users', currentUser.uid, 'groups', newGroupId), {
    imageIds: newIds,
    heroImageIds: newIds.slice(0, 3),
    images: mkImages(newIds),
    analysis: null,
    analysisSig: null,
    state: 'grouped',
    createdAt: now + 1,
    updatedAt: now + 1,
  });
  await batch.commit();
  selectedImageIds.clear();
  toast('Split');
};

function getOpenGroup() {
  if (!openGroupId) return null;
  return groups.find(g => g.id === openGroupId) || null;
}

async function downloadOpenGroupAll() {
  const g = getOpenGroup();
  if (!g) return;
  toast('Preparing downloads…');
  const imgs = (g.imageIds || []).map(id => g.images?.[id]).filter(Boolean);
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    try {
      const url = await getStorageObjectUrl(img.storagePath);
      const a = document.createElement('a');
      a.href = url;
      a.download = img.filename || `photo_${i + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {}
  }
  toast('Downloading…');
}

function updateActions() {
  const has = groups.length > 0;
  selectAllBtn.disabled = !has;
  deleteBtn.disabled = selectedGroupIds.size === 0;
  analyzeBtn.disabled = selectedGroupIds.size === 0;
}

function updateGroupActions() {
  const g = getOpenGroup();
  const ids = g?.imageIds || [];
  $('#groupSelectAllBtn').disabled = ids.length === 0;
  $('#groupDeleteBtn').disabled = selectedImageIds.size === 0;
  $('#groupSplitBtn').disabled = selectedImageIds.size === 0 || selectedImageIds.size === ids.length;
  $('#groupAnalyzeBtn').disabled = false;
}

async function render() {
  await renderCards({ groups, selectedIds: selectedGroupIds });
  updateActions();
}

async function renderGroup() {
  const g = getOpenGroup();
  if (!g) return;
  await renderGroupSheet({ group: g, selectedImageIds });
}

// initial UI state
setHidden($('#globalProgress'), true);
setAppVisible(false);

