// Liste les produits du catalogue avec prixAchat / prixVente / aliases
// pour preparer un parser de raison.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sa = JSON.parse(readFileSync(resolve(__dirname, '../../serviceAccountKey.json'), 'utf-8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });

const db = getFirestore();
const snap = await db.collection('produits').orderBy('nom').get();
console.log(`${snap.size} produits dans le catalogue\n`);
console.log('id'.padEnd(28) + ' | ' + 'nom'.padEnd(35) + ' | ' + 'cat'.padEnd(18) + ' | achat | vente | aliases');
console.log('-'.repeat(140));
for (const d of snap.docs) {
  const p = d.data();
  console.log(
    d.id.padEnd(28) + ' | ' +
    (p.nom || '').slice(0, 35).padEnd(35) + ' | ' +
    (p.categorie || '').padEnd(18) + ' | ' +
    String(p.prixAchat ?? '?').padStart(5) + ' | ' +
    String(p.prixVente ?? '?').padStart(5) + ' | ' +
    (Array.isArray(p.aliases) ? p.aliases.join(', ') : '')
  );
}
process.exit(0);
