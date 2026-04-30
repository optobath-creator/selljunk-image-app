export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function setHidden(el, hidden) {
  if (!el) return;
  el.style.display = hidden ? 'none' : '';
  el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

