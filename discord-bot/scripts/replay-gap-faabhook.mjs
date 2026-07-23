// ============================================================
// Replay one-shot du "trou de bascule" relais -> faabhook (23/07/2026).
//
// CONTEXTE : à T_STOP (2026-07-23 02:57 UTC) le bot a basculé sa source du
// salon relais BLA (webhook F1, lots en retard de 2-5 h) vers le salon natif
// ⛔・faabhook du serveur LTD Little Seoul (temps réel). Les événements créés
// AVANT la bascule mais pas encore livrés par le relais ne seront jamais lus
// en live -> on les rejoue depuis l'historique faabhook.
//
// ANTI-DOUBLON (l'ingestion banque est en .add(), non idempotente) :
//   1. Diff exact contre le relais : tout événement dont la copie relais a été
//      POSTÉE avant T_STOP a déjà été ingéré en live par l'ancien bot -> skip.
//      Signature = titre d'embed + embed.timestamp (identique à la µs près
//      entre les deux salons, vérifié sur billId 2043705).
//   2. Garde factures : ventes/fac-{billId} déjà en base -> skip (onFacture
//      fait un .set() sans merge qui écraserait le bénéfice déclaré).
//   3. Borne haute = messages faabhook antérieurs à T_LIVE (connexion du
//      nouveau bot) : tout ce qui arrive après est capté en live.
//
// Usage :
//   node scripts/replay-gap-faabhook.mjs           (dry-run)
//   node scripts/replay-gap-faabhook.mjs --apply   (envoie à botIngest)
// Env : DISCORD_TOKEN, INGEST_URL, INGEST_TOKEN
// ============================================================

