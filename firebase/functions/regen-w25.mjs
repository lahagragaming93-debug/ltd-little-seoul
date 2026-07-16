// One-shot : rattache les paies versees en retard (lundi matin, patron malade) a la
// SEMAINE 25 et regenere l'onglet snapshot. Les paies versees apres la cloture comptent
// pour la semaine concernee (regle metier). Idempotent.
//
// Lancer : DASHBOARD_SA_KEY="$(firebase functions:secrets:access DASHBOARD_SA_KEY --project ltd-little-seoul-fa)" node regen-w25.mjs
import admin from 'firebase-admin';
import { google } from 'googleapis';
import { snapshotSheetSemaine } from './lib/snapshot-sheet-semaine.mjs';

const WEEK = '2026-06-15'; // lundi de la semaine 25 (= weekKey)
const SA = JSON.parse(process.env.DASHBOARD_SA_KEY);

admin.initializeApp({ credential: admin.credential.cert(SA) });
const db = admin.firestore();
const authClient = await new google.auth.GoogleAuth({ credentials: SA, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
const sheets = google.sheets({ version: 'v4', auth: authClient });

// 1. Rattacher les paies versees aujourd'hui (lundi 22/06) et NON encore taguees -> S25.
const since = admin.firestore.Timestamp.fromDate(new Date('2026-06-22T00:00:00.000Z'));
const recent = await db.collection('paies').where('timestamp', '>=', since).get();
const toTag = recent.docs.filter(d => !d.data().weekKeyAttribuee);
const batch = db.batch();
toTag.forEach(d => batch.update(d.ref, { weekKeyAttribuee: WEEK }));
if (toTag.length) await batch.commit();
console.log('Paies rattachees a S25 :', toTag.length);

// 2. Masse salariale S25 = somme des paies taguees S25 (idempotent), maj du doc /semaines.
const w25 = await db.collection('paies').where('weekKeyAttribuee', '==', WEEK).get();
const masse = w25.docs.reduce((s, d) => s + (Number(d.data().montant) || 0), 0);
const semRef = db.collection('semaines').doc(WEEK);
const sem = (await semRef.get()).data() || {};
const ca = Number(sem.ca) || 0;
const dep = Number(sem.depensesTotales ?? sem.depenses) || 0;
const beneficeNet = ca - dep - masse;
await semRef.set({ masseSalariale: masse, beneficeNet }, { merge: true });
console.log('Semaine 25 -> CA', ca, '| depenses', dep, '| masse', masse, '| benefice', beneficeNet, '| nb paies', w25.size);

// 3. Regenerer l'onglet snapshot S25 (reecrit l'onglet existant via le titre weekKey).
const weekDebut = new Date('2026-06-14T22:00:00.000Z');   // lundi 15/06 00h Paris
const weekFin = new Date('2026-06-21T21:59:59.999Z');     // dimanche 21/06 23h59 Paris
const semaineData = (await semRef.get()).data();
const res = await snapshotSheetSemaine({ db, sheets, weekKey: WEEK, weekDebut, weekFin, semaineData });
console.log('Snapshot regenere :', JSON.stringify(res));
process.exit(0);
