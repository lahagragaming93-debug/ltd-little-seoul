// ============================================================
// Bot Discord — LTD Little Seoul
// Lit les embeds des canaux de logs et relaie vers Firebase.
// ============================================================

import 'dotenv/config';
import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import fetch from 'node-fetch';

import { parseInventoryEmbed }       from './parsers/inventory.js';
import { parseDutyEmbed }            from './parsers/duty.js';
import { parseXactionEmbed }         from './parsers/xaction.js';
import { parseServiceEmbed }         from './parsers/service.js';
import { parseFactureEmbed }         from './parsers/facture.js';
import { parseRedistributionEmbed }  from './parsers/essence.js';
import { parseDepenseEmbed }         from './parsers/depense.js';
import { parsePaieEmbed }            from './parsers/paie.js';
import { parseCoffreEmbed }          from './parsers/coffre.js';
import { parseXbankaccountEmbed }    from './parsers/xbankaccount.js';
import { parseFactureCancelEmbed }   from './parsers/factureCancel.js';
import { parseAutoRhEmbed }          from './parsers/autoRh.js';
import { parseAutorankupEmbed }      from './parsers/autorankup.js';
import { parseStatsbankEmbed }       from './parsers/statsbank.js';
import { parseRapportPompisteEmbed } from './parsers/rapportPompiste.js';
import { parseVenteAutoEmbed }       from './parsers/venteAuto.js';
import { parseStationsDashboardMessage } from './parsers/stationsDashboard.js';
import { parseDossierEmployeMessage }  from './parsers/dossierEmploye.js';
import { parseAvertissementEmbed }     from './parsers/avertissement.js';
import { parseLicenciementEmbed }      from './parsers/licenciement.js';
import { parseVehiculeEmbed }          from './parsers/vehicule.js';
import { parseStagiaireEmbed }         from './parsers/stagiaire.js';

const required = ['DISCORD_TOKEN', 'GUILD_ID', 'INGEST_URL', 'INGEST_TOKEN'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`❌ Variable d'environnement manquante : ${k}`);
    process.exit(1);
  }
}

// Un canal peut avoir SOIT un parser unique { type, parser },
// SOIT une liste ordonnée de parsers à essayer dans l'ordre (premier qui retourne
// un payload non-null gagne). Permet de gérer plusieurs types d'embeds sur le
// même canal (ex. #logs-ig reçoit inventory + xbankaccount).
const CHANNEL_MAP = {
  [process.env.CH_LOGS_IG]: [
    // factureCancel teste EN PREMIER : embed "xbankaccount - cancel" qui
    // signale qu'un employe a supprime une facture IG. Filtre interne :
    // logType=cancel + category=xbill. Si pas de match, on tombe sur les
    // autres parsers.
    { type: 'factureCancel',  parser: parseFactureCancelEmbed },
    { type: 'bankAccount',    parser: parseXbankaccountEmbed }, // filtre IBAN LTDSEOUL
    { type: 'inventory',      parser: parseInventoryEmbed     },
    // Format FlashFA (Little Seoul) : tout arrive dans CE salon unique.
    { type: 'service',        parser: parseDutyEmbed          },  // duty - setStatus -> onService
    { type: 'stationFuel',    parser: parseXactionEmbed       }   // xaction station_fill / fuel_fill -> onStationFuel
  ],
  [process.env.CH_LOGS_SERVICES]:         { type: 'service',        parser: parseServiceEmbed       },
  [process.env.CH_SUIVI_SERVICE_VENDEUR]: { type: 'service',        parser: parseServiceEmbed       },
  [process.env.CH_SUIVI_FACTURE]:         { type: 'facture',        parser: parseFactureEmbed       },
  // #factures (id 1441586772403294359) : meme format que #suivi-facture, post-
  // migration FiveM c'est ICI que Jessica poste les factures. Doublon possible
  // avec #suivi-facture, dedupe assure par onFacture (set sur fac-{factureId}).
  [process.env.CH_FACTURES]:              { type: 'facture',        parser: parseFactureEmbed       },
  [process.env.CH_SUIVI_ACHAT_ESSENCE]:   { type: 'redistribution', parser: parseRedistributionEmbed },
  [process.env.CH_DEPENSES]:              { type: 'depense',        parser: parseDepenseEmbed       },
  [process.env.CH_PAIE]:                  { type: 'paie',           parser: parsePaieEmbed          },
  [process.env.CH_SUIVI_COFFRE]:          { type: 'coffre',         parser: parseCoffreEmbed        },
  // Nouveaux canaux (à configurer dans Railway via variables d'env CH_*)
  [process.env.CH_AUTO_RH]:               { type: 'autoRh',         parser: parseAutoRhEmbed        },
  [process.env.CH_AUTORANKUP]:            { type: 'autorankup',     parser: parseAutorankupEmbed    },
  [process.env.CH_STATSBANK]:             { type: 'statsbank',      parser: parseStatsbankEmbed     },
  [process.env.CH_POMPISTE]:              { type: 'rapportPompiste',parser: parseRapportPompisteEmbed },
  [process.env.CH_VENTES]:                { type: 'venteAuto',      parser: parseVenteAutoEmbed     },
  // Dashboard stations : 1 seul message édité en place → flag listenEdits
  [process.env.CH_STATIONS_DASHBOARD]:    { type: 'stationsDashboard',
                                            parser: parseStationsDashboardMessage,
                                            listenEdits: true,
                                            fetchOnStartup: true },
  // Forum dossiers RH : routing par parentId du thread
  // (les fiches sont dans les threads enfants, pas dans le forum lui-meme).
  [process.env.CH_DOSSIERS_EMPLOYES]:     { type: 'dossierEmploye',
                                            parser: parseDossierEmployeMessage,
                                            listenEdits: true },
  // Logs RH structures (deplaces depuis RAW_CHANNELS)
  [process.env.CH_LOGS_AVERTISSEMENT]:    { type: 'avertissement', parser: parseAvertissementEmbed },
  [process.env.CH_LOGS_LICENCIEMENT]:     { type: 'licenciement',  parser: parseLicenciementEmbed },
  [process.env.CH_LOGS_VEHICULES]:        { type: 'vehicule',      parser: parseVehiculeEmbed     },
  [process.env.CH_STAGIAIRE]:             { type: 'stagiaire',     parser: parseStagiaireEmbed    }
};

