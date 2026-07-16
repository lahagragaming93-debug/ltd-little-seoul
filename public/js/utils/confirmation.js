// ============================================================
// Composants modaux universels (remplace confirm/alert/prompt)
// Utilisable partout, compatible tablette FiveM CEF
// ============================================================

let modalCounter = 0;

function nextId() {
  return `dlg-${++modalCounter}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// Empêche la fermeture par Escape pour les modales critiques
function trapFocus(modalEl, allowEscape, onEscape) {
  const handler = (e) => {
    if (e.key === 'Escape' && allowEscape) {
      e.preventDefault();
      onEscape();
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

function mountModal(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const node = wrap.firstElementChild;
  document.body.appendChild(node);
  return node;
}

// ============================================================
// confirmAction — confirmation simple (équivalent confirm())
// ============================================================
// Options : { titre, message, btnConfirm, btnCancel, type, danger }
// Retourne : Promise<boolean>
export function confirmAction({
  titre = 'Confirmation',
  message = 'Êtes-vous sûr ?',
  btnConfirm = 'Confirmer',
  btnCancel = 'Annuler',
  type = 'info', // 'info' | 'warn' | 'danger'
  icon = null
} = {}) {
  return new Promise((resolve) => {
    const id = nextId();
    const ic = icon ?? '';
    const node = mountModal(`
      <div class="modal-backdrop confirm-modal" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal modal-confirm modal-${type}">
          <h3 id="${id}-title" class="confirm-title">${ic ? `<span class="confirm-ico">${ic}</span>` : ''}${escapeHtml(titre)}</h3>
          <div class="confirm-message">${message}</div>
          <div class="confirm-actions">
            <button class="btn btn-ghost" data-action="cancel">${escapeHtml(btnCancel)}</button>
            <button class="btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}" data-action="ok">${escapeHtml(btnConfirm)}</button>
          </div>
        </div>
      </div>
    `);

    const close = (val) => {
      detach();
      node.remove();
      resolve(val);
    };

    node.querySelector('[data-action="ok"]').addEventListener('click', () => close(true));
    node.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    // Clic sur le backdrop (hors modal) annule
    node.addEventListener('click', (e) => { if (e.target === node) close(false); });
    const detach = trapFocus(node, true, () => close(false));

    // Focus auto sur Annuler par défaut (sécurité)
    setTimeout(() => node.querySelector('[data-action="cancel"]')?.focus(), 50);
  });
}

// ============================================================
// confirmCritique — confirmation décisive avec timer 3s
// ============================================================
// Pour suppressions, changements de rôle, créations Patron, etc.
// Le bouton "Confirmer" est verrouillé pendant `delaiSec` secondes.
// Options : { titre, message, btnConfirm, btnCancel, delaiSec, requireType }
// requireType : si fourni, l'utilisateur doit retaper exactement ce mot pour activer
// Retourne : Promise<boolean>
export function confirmCritique({
  titre = 'Action irréversible',
  message = 'Cette action est définitive.',
  btnConfirm = 'Confirmer',
  btnCancel = 'Annuler',
  delaiSec = 3,
  requireType = null
} = {}) {
  return new Promise((resolve) => {
    const id = nextId();
    const typeBlock = requireType ? `
      <div class="confirm-type-block">
        <label for="${id}-input">Tape <strong class="confirm-type-word">${escapeHtml(requireType)}</strong> pour activer le bouton :</label>
        <input type="text" id="${id}-input" class="confirm-type-input" autocomplete="off" />
      </div>
    ` : '';

    const node = mountModal(`
      <div class="modal-backdrop confirm-modal critique" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal modal-confirm modal-danger modal-critique">
          <div class="critique-band">ACTION CRITIQUE</div>
          <h3 id="${id}-title" class="confirm-title">${escapeHtml(titre)}</h3>
          <div class="confirm-message">${message}</div>
          ${typeBlock}
          <div class="confirm-actions">
            <button class="btn btn-ghost" data-action="cancel">${escapeHtml(btnCancel)}</button>
            <button class="btn btn-danger" data-action="ok" disabled>
              <span class="btn-label">${escapeHtml(btnConfirm)}</span>
              <span class="btn-timer"> (${delaiSec})</span>
            </button>
          </div>
          <div class="confirm-hint">Lisez attentivement avant de confirmer.</div>
        </div>
      </div>
    `);

    const okBtn      = node.querySelector('[data-action="ok"]');
    const cancelBtn  = node.querySelector('[data-action="cancel"]');
    const timerSpan  = node.querySelector('.btn-timer');
    const labelSpan  = node.querySelector('.btn-label');
    const typeInput  = requireType ? node.querySelector(`#${id}-input`) : null;

    let restantSec = delaiSec;
    let typeOk = !requireType;
    let timeUp = false;

    const refreshOk = () => {
      okBtn.disabled = !(typeOk && timeUp);
    };

    const tick = setInterval(() => {
      restantSec--;
      if (restantSec > 0) {
        timerSpan.textContent = ` (${restantSec})`;
      } else {
        clearInterval(tick);
        timerSpan.textContent = '';
        timeUp = true;
        refreshOk();
      }
    }, 1000);

    if (typeInput) {
      typeInput.addEventListener('input', () => {
        typeOk = (typeInput.value.trim() === requireType);
        refreshOk();
      });
      setTimeout(() => typeInput.focus(), 50);
    } else {
      setTimeout(() => cancelBtn.focus(), 50);
    }

    const close = (val) => {
      clearInterval(tick);
      detach();
      node.remove();
      resolve(val);
    };

    okBtn.addEventListener('click', () => { if (!okBtn.disabled) close(true); });
    cancelBtn.addEventListener('click', () => close(false));
    // Pas de clic backdrop ni Escape pour les critiques (force décision explicite)
    const detach = trapFocus(node, false, () => {});
  });
}

