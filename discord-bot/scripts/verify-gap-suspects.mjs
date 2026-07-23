// Vérification des candidats de replay ANTÉRIEURS au watermark relais :
// pour chacun, cherche dans le relais un embed correspondant en fuzzy
// (même titre à ±5s d'écart d'embed.timestamp, ou même couple amount/soldeApres).
// But : distinguer "le relais a PERDU ce message" (replay légitime) d'un
// "mismatch de signature" (replay = doublon, à corriger).
import { parseFactureCancelEmbed } from '../parsers/factureCancel.js';
import { parseFacturePaidEmbed }   from '../parsers/facturePaid.js';
import { parseXbankaccountEmbed }  from '../parsers/xbankaccount.js';
import { parseInventoryEmbed }     from '../parsers/inventory.js';
import { parseDutyEmbed }          from '../parsers/duty.js';
import { parseXactionEmbed }       from '../parsers/xaction.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const FAABHOOK = '1429253225525018766';
const RELAIS   = '1527382960070987989';
const T_STOP       = Date.parse('2026-07-23T02:57:00Z');
const T_LIVE       = Date.parse('2026-07-23T02:57:30Z');
const WINDOW_START = Date.parse('2026-07-22T12:00:00Z');

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
    if (!r.ok) { console.error('HTTP', r.status); process.exit(1); }
    const batch = await r.json();
    if (!batch.length) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    all.push(...batch);
    after = batch[batch.length - 1].id;
    await sleep(350);
  }
  return all;
}
const sigsOf = m => (m.embeds || []).filter(e => e.title && e.timestamp).map(e => e.title + '|' + e.timestamp);
const fieldsOf = e => Object.fromEntries((e.fields || []).map(f => [f.name, String(f.value).replace(f.name + ':', '')]));

(async () => {
  const relais = (await fetchSince(RELAIS, WINDOW_START)).filter(m => Date.parse(m.timestamp) < T_STOP);
  const S = new Set(); relais.forEach(m => sigsOf(m).forEach(s => S.add(s)));
  let watermark = 0;
  relais.forEach(m => (m.embeds || []).forEach(e => { const t = Date.parse(e.timestamp || 0); if (t > watermark) watermark = t; }));

  const faab = (await fetchSince(FAABHOOK, WINDOW_START)).filter(m => Date.parse(m.timestamp) < T_LIVE);

  // Index relais par titre pour la recherche fuzzy
  const relEmbeds = [];
  relais.forEach(m => (m.embeds || []).forEach(e => relEmbeds.push({ msgTs: m.timestamp, e })));

  let suspects = 0;
  for (const m of faab) {
    const sigs = sigsOf(m);
    if (sigs.length && sigs.every(s => S.has(s))) continue;
    let matched = null;
    for (const [type, p] of CHAIN) { try { const r = p({ id: m.id, content: m.content || '', embeds: m.embeds || [], createdTimestamp: Date.parse(m.timestamp) }); if (r) { matched = type; break; } } catch {} }
    if (!matched) continue;
    const e = (m.embeds || [])[0];
    const evtTs = Date.parse(e.timestamp);
    if (evtTs >= watermark) continue; // queue normale, pas suspect
    suspects++;
    const f = fieldsOf(e);
    console.log(`--- SUSPECT ${suspects}: ${e.timestamp} · ${e.title} · type=${matched}`);
    console.log(`    amount=${f.amount || ''} soldeApres=${f.soldeApres || f.balanceAfter || ''} raison=${(f.reason || '').slice(0, 40)} bill=${f.billId || ''}`);
    // Fuzzy : même titre, embed.timestamp à ±5s
    const near = relEmbeds.filter(r => r.e.title === e.title && Math.abs(Date.parse(r.e.timestamp) - evtTs) <= 5000);
    if (!near.length) { console.log('    => AUCUNE copie relais (titre+ts ±5s) : PERDU par le relais'); continue; }
    for (const n of near.slice(0, 2)) {
      const nf = fieldsOf(n.e);
      const same = (nf.amount === f.amount) && ((nf.soldeApres || '') === (f.soldeApres || ''));
      console.log(`    => copie relais trouvée ts=${n.e.timestamp} amount=${nf.amount} : ${same ? 'MEME EVENEMENT (mismatch signature !)' : 'évènement DIFFÉRENT (coïncidence)'}`);
    }
  }
  console.log(`\nTotal suspects (avant watermark ${new Date(watermark).toISOString()}) : ${suspects}`);
})();
