import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const __dirname = dirname(fileURLToPath(import.meta.url));
const sa = JSON.parse(readFileSync(resolve(__dirname, '../../serviceAccountKey.json'), 'utf-8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const snap = await getFirestore().collection('users').get();
snap.forEach(d => {
  const u = d.data();
  console.log(`${d.id.padEnd(30)} ${(u.prenom || '').padEnd(15)} ${(u.nom || '').padEnd(15)} role=${u.role}`);
});
process.exit(0);
