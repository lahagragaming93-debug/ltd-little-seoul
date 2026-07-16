// ============================================================
// Util réutilisable : sélecteur de période pour les KPI
// ============================================================
// Usage typique sur une page avec KPI :
//
//   import { renderPeriodFilter, getPeriode, attachPeriodFilter }
//     from '../utils/period-filter.js';
//
//   // 1. Insérer le sélecteur dans le HTML de la page
//   <div class="page-toolbar">${renderPeriodFilter('semaine')}</div>
//
//   // 2. Brancher : recharger quand la période change
//   attachPeriodFilter(() => chargerTout());
//
//   // 3. Récupérer les bornes pour les requêtes Firestore
//   const { debut, fin, label } = getPeriode();
//   //   - debut/fin : Date | null (null => pas de borne = depuis ouverture)
//   //   - label : string lisible pour affichage UI (format long si week:XXX)
// ============================================================

import { weekIsoLabel, weekRangeFromKey } from './formatters.js';

export const PERIODES = [
  { value: 'semaine',   label: 'Cette semaine',     compute: () => ({ debut: startOfWeek(), fin: now() }) },
  { value: 'semaine-1', label: 'Semaine dernière',  compute: () => weekRangeFromMondayOffset(-7) },
  { value: 'mois',      label: 'Ce mois',           compute: () => ({ debut: startOfMonth(), fin: now() }) },
  { value: '30j',       label: '30 derniers jours', compute: () => ({ debut: nDaysAgo(30), fin: now() }) },
  { value: 'ouverture', label: 'Depuis ouverture',  compute: () => ({ debut: null, fin: null }) },
  { value: 'custom',    label: 'Personnalisé',      compute: customRange }
];

function weekRangeFromMondayOffset(daysOffset) {
  const lundi = startOfWeek();
  lundi.setDate(lundi.getDate() + daysOffset);
  const fin = new Date(lundi);
  fin.setDate(fin.getDate() + 6);
  fin.setHours(23, 59, 59, 999);
  return { debut: lundi, fin };
}

function now() { return new Date(); }

function startOfWeek() {
  // Lundi 00:00 Europe/Paris (cohérent avec startOfWeekRP côté backend)
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function nDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function customRange() {
  const debut = document.getElementById('period-date-debut')?.value;
  const fin   = document.getElementById('period-date-fin')?.value;
  if (!debut || !fin) return { debut: null, fin: null };
  return {
    debut: new Date(debut + 'T00:00:00'),
    fin:   new Date(fin   + 'T23:59:59.999')
  };
}

export function renderPeriodFilter(defaultValue = 'semaine') {
  const options = PERIODES.map(p =>
    `<option value="${p.value}"${p.value === defaultValue ? ' selected' : ''}>${p.label}</option>`
  ).join('');
  return `
    <select id="filtre-periode" title="Période à analyser pour les KPI">${options}</select>
    <span id="period-custom-range" class="hidden" style="display:none;gap:6px;align-items:center;">
      <input type="date" id="period-date-debut" />
      <span>→</span>
      <input type="date" id="period-date-fin" />
      <button class="btn btn-sm" id="period-custom-apply">Appliquer</button>
    </span>
  `;
}

export function getPeriode() {
  const sel = document.getElementById('filtre-periode');
  const filtre = sel?.value || 'semaine';
  // Valeur dynamique "week:YYYY-MM-DD" (semaine historique choisie)
  if (filtre.startsWith('week:')) {
    const weekKey = filtre.slice(5);
    const { debut, fin } = weekRangeFromKey(weekKey);
    return { debut, fin, label: weekIsoLabel(weekKey, { long: true }) };
  }
  const periode = PERIODES.find(p => p.value === filtre);
  if (!periode) return { debut: null, fin: null, label: 'Inconnu' };
  const { debut, fin } = periode.compute();
  return { debut, fin, label: periode.label };
}

// Renvoie un label lisible pour afficher la période actuellement chargée
// dans un sous-titre ou un KPI delta.
export function getPeriodeLabel() {
  const { debut, fin, label } = getPeriode();
  if (!debut || !fin) return label; // "Depuis ouverture" ou "Inconnu"
  const sel = document.getElementById('filtre-periode');
  // Format long déjà inclus dans `label` pour week:XXX et semaine-1
  if (sel?.value?.startsWith('week:')) return label;
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${label} (${fmt(debut)} → ${fmt(fin)})`;
}

// Branche le changement de filtre. Appelle onChange() à chaque modification
// validée (pour les périodes prédéfinies = au change immédiat, pour "Personnalisé"
// = au clic sur Appliquer une fois les 2 dates renseignées).
export function attachPeriodFilter(onChange) {
  const select = document.getElementById('filtre-periode');
  const customRange = document.getElementById('period-custom-range');
  const applyBtn = document.getElementById('period-custom-apply');

  if (!select) return;

  select.addEventListener('change', () => {
    if (select.value === 'custom') {
      customRange.style.display = 'inline-flex';
      customRange.classList.remove('hidden');
      // Pré-remplit le custom avec les 30 derniers jours par défaut
      if (!document.getElementById('period-date-debut').value) {
        const d30 = nDaysAgo(30);
        document.getElementById('period-date-debut').value = d30.toISOString().slice(0, 10);
        document.getElementById('period-date-fin').value   = new Date().toISOString().slice(0, 10);
      }
    } else {
      customRange.style.display = 'none';
      customRange.classList.add('hidden');
      onChange?.();
    }
  });

  applyBtn?.addEventListener('click', () => {
    const debut = document.getElementById('period-date-debut').value;
    const fin   = document.getElementById('period-date-fin').value;
    if (!debut || !fin) return;
    onChange?.();
  });
}
