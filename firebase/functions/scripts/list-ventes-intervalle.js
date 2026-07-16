// Liste les ventes /ventes dans un intervalle de timestamp (Europe/Paris).
// Usage : node scripts/list-ventes-intervalle.js "2026-05-12T18:02+02:00" "2026-05-13T00:50+02:00"
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sa = JSON.parse(readFileSync(resolve(__dirname, '../../serviceAccountKey.json'), 'utf-8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });

const debut = new Date(process.argv[2]);
const fin   = new Date(process.argv[3]);
if (isNaN(debut) || isNaN(fin)) {
  console.error('Dates invalides. Format ISO avec timezone, ex: "2026-05-12T18:02+02:00"');
  process.exit(1);
}

const db = getFirestore();
const snap = await db.collection('ventes')
  .where('timestamp', '>=', Timestamp.fromDate(debut))
  .where('timestamp', '<=', Timestamp.fromDate(fin))
  .orderBy('timestamp', 'asc')
  .get();

console.log(`Periode : ${debut.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}  ->  ${fin.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
console.log(`Total : ${snap.size} vente(s)\n`);

const rows = [];
let caTotal = 0, benefTotal = 0;
for (const d of snap.docs) {
  const v = d.data();
  const ts = v.timestamp?.toDate ? v.timestamp.toDate() : null;
  const dateStr = ts ? ts.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '?';
  const fact = v.factureId || d.id;
  const vendeur = v.vendeurNom || '?';
  const client = v.client || '?';
  const montant = Number(v.montant || 0);
  const benef = Number(v.benefice || 0);
  const paiement = v.paiement || '';
  const raison = (v.raison || '').replace(/\s+/g, ' ').slice(0, 60);
  const source = v.source || 'discord';
  caTotal += montant;
  benefTotal += benef;
  rows.push({ docId: d.id, dateStr, fact, vendeur, client, montant, benef, paiement, raison, source });
}

// Tableau aligne
console.log('docId'.padEnd(28) + ' | ' +
            'Date'.padEnd(19) + ' | ' +
            'Facture'.padEnd(10) + ' | ' +
            'Vendeur'.padEnd(20) + ' | ' +
            'Client'.padEnd(20) + ' | ' +
            'Montant'.padStart(8) + ' | ' +
            'Benef'.padStart(7) + ' | ' +
            'Paiement'.padEnd(8) + ' | ' +
            'Source'.padEnd(10) + ' | Raison');
console.log('-'.repeat(170));
for (const r of rows) {
  console.log(
    r.docId.padEnd(28) + ' | ' +
    r.dateStr.padEnd(19) + ' | ' +
    String(r.fact).padEnd(10) + ' | ' +
    r.vendeur.padEnd(20) + ' | ' +
    r.client.padEnd(20) + ' | ' +
    String(r.montant).padStart(8) + ' | ' +
    String(r.benef).padStart(7) + ' | ' +
    r.paiement.padEnd(8) + ' | ' +
    r.source.padEnd(10) + ' | ' +
    r.raison
  );
}
console.log('-'.repeat(170));
console.log(`TOTAL :  CA=${caTotal} $  |  Benefice=${benefTotal} $`);
process.exit(0);
