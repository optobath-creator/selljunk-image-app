import { getStorageObjectUrl } from '../core/image.js';
import { $, setHidden } from './dom.js';

export async function renderCards({ groups, selectedIds }) {
  const cardsEl = $('#cards');
  const emptyEl = $('#emptyState');
  cardsEl.innerHTML = '';

  if (!groups.length) {
    setHidden(emptyEl, false);
    return;
  }
  setHidden(emptyEl, true);

  for (const g of groups) {
    const card = document.createElement('div');
    card.className = 'card' + (selectedIds.has(g.id) ? ' selected' : '');
    card.dataset.id = g.id;

    const heroIds = (g.heroImageIds || []).slice(0, 3);
    const heroImgs = heroIds.map(id => g.images?.[id]).filter(Boolean);
    const n = Math.min(3, heroImgs.length || 1);

    const title = g.analysis?.title || 'Group';
    const sub = `${(g.imageIds?.length || 0)} image${(g.imageIds?.length || 0) === 1 ? '' : 's'}`;

    card.innerHTML = `
      <div class="badge">Group</div>
      <div class="card__grid" data-n="${n}">
        ${(heroImgs.length ? heroImgs : [null]).slice(0,3).map(() => `<img alt="" />`).join('')}
      </div>
      <div class="card__meta">
        <div class="card__title">${escapeHtml(title)}</div>
        <div class="card__sub">${escapeHtml(sub)}</div>
      </div>
    `;

    // Load thumbs in background
    const imgs = Array.from(card.querySelectorAll('img'));
    heroImgs.slice(0, imgs.length).forEach(async (img, i) => {
      if (!img?.thumbPath) return;
      try {
        imgs[i].src = await getStorageObjectUrl(img.thumbPath);
      } catch {}
    });

    cardsEl.appendChild(card);
  }
}

export async function renderGroupSheet({ group, selectedImageIds }) {
  const overlay = $('#groupOverlay');
  const grid = $('#groupGrid');
  const title = $('#groupTitle');
  const analysisPanel = $('#analysisPanel');
  const aTitle = $('#analysisTitle');
  const aMeta = $('#analysisMeta');
  const aDesc = $('#analysisDesc');

  title.textContent = group.analysis?.title ? 'Listing' : 'Group';
  grid.innerHTML = '';

  const ids = group.imageIds || [];
  for (const id of ids) {
    const img = group.images?.[id];
    const wrap = document.createElement('div');
    wrap.className = 'img' + (selectedImageIds.has(id) ? ' selected' : '');
    wrap.dataset.id = id;
    wrap.innerHTML = `<img alt="" />`;
    grid.appendChild(wrap);
    if (img?.thumbPath) {
      getStorageObjectUrl(img.thumbPath).then(u => { wrap.querySelector('img').src = u; }).catch(() => {});
    }
  }

  if (group.analysis) {
    analysisPanel.setAttribute('aria-hidden', 'false');
    analysisPanel.style.display = '';
    aTitle.textContent = group.analysis.title || '';
    aMeta.textContent = [group.analysis.category, group.analysis.condition, group.analysis.priceMid ? `$${group.analysis.priceMid}` : null]
      .filter(Boolean).join(' · ');
    aDesc.textContent = group.analysis.description || '';
  } else {
    analysisPanel.setAttribute('aria-hidden', 'true');
    analysisPanel.style.display = 'none';
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

