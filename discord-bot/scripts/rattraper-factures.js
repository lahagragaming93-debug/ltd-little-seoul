// ============================================================
// Rattrape les anciennes factures depuis #factures
// ============================================================
// Le canal #factures (id 1441586772403294359) a le meme format que
// #suivi-facture mais n'etait pas parse jusqu'ici (juste stocke en
// raw pour audit). Comme l'entreprise a repris le 09/05, on rattrape
// uniquement les factures >= cette date pour peupler /ventes.
//
// Le script :
//   1. Connecte Discord avec DISCORD_TOKEN
//   2. Fetch les N derniers messages du canal (paginated 100)
//   3. Filtre par timestamp >= REPRISE_DATE (2026-05-09)
//   4. Parse via parseFactureEmbed
//   5. Resout vendeurId via /users (idDiscord -> uid Firebase)
//   6. Skip si factureId deja en base (dedup)
//   7. Ecrit dans /ventes via Admin SDK (bypass handler onFacture
//      pour ne pas declencher d'effets de bord cote Functions)
//
// IDEMPOTENT :
//   - DocId Firestore = `fac-{messageId}` (relance = overwrite)
//   - Skip si factureId deja present (cross-script avec #suivi-facture
//     temps reel qui utilise add() : si meme facture deja la, on saute)
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-factures.js                  dry-run, 500 msg
//   node scripts/rattraper-factures.js --apply
//   node scripts/rattraper-factures.js --apply --limit 1500
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseFactureEmbed } from '../parsers/facture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const CHANNEL_ID  = '1441586772403294359'; // #factures
const APPLY       = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const TOTAL_LIMIT = limitArgIdx > 0 ? Math.max(1, parseInt(process.argv[limitArgIdx + 1], 10) || 500) : 500;

// Date de reprise officielle du LTD par Morgan HARPER
const REPRISE_DATE = new Date('2026-05-09T00:00:00');

if (!process.env.DISCORD_TOKEN) {
  console.error("Variable d'environnement manquante : DISCORD_TOKEN");
  process.exit(1);
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

async function resolveVendeurId(vendeurDiscord) {
  if (!vendeurDiscord) return null;
  const snap = await db.collection('users').where('idDiscord', '==', vendeurDiscord).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY (ecrit dans Firestore)' : 'DRY-RUN'}`);
  console.log(`Canal : ${CHANNEL_ID} (#factures), max ${TOTAL_LIMIT} messages`);
  console.log(`Filtre date : >= ${REPRISE_DATE.toISOString().slice(0, 10)} (reprise LTD)\n`);

  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch) throw new Error(`Canal ${CHANNEL_ID} introuvable`);
    console.log(`Canal trouve : #${ch.name}`);

    // Index des factureId existants pour dedup cross-source
    console.log('Lecture /ventes existant pour deduplication par factureId...');
    const existingSnap = await db.collection('ventes').get();
    const existingFactureIds = new Set();
    for (const d of existingSnap.docs) {
      const data = d.data();
      if (data.factureId) existingFactureIds.add(String(data.factureId));
    }
    console.log(`  ${existingFactureIds.size} factureId deja en base (seront skippes)\n`);

    const messages = await fetchHistory(ch, TOTAL_LIMIT);
    console.log(`${messages.length} messages recuperes\n`);

    // Cache vendeurId pour eviter les requetes /users repetees
    const vendeurIdCache = new Map();

    let parsedTotal = 0, skippedFormat = 0, skippedDate = 0, skippedExisting = 0,
        written = 0, errors = 0;
    for (const m of messages) {
      try {
        const ts = new Date(m.createdTimestamp);
        if (ts < REPRISE_DATE) { skippedDate++; continue; }

        const payload = parseFactureEmbed(m);
        if (!payload) { skippedFormat++; continue; }
        parsedTotal++;

        const factureId = String(payload.factureId);
        if (existingFactureIds.has(factureId)) {
          skippedExisting++;
          continue;
        }
        existingFactureIds.add(factureId); // marque pour dedup intra-batch

        // Resolution vendeurId (avec cache)
        let vendeurId = null;
        if (payload.vendeurDiscord) {
          if (vendeurIdCache.has(payload.vendeurDiscord)) {
            vendeurId = vendeurIdCache.get(payload.vendeurDiscord);
          } else {
            vendeurId = await resolveVendeurId(payload.vendeurDiscord);
            vendeurIdCache.set(payload.vendeurDiscord, vendeurId);
          }
        }

        const date = ts.toISOString().slice(0, 16).replace('T', ' ');
        const tag  = `#${factureId.padEnd(8)} ${(payload.vendeurNom || '???').padEnd(20)}`;
        console.log(`  ${date}  ${tag}  ${String(payload.montant).padStart(6)} $  (${payload.paiement || '?'})`);

        if (APPLY) {
          const docId = `fac-${m.id}`;
          await db.collection('ventes').doc(docId).set({
            factureId,
            vendeurDiscord: payload.vendeurDiscord || '',
            vendeurNom: payload.vendeurNom || '',
            vendeurId,
            client: payload.clientNom || '',
            montant: Number(payload.montant) || 0,
            benefice: payload.benefice ?? null,
            raison: payload.raison || '',
            paiement: payload.paiement || '',
            items: payload.items || [],
            stockVerifie: payload.stockVerifie ?? null,
            timestamp: Timestamp.fromDate(ts),
            source: 'rattrapage-factures',
            sourceMessageId: m.id
          });
          written++;
        }
      } catch (err) {
        console.error(`  ERREUR sur msg ${m.id} : ${err.message}`);
        errors++;
      }
    }

    console.log(`\nResume :`);
    console.log(`  ${messages.length} messages recuperes`);
    console.log(`  ${skippedDate} ignores (avant 2026-05-09)`);
    console.log(`  ${skippedFormat} ignores (format non reconnu / pas une facture)`);
    console.log(`  ${parsedTotal} factures parsees`);
    console.log(`  ${skippedExisting} skippees (factureId deja en base)`);
    console.log(`  ${written} ecrites dans /ventes`);
    console.log(`  ${errors} erreurs`);
    if (APPLY) {
      console.log(`\nDocs idempotents (id = fac-{msgId}). Relance = overwrite.`);
    } else if (parsedTotal > 0) {
      console.log(`\nDry-run termine. Relance avec --apply pour ecrire.`);
    }
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
