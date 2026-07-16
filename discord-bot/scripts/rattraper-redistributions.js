// ============================================================
// Rattrape les anciennes redistributions essence (#suivi-achat-essence)
// ============================================================
// Le canal #suivi-achat-essence n'a pas fetchOnStartup : tous les
// messages anterieurs au demarrage du bot ne sont pas dans la base.
// Ce script :
//   1. Se connecte avec le DISCORD_TOKEN du bot
//   2. Fetch les N derniers messages du canal (paginated, par 100)
//   3. Parse chaque message via parseRedistributionEmbed
//   4. ECRIT DIRECTEMENT dans Firestore via Admin SDK
//      (bypass botIngest/onRedistribution => ne TOUCHE PAS aux stations).
//      Le timestamp utilise est celui du message Discord original.
//
// IMPORTANT :
//   - Bypass le sync station (sinon le dernier doc rattrapé écraserait
//     le stockActuel de la station avec une vieille valeur).
//   - Pour eviter les doublons, utilise messageId comme docId.
//     Donc relancer = idempotent (overwrite mais pas de doublon).
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-redistributions.js              dry-run, 200 derniers
//   node scripts/rattraper-redistributions.js --apply      ecrit en base
//   node scripts/rattraper-redistributions.js --apply --limit 500
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseRedistributionEmbed } from '../parsers/essence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const CHANNEL_ID  = process.env.CH_SUIVI_ACHAT_ESSENCE;
const APPLY       = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const TOTAL_LIMIT = limitArgIdx > 0 ? Math.max(1, parseInt(process.argv[limitArgIdx + 1], 10) || 200) : 200;

const required = ['DISCORD_TOKEN', 'CH_SUIVI_ACHAT_ESSENCE'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Variable d'environnement manquante : ${k}`);
    process.exit(1);
  }
}

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

async function fetchHistory(channel, totalLimit) {
  const all = [];
  let before;
  while (all.length < totalLimit) {
    const remaining = totalLimit - all.length;
    const opts = { limit: Math.min(100, remaining) };
    if (before) opts.before = before;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    for (const m of batch.values()) all.push(m);
    before = batch.last()?.id;
    if (batch.size < opts.limit) break;
  }
  return all;
}

function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY (ecrit dans Firestore)' : 'DRY-RUN'}`);
  console.log(`Canal : ${CHANNEL_ID}, max ${TOTAL_LIMIT} messages\n`);

  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch) throw new Error(`Canal ${CHANNEL_ID} introuvable`);
    console.log(`Canal trouve : #${ch.name}`);

    const messages = await fetchHistory(ch, TOTAL_LIMIT);
    console.log(`${messages.length} messages recuperes\n`);

    let parsed = 0, skipped = 0, written = 0, errors = 0;
    for (const m of messages) {
      try {
        const payload = parseRedistributionEmbed(m);
        if (!payload) { skipped++; continue; }
        parsed++;

        const date = new Date(m.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ');
        const tag  = `#${payload.id} ${payload.station || '???'}`.padEnd(35);
        console.log(`  ${date}  ${tag}  ${payload.litres} L @ ${payload.prixLitre}$ = ${payload.montant}$`);

        if (APPLY) {
          // Doc id = messageId Discord pour idempotence (relance = overwrite)
          await db.collection('redistributions').doc(m.id).set({
            redistributionId: payload.id,
            station: payload.station,
            stationId: payload.stationId || slug(payload.station),
            litres: payload.litres,
            prixLitre: payload.prixLitre,
            montant: payload.montant,
            stockAvant: payload.stockAvant,
            stockApres: payload.stockApres,
            niveau: payload.niveau,
            timestamp: Timestamp.fromDate(new Date(m.createdTimestamp)),
            source: 'rattrapage-script'
          });
          written++;
        }
      } catch (err) {
        console.error(`  ERREUR sur msg ${m.id} : ${err.message}`);
        errors++;
      }
    }

    console.log(`\nResume : ${messages.length} messages, ${parsed} redistributions, ${skipped} ignores (autres types), ${written} ecrites, ${errors} erreurs`);
    if (APPLY) {
      console.log(`\nDocs idempotents (id = messageId Discord). Relancer ce script ne cree PAS de doublons.`);
      console.log(`stations/{id}.stockActuel n'a PAS ete touche (bypass handler).`);
    } else if (parsed > 0) {
      console.log(`\nDry-run termine. Relance avec --apply pour ecrire dans /redistributions.`);
    }
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
