// ============================================================
// Rattrape les services depuis #logs-services + #suivi-service-vendeur
// ============================================================
// Le format Jessica "X a commence/termine son service" n'etait pas
// reconnu jusqu'au 2026-05-11 par l'ancien parser. Resultat : toutes
// les prises de service depuis la reprise (09/05) sont absentes de
// /services.
//
// Ce script :
//   1. Fetch l'historique Discord des 2 canaux (max 1000 msgs chacun)
//   2. Re-parse avec le parser corrige
//   3. Trie chronologiquement
//   4. Apparie start+end par employeNom
//   5. Ecrit dans /services avec docId 'srv-{msgIdEnd}' (idempotent)
//
// IDEMPOTENT : relance possible sans creer de doublons.
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-services.js          → dry-run
//   node scripts/rattraper-services.js --apply  → ecrit
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseServiceEmbed } from '../parsers/service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const APPLY = process.argv.includes('--apply');
const REPRISE_DATE = new Date('2026-05-09T00:00:00');
const CHANNELS = [
  { id: process.env.CH_LOGS_SERVICES, name: 'logs-services' },
  { id: process.env.CH_SUIVI_SERVICE_VENDEUR, name: 'suivi-service-vendeur' }
].filter(c => c.id);

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN manquant dans .env");
  process.exit(1);
}

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

async function fetchHistory(channel, total = 1000) {
  const all = [];
  let before;
  while (all.length < total) {
    const opts = { limit: Math.min(100, total - all.length) };
    if (before) opts.before = before;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    for (const m of batch.values()) all.push(m);
    before = batch.last()?.id;
    if (batch.size < opts.limit) break;
  }
  return all;
}

// Resolution uid via prenom+nom (UPPER) + 2 tentatives de split
const userCache = new Map();
async function resolveUid(employeNom) {
  if (!employeNom) return null;
  if (userCache.has(employeNom)) return userCache.get(employeNom);
  const parts = employeNom.trim().split(/\s+/);
  if (parts.length < 2) { userCache.set(employeNom, null); return null; }
  // Tentative 1 : prenom = 1er mot, nom = reste UPPER
  let snap = await db.collection('users')
    .where('prenom', '==', parts[0])
    .where('nom', '==', parts.slice(1).join(' ').toUpperCase()).limit(1).get();
  // Tentative 2 : prenom = N-1 mots, nom = dernier UPPER
  if (snap.empty && parts.length >= 3) {
    snap = await db.collection('users')
      .where('prenom', '==', parts.slice(0, -1).join(' '))
      .where('nom', '==', parts[parts.length - 1].toUpperCase()).limit(1).get();
  }
  const uid = snap.empty ? null : snap.docs[0].id;
  userCache.set(employeNom, uid);
  return uid;
}

client.once('ready', async () => {
  console.log(`Connecte: ${client.user.tag} | Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Filtre date >= ${REPRISE_DATE.toISOString().slice(0, 10)}\n`);

  // 1) Fetch + parse tous les events des 2 canaux
  const events = [];
  for (const ch of CHANNELS) {
    try {
      const channel = await client.channels.fetch(ch.id);
      console.log(`Fetch #${channel.name}...`);
      const msgs = await fetchHistory(channel, 1000);
      console.log(`  ${msgs.length} msgs`);
      for (const m of msgs) {
        const ts = new Date(m.createdTimestamp);
        if (ts < REPRISE_DATE) continue;
        const payload = parseServiceEmbed(m);
        if (!payload) continue;
        events.push({ ...payload, msgId: m.id, ts, channel: ch.name });
      }
    } catch (e) {
      console.error(`  ERR #${ch.name}:`, e.message);
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  console.log(`\n${events.length} events parses (chronologique)\n`);

  // 2) Apparier start+end par employeNom
  const openByName = new Map();  // employeNom -> { ts, msgId }
  const pairs = [];
  const unpaired = [];

  for (const e of events) {
    if (e.action === 'start') {
      if (openByName.has(e.employeNom)) {
        // start sans end precedent -> on remplace (le dernier prevaut)
        unpaired.push({ ...openByName.get(e.employeNom), employeNom: e.employeNom, reason: 'start ecrasee' });
      }
      openByName.set(e.employeNom, { ts: e.ts, msgIdStart: e.msgId });
    } else if (e.action === 'end') {
      const open = openByName.get(e.employeNom);
      if (open) {
        pairs.push({
          employeNom: e.employeNom,
          debut: open.ts,
          fin: e.ts,
          duree: e.ts.getTime() - open.ts.getTime(),
          msgIdEnd: e.msgId,
          msgIdStart: open.msgIdStart
        });
        openByName.delete(e.employeNom);
      } else {
        unpaired.push({ ts: e.ts, employeNom: e.employeNom, reason: 'end sans start' });
      }
    }
  }

  console.log(`Paires start+end : ${pairs.length}`);
  console.log(`Events orphelins  : ${unpaired.length} (services encore ouverts ou end sans start)\n`);

  // 3) Skip doublons (dedup via docId 'srv-{msgIdEnd}') + resolution uid
  let written = 0, skipped = 0, errors = 0, unresolved = 0;
  for (const p of pairs) {
    const docId = `srv-${p.msgIdEnd}`;
    const ref = db.collection('services').doc(docId);
    const exists = await ref.get();
    if (exists.exists) { skipped++; continue; }

    const uid = await resolveUid(p.employeNom);
    const dureeMin = Math.round(p.duree / 60000);
    if (!uid) {
      console.log(`  ? ${p.employeNom.padEnd(25)} ${dureeMin} min — uid NON RESOLU (pas dans /users)`);
      unresolved++;
      continue;
    }

    console.log(`  ${APPLY ? '+' : '~'} ${p.employeNom.padEnd(25)} ${String(dureeMin).padStart(4)} min  uid=${uid}  ${p.debut.toISOString().slice(0, 16)}`);
    if (!APPLY) continue;

    try {
      await ref.set({
        employeId: uid,
        employeNom: p.employeNom,
        debut: Timestamp.fromDate(p.debut),
        fin: Timestamp.fromDate(p.fin),
        duree: p.duree,
        source: 'rattrapage-services-2026-05-11'
      });
      written++;
    } catch (e) {
      console.error(`  ERR ${docId}:`, e.message);
      errors++;
    }
  }

  console.log(`\nResume :`);
  console.log(`  ${pairs.length} paires`);
  console.log(`  ${skipped} skippes (deja en base)`);
  console.log(`  ${unresolved} uid non resolu (employes inconnus du /users)`);
  console.log(`  ${written} ecrits dans /services`);
  console.log(`  ${errors} erreurs`);
  if (!APPLY) console.log('\nDry-run. Relance avec --apply.');

  process.exit(errors > 0 ? 1 : 0);
});

client.login(process.env.DISCORD_TOKEN);
