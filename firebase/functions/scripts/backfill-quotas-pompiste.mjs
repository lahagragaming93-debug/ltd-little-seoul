// ============================================================
// Backfill quotas pompiste — repare le shift UTC/Paris
// ============================================================
// Avant le fix de currentWeekId() (2026-05-19), les ravitaillements et
// declarations caoutchoucs faits entre lundi 00h-02h Paris etaient
// enregistres dans /quotasPompiste/{semaine_PRECEDENTE}_{uid} au lieu de
// la semaine en cours. Resultat : le pompiste voyait son quota a 0 sur
// /employee et sa paie estimee n'evoluait pas.
//
// Ce script :
//   1. Parcourt /redistributions (source='manuel-pompiste') et
//      /declarationsCaoutchouc (source='manuel-pompiste') sur les N
//      derniers jours.
//   2. Pour chaque doc, recalcule le weekKey Paris correct depuis
//      timestamp, et compare au quota effectivement enregistre.
//   3. Liste les ecarts (dry-run par defaut).
//   4. Avec --apply : reconstruit les docs /quotasPompiste depuis ZERO
//      pour les (semaine, pompiste) impactes. Tous les autres docs sont
//      laisses intacts.
//
// Usage :
//   node scripts/backfill-quotas-pompiste.mjs                # dry-run, 14 derniers jours
//   node scripts/backfill-quotas-pompiste.mjs --days=30      # dry-run, 30 jours
//   node scripts/backfill-quotas-pompiste.mjs --apply        # corrige
// ============================================================
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sa = JSON.parse(readFileSync(resolve(__dirname, '../../serviceAccountKey.json'), 'utf-8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const days = (() => {
  const a = args.find(x => x.startsWith('--days='));
  return a ? Math.max(1, parseInt(a.slice(7), 10) || 14) : 14;
})();

// === Calcul weekKey Paris depuis un Date (meme logique que currentWeekId fix) ===
function parisWeekKey(d) {
  const parisStr = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false });
  const wall = new Date(parisStr.replace(' ', 'T') + 'Z');
  const day = wall.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  wall.setUTCDate(wall.getUTCDate() + diff);
  wall.setUTCHours(0, 0, 0, 0);
  return wall.toISOString().slice(0, 10);
}
// === Calcul weekKey UTC (logique buguee historique) — utilisee pour info ===
function utcWeekKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x.toISOString().slice(0, 10);
}

const debut = new Date(Date.now() - days * 24 * 3600 * 1000);
const fin   = new Date();

