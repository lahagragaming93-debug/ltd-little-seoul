// ============================================================
// Liste toutes les ventes d'un vendeur sur une plage horaire
// ============================================================
// Usage :
//   node scripts/list-ventes-vendeur.js <vendeurUid> [debutISO] [finISO]
//   node scripts/list-ventes-vendeur.js rURqVvKF3xNDexBwlFHzrfoeWoW2 2026-05-13T21:00:00 2026-05-13T23:00:00
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const [vendeurUid, debutISO, finISO] = process.argv.slice(2);
if (!vendeurUid) {
  console.log('Usage : node list-ventes-vendeur.js <vendeurUid> [debutISO] [finISO]');
  process.exit(1);
}
const debut = debutISO ? new Date(debutISO) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
const fin   = finISO   ? new Date(finISO)   : new Date();

console.log(`Vendeur ${vendeurUid}`);
console.log(`Plage  : ${debut.toLocaleString('fr-FR')} → ${fin.toLocaleString('fr-FR')}\n`);

// Filtre client-side sur vendeurId pour eviter le besoin d'index composite
const snap = await db.collection('ventes')
  .where('timestamp', '>=', Timestamp.fromDate(debut))
  .where('timestamp', '<=', Timestamp.fromDate(fin))
  .orderBy('timestamp', 'asc')
  .get();

const matched = snap.docs.filter(d => d.data().vendeurId === vendeurUid);
console.log(`${matched.length} vente(s) pour ce vendeur sur la plage (${snap.size} tous vendeurs confondus)\n`);
console.log('Heure              | docId                     | factureId         | source    | montant | cli IG/decla    | flags');
console.log('-------------------+---------------------------+-------------------+-----------+---------+-----------------+------------------');
for (const d of matched) {
  const v = d.data();
  const ts = v.timestamp?.toDate?.()?.toLocaleString('fr-FR') || '?';
  const flags = [
    v.cachee ? 'cachee' : '',
    v.annulee ? 'annulee' : '',
    v.verrouille ? 'verr' : ''
  ].filter(Boolean).join(',') || '—';
  console.log(`${ts.padEnd(18)} | ${d.id.padEnd(25)} | ${String(v.factureId || '').padEnd(17)} | ${(v.source || '').padEnd(9)} | ${String(v.montant || 0).padStart(6)}$ | ${(v.client || '—').padEnd(15).slice(0,15)} | ${flags}`);
  if (v.remplaceeParId) console.log(`                   |  ↳ remplacee par ${v.remplaceeParId}`);
  if (v.factureBotId || v.factureBotRef)
    console.log(`                   |  ↳ declare la facture bot ${v.factureBotRef || v.factureBotId}`);
}

process.exit(0);
