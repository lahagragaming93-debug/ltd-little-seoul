// ============================================================
// Util reutilisable : panneaux .panel.framed repliables/depliables
// ============================================================
// Ajoute automatiquement un bouton chevron (▾/▸) dans la .panel-title
// de chaque .panel.framed visible dans la page. Clic sur le bouton
// (ou sur le titre lui-meme) replie/deplie le contenu. L'etat est
// persiste par utilisateur dans localStorage : 1 cle par (page, index
// du panneau) ou via data-collapse-key="..." si l'auteur l'a defini
// explicitement (plus robuste si l'ordre des panneaux change).
//
// Branche automatiquement via layout.js (initCollapsiblePanels()
// appele apres renderShell et apres chaque mutation du <main>).
// Les pages n'ont rien a faire — c'est transparent.
// ============================================================

const STORAGE_PREFIX = 'panel-collapsed:';

function pageKey() {
  const p = (location.pathname.split('/').pop() || '').replace('.html', '');
  return p || 'index';
}

function keyForPanel(panel, index) {
  if (panel.dataset.collapseKey) return `${pageKey()}:${panel.dataset.collapseKey}`;
  return `${pageKey()}:panel-${index}`;
}

function isCollapsedInStorage(storageKey) {
  // Default = REPLIE. L'utilisateur doit cliquer pour deplier ; son choix est
  // persiste ('0' = deplie explicite, sinon replie). Comportement choisi par
  // le patron pour reduire le scroll vertical sur tablette in-game.
  try { return localStorage.getItem(STORAGE_PREFIX + storageKey) !== '0'; }
  catch { return true; }
}

function persistCollapsed(storageKey, collapsed) {
  try { localStorage.setItem(STORAGE_PREFIX + storageKey, collapsed ? '1' : '0'); }
  catch {}
}

function ensureButton(title) {
  let btn = title.querySelector('.panel-collapse-btn');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'panel-collapse-btn';
  btn.setAttribute('aria-label', 'Replier ou deplier le panneau');
  btn.title = 'Replier / Deplier';
  title.appendChild(btn);
  return btn;
}

function attachOne(panel, index) {
  const title = panel.querySelector(':scope > .panel-title');
  if (!title) return; // pas de titre => pas de zone clicable, on skip
  // Si le bouton existe deja dans ce titre, c'est deja branche : skip.
  // (idempotent meme apres innerHTML de la page qui wipe nos handlers)
  if (title.querySelector(':scope > .panel-collapse-btn')) return;

  const storageKey = keyForPanel(panel, index);
  const btn = ensureButton(title);

  const setState = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '▸' : '▾'; // ▸ / ▾
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };

  setState(isCollapsedInStorage(storageKey));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = !panel.classList.contains('collapsed');
    setState(next);
    persistCollapsed(storageKey, next);
  });

  // Cliquer dans le titre (hors controles interactifs) replie aussi
  title.style.cursor = 'pointer';
  title.addEventListener('click', (e) => {
    if (e.target === btn || btn.contains(e.target)) return;
    if (e.target.closest('button, a, input, select, textarea, label')) return;
    btn.click();
  });
}

export function initCollapsiblePanels(root = document) {
  // On cible TOUS les .panel (framed ou non). attachOne skip ceux qui n'ont
  // pas de .panel-title direct (= petits panneaux de formulaire) ou ceux
  // marques data-no-collapse="1" (opt-out explicite).
  const panels = root.querySelectorAll('.panel:not([data-no-collapse="1"])');
  panels.forEach((p, i) => attachOne(p, i));
}

// MutationObserver : capte les panneaux ajoutes apres coup par les pages
// (rendus dynamiques apres fetch Firestore, modales, etc.). Le scan est
// peu couteux grace au flag dataset.collapsibleAttached qui evite les doubles.
let observer = null;
export function observeMain() {
  if (observer) return;
  const main = document.querySelector('main.main') || document.body;
  observer = new MutationObserver(() => initCollapsiblePanels(main));
  observer.observe(main, { childList: true, subtree: true });
}
