// ============================================================
// Formatters — affichage cohérent dans toute l'application
// ============================================================

const NF_MONEY = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0, maximumFractionDigits: 0
});
const NF_MONEY_PRECIS = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const NF_DECIMAL = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0, maximumFractionDigits: 2
});

export function money(n)   { return (NF_MONEY.format(n ?? 0)) + ' $'; }
// Variante avec 2 decimales — pour prix au litre, prix unitaire, etc.
export function moneyPrecis(n) { return (NF_MONEY_PRECIS.format(n ?? 0)) + ' $'; }
export function num(n)     { return NF_DECIMAL.format(n ?? 0); }
export function pct(n, decimals = 0) {
  return (n ?? 0).toFixed(decimals) + ' %';
}
export function litres(n)  { return NF_MONEY.format(Math.round(n ?? 0)) + ' L'; }

const NF_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric'
});
const NF_DATETIME = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
});
const NF_TIME = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit', minute: '2-digit'
});

export function date(d)     { return d ? NF_DATE.format(toDate(d)) : '—'; }
export function datetime(d) { return d ? NF_DATETIME.format(toDate(d)) : '—'; }
export function time(d)     { return d ? NF_TIME.format(toDate(d)) : '—'; }

export function toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  if (typeof d.toDate === 'function') return d.toDate(); // Firestore Timestamp
  if (typeof d === 'number') return new Date(d);
  if (typeof d === 'string') return new Date(d);
  return null;
}

// === Semaine RP (lundi 00:00 → dimanche 23:59) ===
// La clôture s'effectue dimanche à 00:00, donc le dimanche appartient à la
// semaine SUIVANTE dans la logique de clôture. On garde ici la semaine ISO
// classique (lundi-dimanche) pour l'affichage et on documente la nuance.

export function startOfWeekRP(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 = dim, 1 = lun
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}
export function endOfWeekRP(d = new Date()) {
  const start = startOfWeekRP(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
// Cle YYYY-MM-DD en heure LOCALE (Paris cote navigateur user). A utiliser
// pour grouper des timestamps par jour ou stocker une date sans heure.
// Ne PAS utiliser toISOString().slice(0,10) qui convertit en UTC : en heure
// d'ete (CEST = UTC+2), les minuits/petites heures Paris tombent au jour
// d'avant en UTC, ce qui bucke les transactions sur la mauvaise journee
// et mismatch avec le serveur qui calcule en heure Paris.
export function dateKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function weekId(d = new Date()) {
  return dateKeyLocal(startOfWeekRP(d));
}

// Reconstruit la fenetre [lun 00:00 -> dim 23:59:59.999] d'une semaine arbitraire
// a partir de son weekKey (format YYYY-MM-DD = le lundi). Parse en local pour
// eviter le decalage UTC qui projetterait le lundi au dimanche d'avant.
export function weekRangeFromKey(weekKey) {
  if (!weekKey) return { debut: startOfWeekRP(), fin: endOfWeekRP() };
  const [y, m, d] = weekKey.split('-').map(Number);
  const debut = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 6);
  fin.setHours(23, 59, 59, 999);
  return { debut, fin };
}

// Numéro ISO 8601 de semaine (1-53). Algo standard : jeudi de la semaine
// décide de l'année ISO.
export function weekIsoNumber(d = new Date()) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
// Label semaine ISO. weekKey = "YYYY-MM-DD" du lundi.
//   weekIsoLabel('2026-05-11')                  -> "S20 2026"
//   weekIsoLabel('2026-05-11', { full: true })  -> "S20 2026 (11/05 → 17/05)"
//   weekIsoLabel('2026-05-11', { long: true })  -> "Semaine 20 du lundi 11/05 au dimanche 17/05/2026"
export function weekIsoLabel(weekKey, { full = false, long = false } = {}) {
  if (!weekKey) return '';
  const lundi = new Date(weekKey + 'T00:00:00');
  if (isNaN(lundi.getTime())) return String(weekKey);
  const num = weekIsoNumber(lundi);
  const annee = lundi.getFullYear();
  const dim = new Date(lundi);
  dim.setDate(dim.getDate() + 6);
  const ddmm = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
  const ddmmyyyy = (dt) => `${ddmm(dt)}/${dt.getFullYear()}`;
  if (long) return `Semaine ${num} du lundi ${ddmm(lundi)} au dimanche ${ddmmyyyy(dim)}`;
  if (full) return `S${num} ${annee} (${ddmm(lundi)} → ${ddmm(dim)})`;
  return `S${num} ${annee}`;
}

export function durationHM(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h${m.toString().padStart(2, '0')}`;
}

// === Normalisation noms employes ===
// Garantit que la detection bot/site matche meme si l'admin tape "ilyes chaifi"
// au lieu de "Ilyes CHAIFI". Respecte tirets et apostrophes : "marc-antoine"
// -> "Marc-Antoine", "o'brien" -> "O'Brien".
export function normalizePrenom(s) {
  return String(s ?? '').trim().toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
}
export function normalizeNom(s) {
  return String(s ?? '').trim().toUpperCase();
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
