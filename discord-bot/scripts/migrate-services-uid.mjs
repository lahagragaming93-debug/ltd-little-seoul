// ============================================================
// Migration one-shot : re-cle les docs /services et /servicesOuverts dont
// employeId est un characterId FlashFA brut (ex. "141970") vers l'UID du
// compte /users, pour que le front (rh.js, employee.js — match strict
// services.employeId === uid) retrouve les heures. Cf fix onService 23/07.
//
// Resolution par fiche : idPerso (string OU number) > idDiscord > nom RP
// (norm accents/casse, 2 ordres prenom/nom). Au passage, pose idPerso sur les
// fiches matchees par nom qui ne l'ont pas (auto-guerison des prochains logs).
// Les sessions non resolues (fiche pas encore creee) sont laissees telles
// quelles — relancer ce script apres creation des comptes.
//
// Usage :
//   node scripts/migrate-services-uid.mjs           (dry-run)
//   node scripts/migrate-services-uid.mjs --apply
// ============================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('../../firebase/serviceAccountKey.json')) });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

(async () => {
  const usersSnap = await db.collection('users').get();
  const uids = new Set(usersSnap.docs.map(d => d.id));
  const byIdPerso = new Map(), byIdDiscord = new Map(), byName = new Map();
  for (const d of usersSnap.docs) {
    const u = d.data();
    if (u.idPerso !== undefined && u.idPerso !== null && u.idPerso !== '' && u.idPerso !== '-') byIdPerso.set(String(u.idPerso), d);
    if (u.idDiscord) byIdDiscord.set(String(u.idDiscord), d);
    if (u.prenom || u.nom) {
      byName.set(norm(u.prenom) + '|' + norm(u.nom), d);
      byName.set(norm(u.nom) + '|' + norm(u.prenom), d);
    }
  }
  function resolve(employeId, employeNom) {
    if (employeId && byIdPerso.has(String(employeId))) return byIdPerso.get(String(employeId));
    if (employeId && byIdDiscord.has(String(employeId))) return byIdDiscord.get(String(employeId));
    const parts = String(employeNom || '').trim().split(/\s+/);
    if (parts.length >= 2) {
      const cands = [
        norm(parts[0]) + '|' + norm(parts.slice(1).join(' ')),
        norm(parts.slice(0, -1).join(' ')) + '|' + norm(parts.at(-1))
      ];
      for (const c of cands) if (byName.has(c)) return byName.get(c);
    }
    return null;
  }

  for (const coll of ['services', 'servicesOuverts']) {
    const snap = await db.collection(coll).get();
    let ok = 0, deja = 0, orphelin = 0;
    for (const d of snap.docs) {
      const x = d.data();
      if (uids.has(String(x.employeId))) { deja++; continue; }
      const fiche = resolve(x.employeId, x.employeNom);
      if (!fiche) { orphelin++; console.log(`[orphelin] ${coll}/${d.id} · ${x.employeNom || '?'} · employeId=${x.employeId}`); continue; }
      ok++;
      console.log(`[${APPLY ? 'MIGRE' : 'dry-run'}] ${coll}/${d.id} · ${x.employeNom || '?'} · ${x.employeId} -> ${fiche.id} (${fiche.data().prenom} ${fiche.data().nom})`);
      if (APPLY) {
        await d.ref.set({ employeId: fiche.id, employeIdPerso: String(x.employeId || '') }, { merge: true });
        if (!fiche.data().idPerso || fiche.data().idPerso === '-') {
          await fiche.ref.set({ idPerso: String(x.employeId || '') }, { merge: true });
          console.log(`         + idPerso=${x.employeId} pose sur la fiche ${fiche.id}`);
        }
      }
    }
    console.log(`== ${coll} : ${snap.size} docs · ${deja} deja en UID · ${ok} ${APPLY ? 'migres' : 'a migrer'} · ${orphelin} orphelins (fiche absente) ==\n`);
  }
  if (!APPLY) console.log('DRY-RUN — relancer avec --apply.');
  process.exit(0);
})();
