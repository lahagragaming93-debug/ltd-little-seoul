// ============================================================
// Force le refresh des formules IMPORTDATA du Sheet Compta
// ============================================================
// Google Sheets met en cache les résultats de IMPORTDATA() pendant ~1h.
// Pour forcer un re-fetch immédiat depuis comptaExport, on doit modifier
// la formule (Sheets re-évalue uniquement si la formule change ou si la
// cellule est touchée).
//
// Technique : pour chaque cellule contenant IMPORTDATA, on :
//   1. Lit la formule actuelle
//   2. Vide la cellule
//   3. Ré-écrit la même formule
// Résultat : Sheets considère la cellule comme modifiée → re-fetch immédiat.
//
// Auth : service account Firebase (firebase-adminsdk-fbsvc@...). Doit être
// ajouté en Éditeur sur le Sheet manuellement (5 sec, fait une fois).
//
// Usage :
//   cd firebase/functions
//   node scripts/force-refresh-sheet.js
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');
const SHEET_ID = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  console.log(`Sheet : https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit\n`);

  // 1. Lire la structure du Sheet (onglets + dimensions)
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    includeGridData: false
  });
  const onglets = meta.data.sheets || [];
  console.log(`${onglets.length} onglet(s) trouvé(s) : ${onglets.map(s => s.properties.title).join(', ')}\n`);

  // 2. Pour chaque onglet, lire les cellules et identifier celles avec IMPORTDATA
  let trouvees = 0;
  let rafraichies = 0;

  for (const ong of onglets) {
    const title = ong.properties.title;
    const sheetId = ong.properties.sheetId;

    // Lecture FORMULES (pas valeurs) sur tout l'onglet en focus sur la 1re cellule
    // (IMPORTDATA est typiquement en A1 ou A2)
    const range = `${title}!A1:Z5`; // scan large mais raisonnable
    let formulas;
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range,
        valueRenderOption: 'FORMULA'
      });
      formulas = resp.data.values || [];
    } catch (e) {
      console.log(`  ⚠ ${title} : impossible de lire (${e.message})`);
      continue;
    }

    let foundInThisSheet = 0;
    for (let r = 0; r < formulas.length; r++) {
      for (let c = 0; c < (formulas[r] || []).length; c++) {
        const cell = formulas[r][c];
        if (typeof cell === 'string' && /IMPORTDATA\s*\(/i.test(cell)) {
          const a1 = `${title}!${String.fromCharCode(65 + c)}${r + 1}`;
          console.log(`  📍 Trouvé IMPORTDATA en ${a1}`);
          console.log(`     Formule : ${cell.slice(0, 80)}${cell.length > 80 ? '…' : ''}`);
          trouvees++;
          foundInThisSheet++;

          // FORCE REFRESH : on vide la cellule puis on remet la formule.
          try {
            // Étape 1 : vider
            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: a1,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [['']] }
            });
            // Petite pause pour laisser Sheets propager le clear
            await new Promise(r => setTimeout(r, 800));
            // Étape 2 : recoller la formule
            await sheets.spreadsheets.values.update({
              spreadsheetId: SHEET_ID,
              range: a1,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[cell]] }
            });
            console.log(`     ✓ Rafraîchi`);
            rafraichies++;
          } catch (e) {
            console.error(`     ✗ Erreur refresh : ${e.message}`);
          }
        }
      }
    }
    if (foundInThisSheet === 0) {
      console.log(`  · ${title} : aucun IMPORTDATA (onglet de données statiques)`);
    }
  }

  console.log(`\n✓ Terminé : ${trouvees} formule(s) IMPORTDATA trouvée(s), ${rafraichies} rafraîchie(s).`);
  console.log(`Le Sheet va maintenant re-fetcher les CSV depuis comptaExport (10-30 sec).\n`);

  process.exit(0);
}

main().catch(e => { console.error('Erreur fatale :', e.message); process.exit(2); });
