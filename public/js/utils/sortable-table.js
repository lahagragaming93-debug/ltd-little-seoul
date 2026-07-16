// ============================================================
// Helper réutilisable : tableaux scrollables + triables
// ============================================================
// Usage minimal :
//
//   import { makeSortable, wrapScroll } from '../utils/sortable-table.js';
//   const t = document.getElementById('mon-tableau');
//   wrapScroll(t);          // limite à 600px de haut + sticky header
//   makeSortable(t);        // tri click sur tout <th> ayant data-sort
//
// Les <th> doivent avoir l'attribut `data-sort` (la valeur sert juste de
// label CSS pour l'état "sorted"). Une <span class="sort-arrow"></span>
// est ajoutée automatiquement si absente.
//
// Le tri lit le contenu textuel des cellules. Pour forcer un type ou
// une valeur custom, mettre `data-sort-value="..."` sur la <td>.
// Exemple : badges de statut → `<td data-sort-value="0">RUPTURE</td>`
// pour que rupture (0) trie avant ok (2).
//
// Re-rendu robuste : si le tbody est reconstruit (innerHTML = '...'),
// le helper détecte via MutationObserver et réapplique le tri actif.
// ============================================================

export function wrapScroll(tableEl, maxHeightPx = 600) {
  if (!tableEl) return;
  if (tableEl.parentElement?.classList.contains('table-scroll')) return; // déjà wrappé
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  if (maxHeightPx !== 600) wrapper.style.maxHeight = `${maxHeightPx}px`;
  tableEl.parentNode.insertBefore(wrapper, tableEl);
  wrapper.appendChild(tableEl);
}

export function makeSortable(tableEl) {
  if (!tableEl) return;
  if (tableEl.dataset.sortableInit === '1') return; // déjà initialisé
  tableEl.dataset.sortableInit = '1';
  tableEl.classList.add('sortable');

  const ths = Array.from(tableEl.querySelectorAll('thead th[data-sort]'));
  if (ths.length === 0) return;

  // État de tri partagé pour ce tableau
  const state = { colIdx: null, dir: 'asc' };

  // Ajout des flèches manquantes
  ths.forEach(th => {
    if (!th.querySelector('.sort-arrow')) {
      const span = document.createElement('span');
      span.className = 'sort-arrow';
      th.appendChild(span);
    }
  });

  // Click → toggle tri
  ths.forEach((th, idx) => {
    th.addEventListener('click', () => {
      if (state.colIdx === idx) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.colIdx = idx;
        state.dir = 'asc';
      }
      applySort(tableEl, state, ths);
    });
  });

  // Réapplique automatiquement le tri si le tbody est reconstruit
  const tbody = tableEl.querySelector('tbody');
  if (tbody) {
    const observer = new MutationObserver(() => {
      if (state.colIdx != null) applySort(tableEl, state, ths);
    });
    observer.observe(tbody, { childList: true });
  }
}

function applySort(tableEl, state, ths) {
  const tbody = tableEl.querySelector('tbody');
  if (!tbody || state.colIdx == null) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length === 0) return;
  const sign = state.dir === 'asc' ? 1 : -1;

  rows.sort((a, b) => {
    const va = cellSortValue(a.cells[state.colIdx]);
    const vb = cellSortValue(b.cells[state.colIdx]);
    let res;
    if (typeof va === 'number' && typeof vb === 'number') res = va - vb;
    else res = String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base' });
    return res * sign;
  });
  rows.forEach(r => tbody.appendChild(r));

  // MAJ des flèches
  ths.forEach((th, i) => {
    const a = th.querySelector('.sort-arrow');
    if (i === state.colIdx) {
      th.classList.add('sorted');
      if (a) a.textContent = state.dir === 'asc' ? ' ▲' : ' ▼';
    } else {
      th.classList.remove('sorted');
      if (a) a.textContent = '';
    }
  });
}

function cellSortValue(td) {
  if (!td) return '';
  // Valeur custom prioritaire si fournie
  if (td.dataset.sortValue != null) {
    const cv = td.dataset.sortValue;
    const cn = parseFloat(cv);
    return !isNaN(cn) && cv.trim() !== '' ? cn : cv;
  }
  const txt = td.textContent.trim();
  // Tente parse en nombre (gère "$", "1 234,56", "+12.5")
  const cleaned = txt.replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.');
  if (cleaned !== '' && cleaned !== '-' && cleaned !== '.' && /\d/.test(cleaned)) {
    const n = parseFloat(cleaned);
    if (!isNaN(n)) return n;
  }
  return txt;
}
