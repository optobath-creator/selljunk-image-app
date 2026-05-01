import { getStorageObjectUrl } from '../core/image.js';
import { $ } from './dom.js';

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

export function renderListings({ groups, selectedIds }) {
  const el = $('#listings');
  const empty = $('#emptyState');
  const bar = $('#actionBar');
  el.innerHTML = '';

  if (!groups.length) {
    empty.hidden = false;
    bar.hidden = true;
    return;
  }
  empty.hidden = true;
  bar.hidden = selectedIds.size === 0;

  for (const g of groups) {
    const card = document.createElement('div');
    card.className = 'card' + (selectedIds.has(g.id) ? ' card--selected' : '');
    card.dataset.id = g.id;

    const heroIds = (g.heroImageIds || []).slice(0, 1);
    const heroImg = heroIds[0] ? g.images?.[heroIds[0]] : null;
    const count = g.imageIds?.length || 0;
    const title = g.analysis?.title || 'Processing…';
    const price = g.analysis?.priceMid ? `$${g.analysis.priceMid}` : '';
    const category = g.analysis?.category || '';
    const isAnalyzing = g.state === 'grouped';

    card.innerHTML = `
      <div class="card-img${isAnalyzing ? ' card-img--loading' : ''}">
        <img alt="" />
        <span class="card-count">${count}</span>
      </div>
      <div class="card-body">
        <div class="card-title${isAnalyzing ? ' shimmer' : ''}">${esc(title)}</div>
        ${price ? `<div class="card-price">${esc(price)}</div>` : ''}
        ${category ? `<div class="card-cat">${esc(category)}</div>` : ''}
      </div>
    `;

    // Load hero thumbnail
    if (heroImg?.thumbPath) {
      const img = card.querySelector('img');
      getStorageObjectUrl(heroImg.thumbPath)
        .then(u => { img.src = u; })
        .catch(() => {});
    }

    el.appendChild(card);
  }
}

export function renderSheet({ group, selectedImageIds }) {
  const sheet = $('#sheet');
  const grid = $('#sheetImages');
  const titleInput = $('#sheetTitleInput');
  const priceInput = $('#sheetPrice');
  const catBadge = $('#sheetCategory');
  const descInput = $('#sheetDesc');
  const analysisPanel = $('#sheetAnalysis');

  grid.innerHTML = '';

  const ids = group.imageIds || [];
  for (const id of ids) {
    const img = group.images?.[id];
    const wrap = document.createElement('div');
    wrap.className = 'sheet-img' + (selectedImageIds.has(id) ? ' sheet-img--selected' : '');
    wrap.dataset.id = id;
    wrap.innerHTML = `
      <img alt="" draggable="true" />
      <button class="sheet-img-dl" title="Download" aria-label="Download image">↓</button>
    `;
    grid.appendChild(wrap);

    // Load full-size image
    if (img?.storagePath) {
      getStorageObjectUrl(img.storagePath)
        .then(u => {
          const imgEl = wrap.querySelector('img');
          imgEl.src = u;
          imgEl.dataset.url = u;
          imgEl.dataset.filename = img.filename || `${id}.jpg`;
        })
        .catch(() => {});
    }
  }

  if (group.analysis) {
    analysisPanel.hidden = false;
    titleInput.value = group.analysis.title || '';
    priceInput.value = group.analysis.priceMid || '';
    catBadge.textContent = group.analysis.category || '';
    descInput.value = group.analysis.description || '';
  } else {
    analysisPanel.hidden = false;
    titleInput.value = '';
    priceInput.value = '';
    catBadge.textContent = 'Analyzing…';
    descInput.value = '';
  }

  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('sheet-overlay--open'));
}

export function closeSheet() {
  const sheet = $('#sheet');
  sheet.classList.remove('sheet-overlay--open');
  setTimeout(() => { sheet.hidden = true; }, 300);
}
