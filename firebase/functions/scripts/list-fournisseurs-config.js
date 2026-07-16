// Liste tous les patterns fournisseurs actuellement en /config/global.fournisseurs
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const cfgSnap = await db.collection('config').doc('global').get();
const patterns = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];

console.log(`${patterns.length} pattern(s) dans /config/global.fournisseurs :\n`);
for (const p of patterns) {
  console.log(`- ${p.id.padEnd(35)} | ${(p.matchType || '').padEnd(14)} | match="${p.matchValue}"`);
  console.log(`    label="${p.label}" categorie=${p.categorie} deductible=${p.deductible}`);
  console.log(`    raison: ${p.raisonClassification || '—'}`);
  console.log(`    ajoute par: ${p.ajoutePar || '?'} le ${p.dateAjout || '?'}\n`);
}

process.exit(0);
