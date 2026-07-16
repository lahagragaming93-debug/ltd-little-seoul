// ============================================================
// Rattrapage : canal #revenu -> /redistributions
// ============================================================
// Le canal #revenu (id 1441586751310270495) contient des embeds
// "ENTRÉE D'ARGENT" formatte par Faab'Hook avec :
//   title       : "***__ENTRÉE D'ARGENT__***"
//   description : "Compte ID: XXXXX / Montant: YY$ / Raison: Redistribution N°ZZZZZ"
//
// Format different de xbankaccount sur #logs-ig (qui n'existait peut-etre
// pas encore le 09/05). Ce script reconstruit les docs /redistributions
// minimaux a partir de #revenu pour rattraper l'historique.
//
// LIMITES :
//   - station = "Station inconnue (rattrapage revenu)"
//   - stationId = "station-inconnue-revenu"
//   - litres = 0, prixLitre = 0
//   - Le graphique CA par jour sera juste, recap par station regroupera.
//
// IDEMPOTENT (par messageId Discord uniquement) :
//   - DocId = `rev-{msg.id}` => relance = overwrite, pas de doublon
//     d'un meme message rattrape 2 fois.
//   - PAS de dedup par redistributionId : ce numero est un identifiant
//     de cycle/station qui se REUTILISE entre transactions distinctes
//     (ex: 35489 peut apparaitre sur plusieurs ventes a des dates
//     differentes). Filtrer dessus aurait skippe les nouvelles ventes.
//
// CONSEQUENCE : si rattraper-redistributions.js a deja ecrit un doc
// detaille (avec station/litres) pour la meme transaction, ce script
// ecrira EN PLUS un doc minimal `rev-{msgId}` => doublon conceptuel
// (2 docs pour la meme vente). A nettoyer plus tard si besoin via
// inspection des docs `rev-*` qui chevauchent une vraie redistribution.
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-revenu-essence.js                    dry-run, 500 msg
//   node scripts/rattraper-revenu-essence.js --apply            ecrit en base
//   node scripts/rattraper-revenu-essence.js --apply --limit 1000
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const CHANNEL_ID  = '1441586751310270495'; // #revenu
const APPLY       = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const TOTAL_LIMIT = limitArgIdx > 0 ? Math.max(1, parseInt(process.argv[limitArgIdx + 1], 10) || 500) : 500;

const STATION_PLACEHOLDER    = 'Station inconnue (rattrapage revenu)';
const STATION_ID_PLACEHOLDER = 'station-inconnue-revenu';

// Format reel : "🏦 • **Compte ID**: `73830` ... 💰 • **Montant**: `45`$ ... 📋 • **Raison**: Redistribution N°16060"
// On nettoie d'abord les ** markdown et les backticks pour simplifier les regex.
const REGEX_MONTANT = /montant\s*:\s*([\d\s.,]+)\s*\$/i;
const REGEX_REDIST  = /raison\s*:\s*redistribution\s*n[°º]?\s*(\d+)/i;

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

function parseRevenuMessage(msg) {
  const e = msg.embeds?.[0];
  if (!e) return null;
  // Title de Faab'Hook : "***__ENTRÉE D'ARGENT__***"
  // On enleve les marqueurs markdown (* _) avant de tester.
  const title = String(e.title || '').replace(/[*_]/g, '').toUpperCase();
  if (!title.includes("ENTREE D'ARGENT") && !title.includes("ENTRÉE D'ARGENT")) return null;
  // Description format Faab'Hook avec emojis, ** bold ** et `backticks` :
  //   "🏦 • **Compte ID**: `73830`\n💰 • **Montant**: `45`$\n📋 • **Raison**: Redistribution N°16060"
  // On strip ** et ` pour simplifier le matching.
  const desc = String(e.description || '').replace(/\*\*/g, '').replace(/`/g, '');
  const mMontant = desc.match(REGEX_MONTANT);
  const mRedist  = desc.match(REGEX_REDIST);
  if (!mMontant || !mRedist) return null;
  const montant = parseFloat(mMontant[1].replace(/\s/g, '').replace(',', '.')) || 0;
  return {
    redistributionId: mRedist[1],
    montant
  };
}

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY (ecrit dans Firestore)' : 'DRY-RUN'}`);
  console.log(`Canal : ${CHANNEL_ID} (#revenu), max ${TOTAL_LIMIT} messages\n`);

  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch) throw new Error(`Canal ${CHANNEL_ID} introuvable`);
    console.log(`Canal trouve : #${ch.name}`);

    const messages = await fetchHistory(ch, TOTAL_LIMIT);
    console.log(`${messages.length} messages recuperes\n`);

    let parsed = 0, skippedFormat = 0, written = 0, errors = 0;
    for (const m of messages) {
      try {
        const payload = parseRevenuMessage(m);
        if (!payload) { skippedFormat++; continue; }
        parsed++;

        const date = new Date(m.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ');
        console.log(`  ${date}  N°${String(payload.redistributionId).padEnd(7)}  ${String(payload.montant).padStart(6)} $`);

        if (APPLY) {
          const docId = `rev-${m.id}`;
          await db.collection('redistributions').doc(docId).set({
            redistributionId: payload.redistributionId,
            station: STATION_PLACEHOLDER,
            stationId: STATION_ID_PLACEHOLDER,
            litres: 0,
            prixLitre: 0,
            montant: payload.montant,
            stockAvant: 0,
            stockApres: 0,
            niveau: 0,
            timestamp: Timestamp.fromDate(new Date(m.createdTimestamp)),
            source: 'rattrapage-revenu',
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
    console.log(`  ${skippedFormat} ignores (format non reconnu)`);
    console.log(`  ${parsed} entrees 'Redistribution' parsees`);
    console.log(`  ${written} ecrites dans /redistributions`);
    console.log(`  ${errors} erreurs`);
    if (APPLY) {
      console.log(`\nDocs idempotents (id = rev-{msgId}). Relance = overwrite, pas de doublon.`);
    } else if (parsed > 0) {
      console.log(`\nDry-run termine. Relance avec --apply pour ecrire.`);
    }
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
