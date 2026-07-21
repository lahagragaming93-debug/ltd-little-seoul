// ============================================================
// Backfill one-shot : rejoue UNIQUEMENT les factures payées (xbankaccount -
// paid / paidCash) de l'historique du salon #logs-little-seoul → botIngest
// (type 'facture' → onFacture). Sûr à relancer : onFacture écrit le doc
// idempotent ventes/fac-{billId}.
// Usage :
//   node scripts/backfill-factures-paid.mjs           (dry-run)
//   node scripts/backfill-factures-paid.mjs --apply   (envoie à botIngest)
// Env : DISCORD_TOKEN, INGEST_URL, INGEST_TOKEN, CH_LOGS_IG (ou .env)
// ============================================================

import { parseFacturePaidEmbed } from '../parsers/facturePaid.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const INGEST_URL    = process.env.INGEST_URL;
const INGEST_TOKEN  = process.env.INGEST_TOKEN;
const CHANNEL       = process.env.CH_LOGS_IG || '1527382960070987989';
const APPLY = process.argv.includes('--apply');

if (!DISCORD_TOKEN || (APPLY && (!INGEST_URL || !INGEST_TOKEN))) {
  console.error('DISCORD_TOKEN (+ INGEST_URL / INGEST_TOKEN en --apply) requis.');
  process.exit(1);
}

async function fetchAllMessages() {
  const all = [];
  let after = '0';
  for (;;) {
    const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages?after=${after}&limit=100`, {
      headers: { Authorization: 'Bot ' + DISCORD_TOKEN }
    });
    if (r.status === 429) { const j = await r.json(); await new Promise(x => setTimeout(x, (j.retry_after + 0.5) * 1000)); continue; }
    if (!r.ok) { console.error('Discord HTTP', r.status); process.exit(1); }
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    all.push(...batch);
    after = batch[batch.length - 1].id;
    await new Promise(x => setTimeout(x, 350));
  }
  return all;
}

(async () => {
  const msgs = await fetchAllMessages();
  console.log(`${msgs.length} message(s) dans le salon.`);
  let found = 0, sent = 0;
  for (const raw of msgs) {
    const msg = { id: raw.id, content: raw.content || '', embeds: raw.embeds || [], createdTimestamp: Date.parse(raw.timestamp) };
    let payload = null;
    try { payload = parseFacturePaidEmbed(msg); } catch (e) {}
    if (!payload) continue;
    found++;
    const label = `${raw.timestamp.slice(0, 19)} fac#${payload.factureId} ${payload.montant}$ ${payload.vendeurNom} -> ${payload.clientNom} (${payload.paiement})`;
    if (!APPLY) { console.log('[dry-run]', label, '· raison:', payload.raison.slice(0, 60)); continue; }
    const resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-token': INGEST_TOKEN },
      body: JSON.stringify({ type: 'facture', payload })
    });
    console.log(resp.ok ? '[OK]  ' : `[${resp.status}]`, label);
    if (resp.ok) sent++;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n${found} facture(s) payée(s) trouvée(s).` + (APPLY ? ` ${sent} envoyée(s) à botIngest.` : ' DRY-RUN — relancer avec --apply.'));
})();
