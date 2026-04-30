let timer = null;

export function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (timer) clearTimeout(timer);
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  timer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

