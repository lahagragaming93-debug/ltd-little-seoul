// ============================================================
// Rattrape les fiches existantes du forum #Dossiers-Employers
// ============================================================
// Discord ne renvoie pas d'events sur les threads archives.
// Les 12 fiches actuelles ne sont donc jamais parsees automatiquement.
// Ce script :
//   1. Se connecte avec le DISCORD_TOKEN du bot
//   2. Liste TOUS les threads (actifs + archives, paginated)
//   3. Pour chaque thread, fetche le 1er message (starter message)
//   4. Parse via parseDossierEmployeMessage
//   5. POST vers le meme endpoint botIngest qu'en temps reel (pipeline normal)
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/init-dossiers.js          dry-run (affiche sans poster)
//   node scripts/init-dossiers.js --apply  execute (POST vers botIngest)
// ============================================================

import 'dotenv/config';
import fetch from 'node-fetch';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { parseDossierEmployeMessage } from '../parsers/dossierEmploye.js';

const FORUM_ID = process.env.CH_DOSSIERS_EMPLOYES || '1390801200143667280';
const APPLY = process.argv.includes('--apply');

const required = ['DISCORD_TOKEN', 'INGEST_URL', 'INGEST_TOKEN'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Variable d'environnement manquante : ${k}`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

async function fetchAllThreads(forum) {
  const all = new Map();
  // Threads actifs
  const active = await forum.threads.fetchActive();
  for (const [id, t] of active.threads) all.set(id, t);
  // Threads archives (paginated 100 max par appel)
  let before;
  while (true) {
    const opts = { limit: 100 };
    if (before) opts.before = before;
    const arch = await forum.threads.fetchArchived(opts);
    if (arch.threads.size === 0) break;
    for (const [id, t] of arch.threads) all.set(id, t);
    if (!arch.hasMore) break;
    // before = oldest archive timestamp pour pagination
    const oldest = [...arch.threads.values()].pop();
    before = oldest?.archivedAt || oldest?.archiveTimestamp;
    if (!before) break;
  }
  return [...all.values()];
}

async function postToIngest(type, payload, msg) {
  const enriched = {
    ...payload,
    _meta: {
      messageId: msg.id,
      channelId: msg.channelId,
      timestamp: msg.createdTimestamp
    }
  };
  const res = await fetch(process.env.INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-token': process.env.INGEST_TOKEN },
    body: JSON.stringify({ type, payload: enriched })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${type} -> ${res.status} ${txt}`);
  }
}

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY (POST botIngest)' : 'DRY-RUN'}`);
  try {
    const forum = await client.channels.fetch(FORUM_ID);
    if (!forum) throw new Error(`Forum ${FORUM_ID} introuvable`);
    if (forum.type !== 15) throw new Error(`Channel ${FORUM_ID} n'est pas un forum (type=${forum.type})`);
    console.log(`Forum : #${forum.name}`);

    const threads = await fetchAllThreads(forum);
    console.log(`${threads.length} threads trouves\n`);

    let parsed = 0, skipped = 0, posted = 0, errors = 0;
    for (const t of threads) {
      try {
        // Le 1er message du thread (le starter post de la fiche)
        let starter = null;
        try {
          starter = await t.fetchStarterMessage();
        } catch {
          // Fallback : fetch le 1er message via pagination
          const msgs = await t.messages.fetch({ limit: 1 });
          starter = msgs.first() || null;
        }
        if (!starter) { console.log(`  ${t.name.padEnd(35)} : aucun message starter`); skipped++; continue; }

        const payload = parseDossierEmployeMessage(starter);
        if (!payload) { console.log(`  ${t.name.padEnd(35)} : pas une fiche reconnue`); skipped++; continue; }

        parsed++;
        const tag = `${payload.prenom} ${payload.nom}`.padEnd(28);
        console.log(`  ${t.name.padEnd(35)} -> ${tag} pole="${payload.pole}" tel="${payload.telephone}" iban="${payload.iban}"`);

        if (APPLY) {
          await postToIngest('dossierEmploye', payload, starter);
          posted++;
        }
      } catch (err) {
        console.error(`  ${t.name} : ERREUR ${err.message}`);
        errors++;
      }
    }

    console.log(`\nResume : ${parsed} fiches parseables, ${skipped} skipped, ${posted} postees, ${errors} erreurs`);
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