const RAW_CHANNELS = {
  [process.env.CH_SUIVI_COFFRE_SECONDAIRE]: 'suivi-coffre-secondaire',
  [process.env.CH_ALERTE_COFFRE]:           'alerte-coffre',
  [process.env.CH_REVENU]:                  'revenu'  // doublon xbankaccount, garde en raw pour audit
  // CH_FACTURES : deplace en parser structure (CHANNEL_MAP ci-dessus)
  // CH_STATSBANK / CH_LOGS_LICENCIEMENT / CH_LOGS_AVERTISSEMENT :
  // deplaces en parsers structures (CHANNEL_MAP ci-dessus)
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot connecté : ${c.user.tag}`);
  const watched = Object.keys(CHANNEL_MAP).filter(Boolean);
  const raw     = Object.keys(RAW_CHANNELS).filter(Boolean);
  console.log(`   Canaux surveillés : ${watched.length}`);
  console.log(`   Canaux logs bruts : ${raw.length}`);

  // Diagnostic : lister les canaux effectivement visibles
  try {
    const guild = await c.guilds.fetch(process.env.GUILD_ID);
    console.log(`\n📡 Diagnostic accès canaux sur "${guild.name}":`);
    const channels = await guild.channels.fetch();
    const allIds = new Set([...watched, ...raw]);
    let okCount = 0, koCount = 0;
    for (const id of allIds) {
      const ch = channels.get(id);
      const cfg = CHANNEL_MAP[id];
      const role = Array.isArray(cfg)
        ? cfg.map(c => c.type).join('|')
        : (cfg?.type || (RAW_CHANNELS[id] ? `raw:${RAW_CHANNELS[id]}` : '?'));
      if (ch) {
        const me = guild.members.me;
        const perms = ch.permissionsFor(me);
        const canView = perms?.has('ViewChannel');
        const canRead = perms?.has('ReadMessageHistory');
        if (canView && canRead) {
          console.log(`  ✓ #${ch.name.padEnd(28)} → ${role}`);
          okCount++;
        } else {
          console.log(`  ⚠ #${ch.name.padEnd(28)} → ${role}  (View=${canView}, ReadHist=${canRead})`);
          koCount++;
        }
      } else {
        console.log(`  ✗ ${id} INTROUVABLE → ${role}`);
        koCount++;
      }
    }
    console.log(`\n   Résumé : ${okCount} OK / ${koCount} problématique(s)\n`);
  } catch (e) {
    console.error('Erreur diagnostic :', e.message);
  }

  // Fetch initial : pour les canaux marqués fetchOnStartup (dashboards édités
  // en place), récupère le dernier message pour avoir l'état courant.
  for (const [chanId, cfg] of Object.entries(CHANNEL_MAP)) {
    const candidates = Array.isArray(cfg) ? cfg : [cfg];
    if (!candidates.some(c => c.fetchOnStartup)) continue;
    try {
      const ch = await c.channels.fetch(chanId);
      if (!ch) { console.log(`  fetchOnStartup ${chanId} : salon introuvable`); continue; }
      const messages = await ch.messages.fetch({ limit: 1 });
      for (const m of messages.values()) await handleMessage(m, 'startup');
      console.log(`  fetchOnStartup #${ch.name} : OK`);
    } catch (err) {
      console.error(`  fetchOnStartup ${chanId} :`, err.message);
    }
  }
});

