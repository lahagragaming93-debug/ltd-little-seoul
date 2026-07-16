// ============================================================
// Toast notifications légères
// ============================================================

let container;

function ensureContainer() {
  if (container) return container;
  container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function toast(msg, type = 'info', durationMs = 3500) {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

export const toastSuccess = (m) => toast(m, 'success');
export const toastError   = (m) => toast(m, 'error', 5000);