// ============================================================
// infoModal — équivalent alert() (just un OK)
// ============================================================
// Options : { titre, message, type, btnOk }
// Retourne : Promise<void>
export function infoModal({
  titre = 'Information',
  message = '',
  type = 'info', // 'info' | 'warn' | 'danger' | 'success'
  btnOk = 'OK',
  icon = null
} = {}) {
  return new Promise((resolve) => {
    const id = nextId();
    const ic = icon ?? '';
    const node = mountModal(`
      <div class="modal-backdrop confirm-modal" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal modal-confirm modal-${type}">
          <h3 id="${id}-title" class="confirm-title">${ic ? `<span class="confirm-ico">${ic}</span>` : ''}${escapeHtml(titre)}</h3>
          <div class="confirm-message">${message}</div>
          <div class="confirm-actions">
            <button class="btn btn-primary" data-action="ok">${escapeHtml(btnOk)}</button>
          </div>
        </div>
      </div>
    `);

    const close = () => { detach(); node.remove(); resolve(); };
    node.querySelector('[data-action="ok"]').addEventListener('click', close);
    node.addEventListener('click', (e) => { if (e.target === node) close(); });
    const detach = trapFocus(node, true, close);
    setTimeout(() => node.querySelector('[data-action="ok"]')?.focus(), 50);
  });
}

// ============================================================
// promptModal — équivalent prompt() avec validation custom
// ============================================================
// Options : { titre, label, defaut, placeholder, btnOk, btnCancel, type, validate }
// validate(value) → string|null  (null = OK, string = message d'erreur)
// Retourne : Promise<string|null>  (null si annulé)
export function promptModal({
  titre = 'Entrer une valeur',
  label = '',
  message = '',
  defaut = '',
  placeholder = '',
  btnOk = 'Valider',
  btnCancel = 'Annuler',
  type = 'text', // 'text' | 'password' | 'number' | 'email'
  validate = null
} = {}) {
  return new Promise((resolve) => {
    const id = nextId();
    const node = mountModal(`
      <div class="modal-backdrop confirm-modal" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
        <div class="modal modal-confirm">
          <h3 id="${id}-title" class="confirm-title">${escapeHtml(titre)}</h3>
          ${message ? `<div class="confirm-message">${message}</div>` : ''}
          ${label ? `<label for="${id}-input" class="prompt-label">${escapeHtml(label)}</label>` : ''}
          <input type="${escapeAttr(type)}" id="${id}-input" class="prompt-input"
                 value="${escapeAttr(defaut)}" placeholder="${escapeAttr(placeholder)}" />
          <div class="prompt-error" id="${id}-err" hidden></div>
          <div class="confirm-actions">
            <button class="btn btn-ghost" data-action="cancel">${escapeHtml(btnCancel)}</button>
            <button class="btn btn-primary" data-action="ok">${escapeHtml(btnOk)}</button>
          </div>
        </div>
      </div>
    `);

    const input  = node.querySelector(`#${id}-input`);
    const errEl  = node.querySelector(`#${id}-err`);
    const okBtn  = node.querySelector('[data-action="ok"]');
    const cancel = node.querySelector('[data-action="cancel"]');

    const close = (val) => { detach(); node.remove(); resolve(val); };

    const tryOk = () => {
      const v = input.value;
      if (validate) {
        const err = validate(v);
        if (err) {
          errEl.textContent = err;
          errEl.hidden = false;
          input.focus();
          return;
        }
      }
      close(v);
    };

    okBtn.addEventListener('click', tryOk);
    cancel.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tryOk(); }
    });
    node.addEventListener('click', (e) => { if (e.target === node) close(null); });
    const detach = trapFocus(node, true, () => close(null));

    setTimeout(() => input.focus(), 50);
  });
}