import { createRequire } from 'module';
import { parseFactureCancelEmbed } from '../parsers/factureCancel.js';
import { parseFacturePaidEmbed }   from '../parsers/facturePaid.js';
import { parseXbankaccountEmbed }  from '../parsers/xbankaccount.js';
import { parseInventoryEmbed }     from '../parsers/inventory.js';
import { parseDutyEmbed }          from '../parsers/duty.js';
import { parseXactionEmbed }       from '../parsers/xaction.js';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const serviceAccount = require('../../firebase/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const INGEST_URL    = process.env.INGEST_URL;
const INGEST_TOKEN  = process.env.INGEST_TOKEN;
const APPLY = process.argv.includes('--apply');

const FAABHOOK = '1429253225525018766'; // salon natif (serveur LTD Little Seoul)
const RELAIS   = '1527382960070987989'; // salon relais (serveur BLA)

// Bornes de la bascule (UTC). Dernier lot relais livré à 02:34, rien entre
// 02:34 et la bascule -> aucune ambiguïté de frontière.
const T_STOP       = Date.parse('2026-07-23T02:57:00Z'); // fin d'écoute du relais
const T_LIVE       = Date.parse('2026-07-23T02:57:30Z'); // nouveau bot connecté
const WINDOW_START = Date.parse('2026-07-22T12:00:00Z'); // marge large (> 2x le lag max observé)

if (!DISCORD_TOKEN || (APPLY && (!INGEST_URL || !INGEST_TOKEN))) {
  console.error('DISCORD_TOKEN (+ INGEST_URL / INGEST_TOKEN en --apply) requis.');
  process.exit(1);
}

// Même ordre que CHANNEL_MAP[CH_LOGS_IG] dans index.js.
const CHAIN = [
  ['factureCancel', parseFactureCancelEmbed],
  ['facture',       parseFacturePaidEmbed],
  ['bankAccount',   parseXbankaccountEmbed],
  ['inventory',     parseInventoryEmbed],
  ['service',       parseDutyEmbed],
  ['stationFuel',   parseXactionEmbed]
];

const H = { Authorization: 'Bot ' + DISCORD_TOKEN };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snowflakeAt = ms => String((BigInt(ms) - 1420070400000n) << 22n);

async function fetchSince(channel, sinceMs) {
  const all = [];
  let after = snowflakeAt(sinceMs);
  for (;;) {
    const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages?after=${after}&limit=100`, { headers: H });
    if (r.status === 429) { const j = await r.json(); await sleep((j.retry_after + 0.5) * 1000); continue; }
    if (!r.ok) { console.error('Discord HTTP', r.status, 'sur', channel); process.exit(1); }
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    all.push(...batch);
    after = batch[batch.length - 1].id;
    await sleep(350);
  }
  return all;
}

// Appariement relais<->faabhook : les embed.timestamp des deux livraisons
// divergent parfois de ±1 ms (vérifié : 21:39:48.709 vs .710, même montant).
// Un matching par chaîne exacte rate ~6% des copies -> doublons garantis.
// On apparie donc UN-POUR-UN par titre avec tolérance ±50 ms (les ticks
// station_fill les plus rapprochés observés sont à ~500 ms, aucun risque
// d'aliaser deux événements distincts).
const MATCH_TOLERANCE_MS = 50;

function firstEmbed(msg) {
  const e = ((msg.embeds || []).filter(x => x.title && x.timestamp))[0];
  return e ? { title: e.title, ts: Date.parse(e.timestamp) } : null;
}

// index: Map titre -> [{ts, used}] trié par ts
function buildRelayIndex(msgs) {
  const idx = new Map();
  for (const m of msgs) {
    const e = firstEmbed(m);
    if (!e) continue;
    if (!idx.has(e.title)) idx.set(e.title, []);
    idx.get(e.title).push({ ts: e.ts, used: false });
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.ts - b.ts);
  return idx;
}

// Consomme la copie relais la plus proche (non utilisée) dans la tolérance.
function consumeRelayMatch(idx, embed) {
  const arr = idx.get(embed.title);
  if (!arr) return false;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].used) continue;
    const d = Math.abs(arr[i].ts - embed.ts);
    if (d < bestD) { bestD = d; best = i; }
    if (arr[i].ts > embed.ts + MATCH_TOLERANCE_MS) break;
  }
  if (best >= 0 && bestD <= MATCH_TOLERANCE_MS) { arr[best].used = true; return true; }
  return false;
}

function runChain(raw) {
  const msg = { id: raw.id, content: raw.content || '', embeds: raw.embeds || [], createdTimestamp: Date.parse(raw.timestamp) };
  for (const [type, parser] of CHAIN) {
    try {
      const payload = parser(msg);
      if (payload) return { type, payload, msg };
    } catch (e) { /* parser suivant */ }
  }
  return null;
}

(async () => {
  // 1. Index des événements déjà livrés par le relais AVANT la coupure.
  const relaisAll = await fetchSince(RELAIS, WINDOW_START);
  const relais = relaisAll.filter(m => Date.parse(m.timestamp) < T_STOP);
  const relayIdx = buildRelayIndex(relais);
  console.log(`Relais : ${relaisAll.length} msgs depuis la fenêtre (${relais.length} avant coupure -> index, ${relaisAll.length - relais.length} livrés après coupure = plus écoutés).`);
  // Watermark : événement le plus récent livré par le relais avant la coupure.
  let watermark = 0;
  for (const m of relais) {
    const e = firstEmbed(m);
    if (e && e.ts > watermark) watermark = e.ts;
  }
  console.log(`Watermark relais (événement le plus récent livré avant coupure) : ${new Date(watermark).toISOString()}`);

  // 2. Parcours de l'historique faabhook antérieur à T_LIVE.
  const faab = (await fetchSince(FAABHOOK, WINDOW_START))
    .filter(m => Date.parse(m.timestamp) < T_LIVE);
  console.log(`Faabhook : ${faab.length} msgs dans la fenêtre (avant connexion live).`);

  const stats = { rejoue: 0, dejaRelaye: 0, factureEnBase: 0, nonParse: 0, envoye: 0, erreurs: 0 };
  let avantWatermark = 0;
  const parType = {};
  faab.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const m of faab) {
    const embed = firstEmbed(m);
    if (embed && consumeRelayMatch(relayIdx, embed)) { stats.dejaRelaye++; continue; }
    const r = runChain(m);
    if (!r) { stats.nonParse++; continue; }
    // Garde factures : ne JAMAIS rejouer une facture déjà en base.
    if (r.type === 'facture') {
      const snap = await db.collection('ventes').doc('fac-' + r.payload.factureId).get();
      if (snap.exists) { stats.factureEnBase++; continue; }
    }
    stats.rejoue++;
    if (embed && embed.ts < watermark) avantWatermark++;
    parType[r.type] = (parType[r.type] || 0) + 1;
    const label = `${m.timestamp.slice(0, 19)} ${r.type} ${((m.embeds||[])[0]||{}).title || ''}`;
    if (!APPLY) { console.log('[dry-run]', label); continue; }
    const enriched = { ...r.payload, _meta: { messageId: m.id, channelId: FAABHOOK, timestamp: r.msg.createdTimestamp } };
    const resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-token': INGEST_TOKEN },
      body: JSON.stringify({ type: r.type, payload: enriched })
    });
    if (resp.ok) { stats.envoye++; console.log('[OK]  ', label); }
    else { stats.erreurs++; console.log(`[${resp.status}]`, label); }
    await sleep(300);
  }

  console.log('\n== Bilan ==');
  console.log(`Déjà livrés par le relais (skip) : ${stats.dejaRelaye}`);
  console.log(`Factures déjà en base (skip)     : ${stats.factureEnBase}`);
  console.log(`Non parsés (types ignorés)       : ${stats.nonParse}`);
  console.log(`À rejouer : ${stats.rejoue}  ${JSON.stringify(parType)}`);
  console.log(`  dont antérieurs au watermark (suspects si > 0) : ${avantWatermark}`);
  if (APPLY) console.log(`Envoyés : ${stats.envoye} · erreurs : ${stats.erreurs}`);
  else console.log('DRY-RUN — relancer avec --apply pour envoyer.');
  process.exit(0);
})();
