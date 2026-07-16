// ============================================================
// Script d'initialisation — stations Firestore depuis releve
// in-game 2026-05-10 (stocks + prix communiques par le patron).
// ============================================================
// Usage :
//   1. Avoir firebase/serviceAccountKey.json (cf. init-stocks.js).
//   2. cd firebase/functions
//   3. node scripts/init-stations.js          → dry-run
//   4. node scripts/init-stations.js --apply  → ecrit dans Firestore
// ============================================================
// Note : ne touche PAS au seuilAlerte (laisse l'existant).
// IDs Firestore = slug(nom) — meme logique que stationsDashboard.js.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../serviceAccountKey.json');

// Slugifie comme stationsDashboard.js (apostrophes -> '-', diacritiques retires)
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

// === Donnees source — releve in-game 2026-05-10 ===
const STATIONS = [
  { nom: "Senora Way - Rex's Dîner",                  stockActuel:    0, stockMax: 10000, prixLitre: 5.00 },
  { nom: "Route 68 LTD",                              stockActuel:    0, stockMax:  7500, prixLitre: 5.00 },
  { nom: "Route 68",                                  stockActuel:    0, stockMax: 10000, prixLitre: 5.00 },
  { nom: "Panorama Drive - Aérodrome Little Seoul",   stockActuel: 2000, stockMax:  5000, prixLitre: 5.00 },
  { nom: "Palomino Freeway - Favélas",                stockActuel:    0, stockMax: 15000, prixLitre: 6.00 },
  { nom: "Clinton Avenue - Vinewood",                 stockActuel:    0, stockMax: 15000, prixLitre: 5.50 },
  { nom: "Algonquin Boulevard",                       stockActuel: 3367, stockMax:  5000, prixLitre: 4.50 },
  { nom: "Cholla Springs Avenue",                     stockActuel: 4506, stockMax:  5000, prixLitre: 4.50 }
];

const APPLY = process.argv.includes('--apply');

function loadServiceAccount() {
  try {
    return JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  } catch (err) {
    console.error(`\nImpossible de lire ${KEY_PATH}`);
    console.error(`Telecharge la cle depuis Firebase Console > Project Settings > Service accounts.`);
    console.error(`Erreur: ${err.message}\n`);
    process.exit(1);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log(`Init stations Firestore — ${APPLY ? 'APPLY' : 'DRY-RUN (utilise --apply pour ecrire)'}`);
  console.log('='.repeat(60));
  console.log(`${STATIONS.length} stations a synchroniser`);
  console.log('');

  for (const s of STATIONS) {
    const id = slugStation(s.nom);
    const ligne = `${id.padEnd(40)} ${String(s.stockActuel).padStart(5)}/${String(s.stockMax).padEnd(5)} L  @  ${s.prixLitre.toFixed(2)} $/L`;
    console.log(`  ${ligne}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry-run termine. Relance avec --apply pour ecrire.');
    process.exit(0);
  }

  const sa = loadServiceAccount();
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id
  });
  const db = getFirestore();

  let okCount = 0;
  let errCount = 0;
  for (const s of STATIONS) {
    const id = slugStation(s.nom);
    try {
      await db.collection('stations').doc(id).set({
        nom:         s.nom,
        stockActuel: s.stockActuel,
        stockMax:    s.stockMax,
        prixLitre:   s.prixLitre,
        derniereMajAuto: FieldValue.serverTimestamp(),
        sourceMajAuto:   'init-stations-2026-05-10'
      }, { merge: true });
      okCount++;
      process.stdout.write(`. `);
    } catch (err) {
      errCount++;
      console.error(`\nERR ${id}: ${err.message}`);
    }
  }
  console.log(`\n\nDone: ${okCount} ecrits, ${errCount} erreurs.`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
