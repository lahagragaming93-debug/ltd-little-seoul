// ============================================================
// Helpers ISO semaine — partagés backend
// ============================================================
// Extraits de dashboard-core.mjs / index.js pour eviter la triplication.
// Frontend equivalent : public/js/utils/formatters.js (a maintenir en
// miroir si la formule change).
//
// weekKey = "YYYY-MM-DD" du lundi de la semaine RP (Europe/Paris).
// ============================================================

// Numero ISO 8601 (1-53) pour une Date donnee.
export function weekIsoNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// Label court "S20 2026" (ou avec plage si full=true).
export function weekIsoLabel(weekKey, { full = false } = {}) {
  if (!weekKey) return '';
  const lundi = new Date(String(weekKey) + 'T00:00:00');
  if (isNaN(lundi.getTime())) return String(weekKey);
  const num = weekIsoNumber(lundi);
  const annee = lundi.getFullYear();
  if (!full) return `S${num} ${annee}`;
  const dim = new Date(lundi);
  dim.setDate(dim.getDate() + 6);
  const fmt = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
  return `S${num} ${annee} (${fmt(lundi)} → ${fmt(dim)})`;
}

// Mois en francais (1-12 -> nom long).
const MOIS_FR = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
];

// Titre d'onglet snapshot : "Semaine 20 (11-17 mai 2026)"
// Si le lundi et le dimanche sont dans des mois differents, on affiche les 2.
// Patch 2026-05-25 : ignore `debut` (en UTC reel, peut etre off-by-one au passage
// de jour Paris) et calcule TOUJOURS lundi depuis weekKey ("YYYY-MM-DD" du lundi
// RP Paris). Sinon snapshotSheetTitle renvoyait "Semaine 20 (18-23 mai)" pour
// weekKey=2026-05-18 quand debut etait en UTC = "2026-05-17T22:00Z".
export function snapshotSheetTitle(weekKey, debut, fin) {
  // Force le calcul a partir de weekKey, qui est en TZ Paris par construction.
  const lundi = new Date(String(weekKey) + 'T12:00:00'); // midi pour eviter edge DST
  const num = weekIsoNumber(lundi);
  const annee = lundi.getFullYear();
  const dDeb = lundi;
  const dimMidi = new Date(lundi);
  dimMidi.setDate(dimMidi.getDate() + 6);
  const dFin = dimMidi;
  // Extraction jour/mois cote Paris (les bornes sont stockees en UTC mais
  // correspondent a lundi 00h00 / dim 23h59 Paris).
  const partsDeb = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(dDeb);
  const partsFin = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(dFin);
  const get = (parts, t) => parts.find(p => p.type === t)?.value || '';
  const jDeb = get(partsDeb, 'day');
  const jFin = get(partsFin, 'day');
  const mDeb = Number(get(partsDeb, 'month'));
  const mFin = Number(get(partsFin, 'month'));
  const aFin = get(partsFin, 'year') || String(annee);
  if (mDeb === mFin) {
    return `Semaine ${num} (${jDeb}-${jFin} ${MOIS_FR[mDeb - 1]} ${aFin})`;
  }
  return `Semaine ${num} (${jDeb} ${MOIS_FR[mDeb - 1]} - ${jFin} ${MOIS_FR[mFin - 1]} ${aFin})`;
}
