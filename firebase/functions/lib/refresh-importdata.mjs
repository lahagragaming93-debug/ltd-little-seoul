// ============================================================
// Module : force le re-fetch des formules IMPORTDATA d'un Google Sheet
// ============================================================
// Google Sheets met en cache le résultat de IMPORTDATA() de manière agressive
// (parfois plusieurs heures). Pour casser le cache de façon FIABLE on
// ajoute/met-à-jour un query param `_t={timestamp}` dans l'URL : Sheets
// considère l'URL comme nouvelle et déclenche un re-fetch immédiat.
//
// La Cloud Function `comptaExport` ignore les params autres que `token`
// et `type`, donc `_t` est inerte côté serveur.
//
// Utilisé par :
//   - refreshDashboardNow (bouton Comptabilité du site)
//   - cloturerSemaine (clôture hebdo)
// (PAS dans dashboardKeepAlive every-minute : trop agressif sur API Sheets.)
// ============================================================

export const SHEET_ID = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';

const SCAN_RANGE = 'A1:Z5';
const IMPORTDATA_RE = /IMPORTDATA\s*\(\s*"([^"]+)"\s*\)/i;

// Ajoute ou met à jour un query param _t={timestamp} dans une URL
function bustUrlCache(url, ts) {
  // Sépare query string et fragment
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = base.indexOf('?');
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const qs   = qIdx >= 0 ? base.slice(qIdx + 1) : '';
  const params = qs.split('&').filter(p => p && !/^_t=/.test(p));
  params.push(`_t=${ts}`);
  return `${path}?${params.join('&')}${hash}`;
}

export async function forceRefreshImportData({ sheets, sheetId = SHEET_ID }) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    includeGridData: false
  });
  const onglets = meta.data.sheets || [];
  const ts = Date.now();

  let trouvees = 0;
  let rafraichies = 0;

  for (const ong of onglets) {
    const title = ong.properties.title;
    const range = `'${title}'!${SCAN_RANGE}`;

    let formulas;
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range,
        valueRenderOption: 'FORMULA'
      });
      formulas = resp.data.values || [];
    } catch {
      continue;
    }

    for (let r = 0; r < formulas.length; r++) {
      for (let c = 0; c < (formulas[r] || []).length; c++) {
        const cell = formulas[r][c];
        if (typeof cell !== 'string') continue;
        const m = cell.match(IMPORTDATA_RE);
        if (!m) continue;

        trouvees++;
        const oldUrl = m[1];
        const newUrl = bustUrlCache(oldUrl, ts);
        const newFormula = `=IMPORTDATA("${newUrl}")`;
        const a1 = `'${title}'!${String.fromCharCode(65 + c)}${r + 1}`;

        try {
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: a1,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newFormula]] }
          });
          rafraichies++;
        } catch (e) {
          console.error(`[forceRefreshImportData] ${a1} erreur : ${e.message}`);
        }
      }
    }
  }

  return { trouvees, rafraichies };
}
