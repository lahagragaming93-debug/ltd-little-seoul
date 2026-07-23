// ============================================================
// Backfill one-shot : rejoue UNIQUEMENT les factures payées (xbankaccount -
// paid / paidCash) du salon logs → botIngest (type 'facture' → onFacture).
//
// SÉCURITÉ (Sandy) : onFacture fait un .set() COMPLET (sans merge) sur
// ventes/fac-{billId} — rejouer une facture dont le doc existe déjà écraserait
// des champs posés ensuite (bénéfice déclaré, remplaceeParId…). Ce script
// VÉRIFIE donc l'existence du doc via l'Admin SDK (serviceAccountKey de
// ../firebase) et SAUTE toute facture déjà en base.
// La pagination démarre au 16/07/2026 (migration FlashFA) via snowflake.
//
// Usage :
//   node scripts/backfill-factures-paid.mjs           (dry-run)
//   node scripts/backfill-factures-paid.mjs --apply   (envoie à botIngest)
// Env : DISCORD_TOKEN, INGEST_URL, INGEST_TOKEN, CH_LOGS_IG (ou .env)
// ============================================================

import { createRequire } from 'module';
import { parseFacturePaidEmbed } from '../parsers/facturePaid.js';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const serviceAccount = require('../../firebase/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const INGEST_URL    = process.env.INGEST_URL;
const INGEST_TOKEN  = process.env.INGEST_TOKEN;
const CHANNEL       = process.env.CH_LOGS_IG || '1527382960070987989';
const APPLY = process.argv.includes('--apply');

if (!DISCORD_TOKEN || (APPLY && (!INGEST_URL || !INGEST_TOKEN))) {
  console.error('DISCORD_TOKEN (+ INGEST_URL / INGEST_TOKEN en --apply) requis.');
  process.exit(1);
}

// Snowflake Discord du 16/07/2026 00:00 UTC : borne de départ (migration FlashFA).
const START_SNOWFLAKE = String((BigInt(Date.parse('2026-07-16T00:00:00Z')) - 1420070400000n) << 22n);

async function fetchMessagesSince() {
  const all = [];
  let after = START_SNOWFLAKE;
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
  const msgs = await fetchMessagesSince();
  console.log(`${msgs.length} message(s) depuis le 16/07.`);
  let found = 0, sent = 0, skipped = 0;
  for (const raw of msgs) {
    const msg = { id: raw.id, content: raw.content || '', embeds: raw.embeds || [], createdTimestamp: Date.parse(raw.timestamp) };
    let payload = null;
    try { payload = parseFacturePaidEmbed(msg); } catch (e) {}
    if (!payload) continue;
    found++;
    const label = `${raw.timestamp.slice(0, 16)} fac#${payload.factureId} ${payload.montant}$ ${payload.vendeurNom} (${payload.paiement})`;
    // Garde anti-écrasement : facture déjà en base -> on ne rejoue JAMAIS.
    const snap = await db.collection('ventes').doc('fac-' + payload.factureId).get();
    if (snap.exists) { skipped++; console.log('[skip existe]', label); continue; }
    if (!APPLY) { console.log('[dry-run]', label, '· raison:', payload.raison.slice(0, 50)); continue; }
    const resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-token': INGEST_TOKEN },
      body: JSON.stringify({ type: 'facture', payload })
    });
    console.log(resp.ok ? '[OK]  ' : `[${resp.status}]`, label);
    if (resp.ok) sent++;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n${found} facture(s) payée(s) trouvée(s) · ${skipped} déjà en base (sautées).` + (APPLY ? ` ${sent} envoyée(s).` : ' DRY-RUN — relancer avec --apply.'));
  process.exit(0);
})();
