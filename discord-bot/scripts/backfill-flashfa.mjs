// ============================================================
// Backfill one-shot : rejoue l'historique du salon #logs-little-seoul
// à travers les parsers calibrés → botIngest.
// À utiliser UNE FOIS après la mise en service (les logs antérieurs au
// démarrage du bot calibré n'ont jamais été ingérés). Les handlers
// ne sont pas tous idempotents : ne pas relancer sans vérifier.
// Usage :
//   node scripts/backfill-flashfa.mjs           (dry-run : montre ce qui serait envoyé)
//   node scripts/backfill-flashfa.mjs --apply   (envoie réellement à botIngest)
//   Options : --before=<messageId>  ne rejoue que les messages STRICTEMENT
//             antérieurs à cet id (borne anti-doublon avec le bot live).
// Env : DISCORD_TOKEN, INGEST_URL, INGEST_TOKEN, CH_LOGS_IG (ou valeurs du .env)
// ============================================================

import { parseFactureCancelEmbed } from '../parsers/factureCancel.js';
import { parseXbankaccountEmbed }  from '../parsers/xbankaccount.js';
import { parseInventoryEmbed }     from '../parsers/inventory.js';
import { parseDutyEmbed }          from '../parsers/duty.js';
import { parseXactionEmbed }       from '../parsers/xaction.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const INGEST_URL    = process.env.INGEST_URL;
const INGEST_TOKEN  = process.env.INGEST_TOKEN;
const CHANNEL       = process.env.CH_LOGS_IG || '1527382960070987989';
const APPLY  = process.argv.includes('--apply');
const beforeArg = (process.argv.find(a => a.startsWith('--before=')) || '').split('=')[1] || null;

if (!DISCORD_TOKEN || !INGEST_URL || !INGEST_TOKEN) {
  console.error('DISCORD_TOKEN / INGEST_URL / INGEST_TOKEN requis (cf .env).');
  process.exit(1);
}

const PARSERS = [
  { type: 'factureCancel', parser: parseFactureCancelEmbed },
  { type: 'bankAccount',   parser: parseXbankaccountEmbed },
  { type: 'inventory',     parser: parseInventoryEmbed },
  { type: 'service',       parser: parseDutyEmbed },
  { type: 'stationFuel',   parser: parseXactionEmbed }
];

async function fetchAllMessages() {
  // Pagination ascendante : after=0 puis after=<dernier id> (ordre chronologique).
  const all = [];
  let after = '0';
  for (;;) {
    const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages?after=${after}&limit=100`, {
      headers: { Authorization: 'Bot ' + DISCORD_TOKEN }
    });
    if (!r.ok) { console.error('Discord HTTP', r.status); process.exit(1); }
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // chronologique
    all.push(...batch);
    after = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  return all;
}

(async () => {
  const msgs = await fetchAllMessages();
  console.log(`${msgs.length} message(s) dans le salon.`);
  const stats = {}; let sent = 0, skipped = 0;

  for (const raw of msgs) {
    if (beforeArg && BigInt(raw.id) >= BigInt(beforeArg)) { skipped++; continue; }
    // Adapter le message REST au shape attendu par les parsers (discord.js-like).
    const msg = {
      id: raw.id,
      content: raw.content || '',
      embeds: raw.embeds || [],
      createdTimestamp: Date.parse(raw.timestamp)
    };
    let matched = null;
    for (const { type, parser } of PARSERS) {
      let payload = null;
      try { payload = parser(msg); } catch (e) { /* parser suivant */ }
      if (payload) { matched = { type, payload }; break; }
    }
    if (!matched) continue;
    stats[matched.type] = (stats[matched.type] || 0) + 1;
    const label = `${raw.timestamp.slice(11, 19)} ${matched.type}`;
    if (!APPLY) { console.log('[dry-run]', label, JSON.stringify(matched.payload).slice(0, 110)); continue; }
    const resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-token': INGEST_TOKEN },
      body: JSON.stringify({ type: matched.type, payload: matched.payload })
    });
    console.log(resp.ok ? '[OK]  ' : `[${resp.status}]`, label);
    if (resp.ok) sent++;
    await new Promise(r => setTimeout(r, 250)); // ménage botIngest
  }

  console.log('\nRésumé par type :', JSON.stringify(stats));
  console.log(APPLY ? `${sent} payload(s) envoyés.` : 'DRY-RUN — relancer avec --apply pour envoyer.');
  if (skipped) console.log(`${skipped} message(s) >= --before ignorés.`);
})();