async function handleMessage(msg, source = 'create') {
  if (msg.guildId !== process.env.GUILD_ID) return;
  if (msg.author?.bot && !shouldProcessBotMessage(msg)) {
    if (msg.author.id === client.user.id) return;
  }

  const channelId = msg.channelId;
  const channelName = msg.channel?.name || channelId;
  const author = msg.author?.username || 'inconnu';
  const isBot = msg.author?.bot ? '🤖' : '👤';
  const nbEmbeds = msg.embeds?.length || 0;
  console.log(`[${source.toUpperCase()}] #${channelName} ${isBot}${author} embeds=${nbEmbeds} content="${(msg.content || '').slice(0, 60)}"`);

  // Canaux structurés (mono-parser ou liste de parsers).
  // Si le message est dans un thread (forum / fil), on retombe sur le parent
  // pour le routing — la config est definie sur le forum, pas sur chaque thread.
  const isThread = typeof msg.channel?.isThread === 'function' && msg.channel.isThread();
  const parentId = isThread ? msg.channel.parentId : null;
  const cfg = CHANNEL_MAP[channelId] || (parentId ? CHANNEL_MAP[parentId] : null);
  if (cfg) {
    const candidates = Array.isArray(cfg) ? cfg : [cfg];
    let matched = false;
    for (const c of candidates) {
      try {
        const payload = c.parser(msg);
        if (payload) {
          await sendToFirebase(c.type, payload, msg);
          matched = true;
          break;
        }
      } catch (err) {
        console.error(`Erreur parsing ${c.type} (msg ${msg.id}) :`, err.message);
      }
    }
    if (!matched) {
      const types = candidates.map(c => c.type).join('|');
      console.log(`  └─ aucun parser n'a reconnu (essayés: ${types})`);
    }
    return;
  }

  // Canaux logs bruts (uniquement sur create — pas sur edit pour éviter spam)
  if (source === 'create' && RAW_CHANNELS[channelId]) {
    try {
      const contenu = embedsToText(msg);
      if (!contenu) return;
      await sendToFirebase('logBrut', {
        canal: RAW_CHANNELS[channelId],
        contenu,
        auteur: msg.author?.username || ''
      }, msg);
    } catch (err) {
      console.error('logBrut error', err.message);
    }
  }
}

client.on(Events.MessageCreate, (msg) => handleMessage(msg, 'create'));

// Edits : pour les canaux où le bot externe édite le même message en place
// (ex. dashboard stations). On ne traite que les channels marqués listenEdits.
client.on(Events.MessageUpdate, async (_oldMsg, newMsg) => {
  // Pour les threads, fallback sur la config du parent (forum / fil enfant).
  const isThread = typeof newMsg.channel?.isThread === 'function' && newMsg.channel.isThread();
  const parentId = isThread ? newMsg.channel.parentId : null;
  const cfg = CHANNEL_MAP[newMsg.channelId] || (parentId ? CHANNEL_MAP[parentId] : null);
  const candidates = Array.isArray(cfg) ? cfg : (cfg ? [cfg] : []);
  if (!candidates.some(c => c.listenEdits)) return;
  try {
    if (newMsg.partial) newMsg = await newMsg.fetch();
  } catch (err) {
    console.error('MessageUpdate fetch failed:', err.message);
    return;
  }
  await handleMessage(newMsg, 'update');
});

function shouldProcessBotMessage(msg) {
  // Toujours traiter les messages d'autres bots (logs FiveM)
  return msg.author.id !== client.user?.id;
}

function embedsToText(msg) {
  if (!msg.embeds || msg.embeds.length === 0) return msg.content || '';
  return msg.embeds.map(e => {
    const lines = [];
    if (e.title) lines.push(e.title);
    if (e.description) lines.push(e.description);
    (e.fields || []).forEach(f => lines.push(`${f.name}: ${f.value}`));
    return lines.join('\n');
  }).join('\n---\n');
}

async function sendToFirebase(type, payload, msg) {
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
    headers: {
      'Content-Type': 'application/json',
      'x-bot-token':  process.env.INGEST_TOKEN
    },
    body: JSON.stringify({ type, payload: enriched })
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`  └─ Firebase ${res.status} : ${txt.slice(0, 120)}`);
  } else {
    console.log(`  └─ Firebase ✓ (${type})`);
  }
}

// Gestion robuste
process.on('unhandledRejection', e => console.error('unhandledRejection', e));
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });

client.login(process.env.DISCORD_TOKEN);
