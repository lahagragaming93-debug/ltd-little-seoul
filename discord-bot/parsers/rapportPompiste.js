// ============================================================
// Parser : #pompiste (rapport quotidien des stations)
// Format observé :
//   "Rapport 10/04/2026 : CA 0$ | 0 commandes | Niveaux stations :
//    Algonquin 54%, Cholla Springs 1%, Clinton Vinewood 3%,
//    Palomino Favélas 33%, Panorama Aérodrome 8%, Route 68 1%,
//    Route 68 LTD 3%, Senora Rex's 34%"
// ============================================================

import { firstEmbed, getMoney } from './_helpers.js';

// Mapping nom court (rapport) → ID Firestore station
// (les noms peuvent varier — on essaie plusieurs variantes)
const STATION_MAP = {
  'algonquin':           'algonquin-boulevard',
  'cholla springs':      'cholla-springs-avenue',
  'cholla':              'cholla-springs-avenue',
  'clinton':             'clinton-avenue-vinewood',
  'clinton vinewood':    'clinton-avenue-vinewood',
  'vinewood':            'clinton-avenue-vinewood',
  'palomino':            'palomino-freeway-favelas',
  'palomino favélas':    'palomino-freeway-favelas',
  'palomino favelas':    'palomino-freeway-favelas',
  'favélas':             'palomino-freeway-favelas',
  'favelas':             'palomino-freeway-favelas',
  'panorama':            'panorama-drive-aerodrome-little-seoul',
  'panorama aérodrome':  'panorama-drive-aerodrome-little-seoul',
  'panorama aerodrome':  'panorama-drive-aerodrome-little-seoul',
  'aérodrome':           'panorama-drive-aerodrome-little-seoul',
  'aerodrome':           'panorama-drive-aerodrome-little-seoul',
  'route 68':            'route-68',
  'route 68 ltd':        'route-68-ltd',
  'senora':              'senora-way-rex-s-diner',
  "senora rex's":        'senora-way-rex-s-diner',
  'senora rex':          'senora-way-rex-s-diner',
  'rex':                 'senora-way-rex-s-diner'
};

function normaliseStationName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function trouverStationId(nom) {
  const k = normaliseStationName(nom);
  // Match exact
  if (STATION_MAP[k]) return STATION_MAP[k];
  // Match partiel (le nom du rapport est inclus dans une clé)
  for (const [key, id] of Object.entries(STATION_MAP)) {
    if (k.includes(key) || key.includes(k)) return id;
  }
  return null;
}

export function parseRapportPompisteEmbed(msg) {
  const e = firstEmbed(msg);
  let texte;
  if (e) {
    texte = `${e.title || ''} ${e.description || ''}`;
    (e.fields || []).forEach(f => texte += ` ${f.name}: ${f.value}`);
  } else {
    texte = msg.content || '';
  }

  // Doit ressembler à un rapport pompiste
  if (!/rapport/i.test(texte) || !/niveaux?\s+stations?/i.test(texte)) return null;

  // Date du rapport (DD/MM/YYYY)
  const matchDate = texte.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dateRapport = matchDate ? matchDate[1] : '';

  // CA + nb commandes
  const ca = (() => {
    const m = texte.match(/ca\s*:?\s*([\d\s.,]+)\s*\$/i);
    return m ? getMoney(m[1]) : 0;
  })();
  const matchCmd = texte.match(/(\d+)\s+commandes?/i);
  const nbCommandes = matchCmd ? parseInt(matchCmd[1], 10) : 0;

  // Liste des stations avec leur niveau %
  // Pattern : "NomStation XX%" — séparés par virgule
  const sectionStations = (texte.split(/niveaux?\s+stations?\s*:?/i)[1] || '');
  const niveaux = []; // [{ stationId, nomBrut, niveauPct }, …]
  const matches = sectionStations.matchAll(/([\p{L}\d\s'.-]+?)\s+(\d+)\s*%/gu);
  for (const m of matches) {
    const nomBrut = m[1].trim().replace(/^,\s*/, '');
    const niveauPct = parseInt(m[2], 10);
    if (!Number.isFinite(niveauPct)) continue;
    const stationId = trouverStationId(nomBrut);
    niveaux.push({ stationId, nomBrut, niveauPct });
  }

  if (niveaux.length === 0) return null;

  return {
    dateRapport,
    ca,
    nbCommandes,
    niveaux
  };
}
