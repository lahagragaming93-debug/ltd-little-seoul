// ============================================================
// Parser : #⛽ Station — dashboard auto-rafraîchi LTD
// ============================================================
// Format : 1 seul message édité en place par le bot Direction LTD,
// portant 8 embeds (1 par station). Chaque embed :
//   title  : "{emoji} {nom_station}"   (emoji ∈ 🟢 🟡 🔴)
//   field "📊 Stock"        : "{barre} **{pct}%}\n{stock} L / {capacite} L"
//   field "💰 Prix du litre" : "**{prix} $/L**"
//   field "⏱ Dernier ravit." : "{dd/mm/yyyy à hh:mm}"
// ============================================================
// IMPORTANT : ce parser doit aussi être déclenché sur Events.MessageUpdate
// (le bot Direction édite le même message), pas seulement MessageCreate.
// ============================================================

import { firstEmbed, getMoney } from './_helpers.js';

const STATUT_MAP = {
  '🟢': 'vert',
  '🟡': 'jaune',
  '🔴': 'rouge'
};

// Slugifie le nom de station vers un ID Firestore stable.
// "Senora Way - Rex's Dîner" → "senora-way-rex-s-diner"
function slugStation(nom) {
  return String(nom || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/['’]/g, '-')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Extrait emoji + nom propre depuis le title "🟡 Algonquin Boulevard"
function parseTitle(title) {
  const t = String(title || '').trim();
  // Cherche un emoji statut connu en tête
  for (const emoji of Object.keys(STATUT_MAP)) {
    if (t.startsWith(emoji)) {
      return { statut: STATUT_MAP[emoji], nom: t.slice(emoji.length).trim() };
    }
  }
  return { statut: null, nom: t };
}

// Parse le field "📊 Stock" : "█████░░░░░ **53%**\n2 671 L / 5 000 L"
function parseStock(value) {
  const s = String(value || '');
  const matchPct = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const matchLitres = s.match(/([\d\s.,]+)\s*L\s*\/\s*([\d\s.,]+)\s*L/i);
  return {
    niveauPct: matchPct ? parseFloat(matchPct[1].replace(',', '.')) : null,
    stockActuel: matchLitres ? parseInt(matchLitres[1].replace(/[^\d]/g, ''), 10) : null,
    stockMax:    matchLitres ? parseInt(matchLitres[2].replace(/[^\d]/g, ''), 10) : null
  };
}

function parsePrix(value) {
  const m = String(value || '').match(/(\d+(?:[.,]\d+)?)\s*\$\s*\/\s*L/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

function parseRavit(value) {
  // "06/04/2026 à 23:30" → ISO
  const m = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+à\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '00', mi = '00'] = m;
  // Format YYYY-MM-DDTHH:mm:00 — laissé en string pour Firestore (interprété en heure locale RP)
  return `${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi.padStart(2, '0')}:00`;
}

function getEmbedField(embed, ...names) {
  if (!embed?.fields) return null;
  for (const f of embed.fields) {
    const fn = String(f.name || '').toLowerCase();
    for (const n of names) {
      if (fn.includes(n.toLowerCase())) return f.value;
    }
  }
  return null;
}

export function parseStationsDashboardMessage(msg) {
  if (!msg?.embeds || msg.embeds.length === 0) return null;

  const stations = [];
  for (const e of msg.embeds) {
    const title = e.title || '';
    if (!title) continue;
    // Test de format : doit commencer par un emoji statut connu
    const isDashboard = Object.keys(STATUT_MAP).some(em => title.startsWith(em));
    if (!isDashboard) continue;

    const stockField = getEmbedField(e, 'stock');
    if (!stockField) continue; // pas un embed station

    const { statut, nom } = parseTitle(title);
    const { niveauPct, stockActuel, stockMax } = parseStock(stockField);
    const prixLitre     = parsePrix(getEmbedField(e, 'prix'));
    const derniereRavit = parseRavit(getEmbedField(e, 'ravit', 'dernier'));

    if (!nom || stockActuel == null || stockMax == null) continue;

    stations.push({
      stationId: slugStation(nom),
      nom,
      statut,
      stockActuel,
      stockMax,
      niveauPct,
      prixLitre,
      derniereRavit
    });
  }

  if (stations.length === 0) return null;
  return { stations, messageId: msg.id };
}