console.log(`=== Backfill quotas pompiste ${APPLY ? '(APPLY)' : '(dry-run)'} ===`);
console.log(`Fenetre : ${debut.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}  ->  ${fin.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);

// === Charge sources de verite ===
const [redistSnap, decCaoutSnap] = await Promise.all([
  db.collection('redistributions')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .get(),
  db.collection('declarationsCaoutchouc')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .get()
]);

console.log(`Lues : ${redistSnap.size} redistribution(s), ${decCaoutSnap.size} declaration(s) caoutchoucs.\n`);

// === Recompose les quotas attendus par (weekKey Paris, pompisteId) ===
// Pour les bidons : on additionne `bidons` (peut etre decimal pour les
// ravitaillements en litres) des docs source='manuel-pompiste'.
// On ignore source='correction-pompiste' (ne fait pas evoluer le quota).
const attendu = new Map(); // key: `${weekKey}_${uid}` -> { weekKey, uid, bidons, caoutchoucs }

function bump(weekKey, uid, champ, valeur) {
  if (!uid) return;
  const k = `${weekKey}_${uid}`;
  if (!attendu.has(k)) attendu.set(k, { weekKey, uid, bidons: 0, caoutchoucs: 0 });
  attendu.get(k)[champ] += valeur;
}

let nbShiftedRedist = 0;
let nbShiftedCaout = 0;

for (const d of redistSnap.docs) {
  const r = d.data();
  if (r.source !== 'manuel-pompiste') continue;
  const ts = r.timestamp?.toDate?.();
  if (!ts) continue;
  const wkParis = parisWeekKey(ts);
  const wkUtc   = utcWeekKey(ts);
  if (wkParis !== wkUtc) nbShiftedRedist++;
  bump(wkParis, r.pompisteId, 'bidons', Number(r.bidons || 0));
}
for (const d of decCaoutSnap.docs) {
  const r = d.data();
  if (r.source !== 'manuel-pompiste') continue;
  const ts = r.timestamp?.toDate?.();
  if (!ts) continue;
  const wkParis = parisWeekKey(ts);
  const wkUtc   = utcWeekKey(ts);
  if (wkParis !== wkUtc) nbShiftedCaout++;
  bump(wkParis, r.pompisteId, 'caoutchoucs', Number(r.caoutchoucs || 0));
}

console.log(`Docs avec shift UTC/Paris detecte :`);
console.log(`  - redistributions : ${nbShiftedRedist}`);
console.log(`  - declarations caoutchoucs : ${nbShiftedCaout}\n`);

// === Charge les quotas existants pour les (weekKey, uid) impactes ===
const semainesImpactees = new Set([...attendu.values()].map(x => x.weekKey));
const ecarts = [];

// Charge users pour nom lisible
const usersSnap = await db.collection('users').get();
const userById = new Map(usersSnap.docs.map(d => [d.id, d.data()]));
function nomLisible(uid) {
  const u = userById.get(uid);
  if (!u) return uid;
  return `${u.prenom || ''} ${u.nom || ''}`.trim() || uid;
}

// On va aussi inspecter les quotas de la semaine PRECEDENTE qui ont peut
// etre ete pollues par un ravitaillement de la semaine actuelle (bug shift).
for (const weekKey of semainesImpactees) {
  const quotasSnap = await db.collection('quotasPompiste')
    .where('semaine', '==', weekKey)
    .get();
  const quotasById = new Map();
  for (const d of quotasSnap.docs) {
    const q = d.data();
    if (q.employeId) quotasById.set(q.employeId, { id: d.id, ...q });
  }
  // Compare attendu vs reel
  for (const [k, exp] of attendu.entries()) {
    if (exp.weekKey !== weekKey) continue;
    const r = quotasById.get(exp.uid) || { bidons: 0, caoutchoucs: 0 };
    const dB = (Number(r.bidons || 0)) - exp.bidons;
    const dC = (Number(r.caoutchoucs || 0)) - exp.caoutchoucs;
    // Tolerance : Number arithmetic float, +/- 0.001 acceptable
    if (Math.abs(dB) > 0.01 || Math.abs(dC) > 0.01) {
      ecarts.push({
        weekKey, uid: exp.uid, nom: nomLisible(exp.uid),
        bidonsAttendu: exp.bidons,        bidonsReel: Number(r.bidons || 0),
        caoutAttendu:  exp.caoutchoucs,   caoutReel:  Number(r.caoutchoucs || 0),
        deltaBidons: dB, deltaCaout: dC
      });
    }
  }
}

if (ecarts.length === 0) {
  console.log('Aucun ecart detecte. Tous les quotas sont coherents avec les sources de verite.');
  process.exit(0);
}

console.log(`=== ECARTS DETECTES : ${ecarts.length} ===\n`);
for (const e of ecarts) {
  console.log(`[${e.weekKey}] ${e.nom} (${e.uid})`);
  console.log(`   Bidons      reel=${e.bidonsReel.toFixed(2)}  attendu=${e.bidonsAttendu.toFixed(2)}  delta=${e.deltaBidons > 0 ? '+' : ''}${e.deltaBidons.toFixed(2)}`);
  console.log(`   Caoutchoucs reel=${e.caoutReel}             attendu=${e.caoutAttendu}             delta=${e.deltaCaout > 0 ? '+' : ''}${e.deltaCaout}`);
}

if (!APPLY) {
  console.log(`\n(dry-run : aucune ecriture. Relance avec --apply pour corriger.)`);
  process.exit(0);
}

// === APPLY : ecrit les quotas attendus (overwrite) ===
console.log(`\n=== APPLY : ecriture des ${ecarts.length} doc(s) /quotasPompiste ===`);
let ok = 0, err = 0;
for (const e of ecarts) {
  try {
    const docId = `${e.weekKey}_${e.uid}`;
    await db.collection('quotasPompiste').doc(docId).set({
      semaine: e.weekKey,
      employeId: e.uid,
      bidons: e.bidonsAttendu,
      caoutchoucs: e.caoutAttendu,
      backfillSourceMaj: 'backfill-quotas-pompiste-fix-utc',
      backfillDate: Timestamp.fromDate(new Date())
    }, { merge: true });
    ok++;
    console.log(`  OK ${docId}`);
  } catch (err2) {
    err++;
    console.error(`  ERR ${e.weekKey}_${e.uid}:`, err2?.message || err2);
  }
}
console.log(`\nTermine : ${ok} OK / ${err} erreur(s).`);
process.exit(err > 0 ? 1 : 0);
