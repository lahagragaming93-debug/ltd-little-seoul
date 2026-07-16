// ============================================================
// One-shot : force tous les comptes a se reconnecter
// ============================================================
// Usage :
//   cd firebase/functions
//   node scripts/force-relogin-all.mjs           → dry-run (liste les users)
//   node scripts/force-relogin-all.mjs --apply   → execute
// ============================================================
// Mecanisme :
//   1. Pour chaque user actif (sauf patron / co-patron / admin-technique) :
//      a) auth.updateUser(uid, { disabled: true })  → coupe la session active
//      b) attend 800ms (laisse le client detecter la deco et signOut)
//      c) auth.updateUser(uid, { disabled: false }) → permet la reconnexion
//   2. Le client se retrouve sur login.html et refetch HTML/JS frais
//
// Securite :
//   - Patron / Co-Patron / Admin-Technique JAMAIS desactives (risque de
//     se retrouver bloque hors du site)
//   - try/finally pour ne pas laisser un user en disabled si crash
//   - Loop sequentiel (pas Promise.all) pour ne pas surcharger Firebase Auth
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../serviceAccountKey.json');
const APPLY     = process.argv.includes('--apply');

const ROLES_PROTEGES = new Set(['patron', 'co-patron', 'admin-technique']);

initializeApp({ credential: cert(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
const db = getFirestore();
const auth = getAuth();

const usersSnap = await db.collection('users').where('statut', '==', 'actif').get();
const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

const cibles = users.filter(u => !ROLES_PROTEGES.has(u.role));
const proteges = users.filter(u => ROLES_PROTEGES.has(u.role));

console.log('[force-relogin] mode :', APPLY ? 'APPLY' : 'DRY-RUN');
console.log('[force-relogin] cibles  :', cibles.length, '(seront forces a se reconnecter)');
cibles.forEach(u => console.log(`  ${u.id.slice(0,12)}…  ${u.role.padEnd(28)}  ${u.prenom || ''} ${u.nom || ''}`));
console.log('[force-relogin] proteges:', proteges.length, '(jamais touches)');
proteges.forEach(u => console.log(`  ${u.id.slice(0,12)}…  ${u.role.padEnd(28)}  ${u.prenom || ''} ${u.nom || ''}`));

if (!APPLY) {
  console.log('');
  console.log('[force-relogin] dry-run termine. Ajoute --apply pour executer.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const u of cibles) {
  try {
    await auth.updateUser(u.id, { disabled: true });
    await new Promise(r => setTimeout(r, 800));
    await auth.updateUser(u.id, { disabled: false });
    console.log(`  ✓ ${u.prenom || ''} ${u.nom || ''} (${u.role}) force-deco`);
    ok++;
  } catch (err) {
    fail++;
    console.error(`  ✗ ${u.prenom || ''} ${u.nom || ''} (${u.id.slice(0,12)}) :`, err?.message || err);
    // Tentative de rattrapage : reactiver si on a disabled puis crash
    try { await auth.updateUser(u.id, { disabled: false }); } catch {}
  }
}

console.log('');
console.log(`[force-relogin] termine : ${ok} OK, ${fail} echec.`);
process.exit(fail > 0 ? 1 : 0);
