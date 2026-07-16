// ============================================================
// Rattrape les paiements de facture reçus par les fournisseurs (côté destinataire)
// ============================================================
// Avant Phase 3 (2026-05-14), le parser xbankaccount filtrait sur iban=LTDSEOUL
// donc on ratait les logs addmoney côté HDM/Dynasty 8/etc. Ce script :
//   1. Scan #logs-ig
//   2. Filtre les "xbankaccount - addmoney|deposit" avec reason "Paiement facture N°XXX"
//      sur un iban != LTDSEOUL (= un fournisseur a reçu de l'argent du LTD)
//   3. Pour chaque match, lookup /depenses par factureId
//   4. Enrichit la dépense avec compteCibleAccountId + tente l'auto-classification
//
// Utile pour rattraper TOUS les paiements HDM, Dynasty 8 et autres fournisseurs
// payés via facture depuis l'ouverture du LTD (2026-05-09).
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-paiements-fournisseurs.js                 dry-run
//   node scripts/rattraper-paiements-fournisseurs.js --apply
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { parseXbankaccountEmbed } from '../parsers/xbankaccount.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const CHANNEL_ID = process.env.CH_LOGS_IG;
const APPLY      = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const TOTAL_LIMIT = limitArgIdx > 0 ? Math.max(1, parseInt(process.argv[limitArgIdx + 1], 10) || 2000) : 2000;

if (!process.env.DISCORD_TOKEN || !CHANNEL_ID) {
  console.error("Variables manquantes : DISCORD_TOKEN, CH_LOGS_IG");
  process.exit(1);
}

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel]
});

function matchesFournisseurPattern(pat, dep, raison) {
  if (!pat || !pat.matchType || !pat.matchValue) return false;
  const valeurs = String(pat.matchValue).split(',').map(v => v.trim()).filter(Boolean);
  const boutiqueMatch = raison.match(/Achat\s+boutique\s*N[°º]?\s*(\d+)/i);
  const boutiqueId = dep.boutiqueId || (boutiqueMatch ? boutiqueMatch[1] : null);
  const factureMatch = raison.match(/Paiement\s+facture\s*N[°º]?\s*(\d+)/i);
  const factureId = dep.factureId || (factureMatch ? factureMatch[1] : null);
  switch (pat.matchType) {
    case 'boutique-id':    return !!boutiqueId && valeurs.includes(String(boutiqueId));
    case 'facture-id':     return !!factureId && valeurs.includes(String(factureId));
    case 'raison-regex':   try { return new RegExp(pat.matchValue, 'i').test(raison || ''); } catch { return false; }
    case 'compte-cible':
      if (!dep.compteCibleNom) return false;
      return valeurs.some(v => String(dep.compteCibleNom).toLowerCase().includes(v.toLowerCase()));
    case 'account-id-cible':
      if (!dep.compteCibleAccountId) return false;
      return valeurs.includes(String(dep.compteCibleAccountId));
    default: return false;
  }
}

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

client.once('ready', async () => {
  console.log(`Connecte : ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Canal : ${CHANNEL_ID} (#logs-ig), max ${TOTAL_LIMIT} messages\n`);

  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch) throw new Error('Canal introuvable');

    // Charge la config patterns pour tenter le mapping
    const cfgSnap = await db.collection('config').doc('global').get();
    const patterns = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];
    console.log(`${patterns.length} patterns en config\n`);

    const messages = await fetchHistory(ch, TOTAL_LIMIT);
    console.log(`${messages.length} messages scanés\n`);

    let paiementsRecuesTrouves = 0;
    let depensesEnrichies = 0;
    let depensesReclassees = 0;
    let orphelins = 0;

    for (const m of messages) {
      const payload = parseXbankaccountEmbed(m);
      if (!payload) continue;
      // Filtre Phase 3 : addmoney non-LTD avec billIdRecu
      if (payload.estLTD) continue;
      if (!payload.billIdRecu) continue;
      paiementsRecuesTrouves++;

      const billId = payload.billIdRecu;
      const accountIdDestinataire = payload.accountId || '';
      const ibanDestinataire = payload.iban || '';

      // Cherche la dépense LTD avec ce factureId
      const depSnap = await db.collection('depenses')
        .where('factureId', '==', String(billId))
        .limit(5)
        .get();

      if (depSnap.empty) {
        orphelins++;
        console.log(`  ⚠ billId ${billId} (${payload.montant}$, iban ${ibanDestinataire}, accId ${accountIdDestinataire}) : pas de dépense LTD correspondante`);
        continue;
      }

      for (const d of depSnap.docs) {
        const dep = d.data();
        if (dep.valideParPatron === true) continue;

        // Tente le mapping avec le nouvel accountId
        const payloadPourMatch = {
          ...dep,
          compteCibleAccountId: accountIdDestinataire,
          compteCibleIban: ibanDestinataire
        };
        let fournisseur = null;
        for (const pat of patterns) {
          if (matchesFournisseurPattern(pat, payloadPourMatch, dep.raison || '')) {
            fournisseur = pat;
            break;
          }
        }

        const update = {
          compteCibleAccountId: accountIdDestinataire,
          compteCibleIban: ibanDestinataire
        };
        if (fournisseur) {
          update.type = fournisseur.categorie;
          update.deductible = !!fournisseur.deductible;
          update.categorieSuggeree = fournisseur.categorie;
          update.deductibleSuggere = !!fournisseur.deductible;
          update.fournisseurPatternId = fournisseur.id;
          update.fournisseurLabel = fournisseur.label;
          update.raisonClassification = fournisseur.raisonClassification || '';
        }

        const tag = `billId ${String(billId).padEnd(8)}  ${String(dep.montant || 0).padStart(8)}$  accId=${accountIdDestinataire}  iban=${ibanDestinataire}`;
        if (fournisseur) {
          console.log(`  ✓ ${tag}  →  ${fournisseur.label}  ${fournisseur.deductible ? '✓ dédu' : '✗ non-dédu'}`);
          depensesReclassees++;
        } else {
          console.log(`  · ${tag}  → enrichi (pas de pattern match)`);
        }
        depensesEnrichies++;

        if (APPLY) {
          await d.ref.set(update, { merge: true });
        }
      }
    }

    console.log(`\nRésumé :`);
    console.log(`  ${paiementsRecuesTrouves} paiements reçus (addmoney non-LTD avec Paiement facture)`);
    console.log(`  ${depensesEnrichies} dépenses enrichies avec accountId destinataire`);
    console.log(`  ${depensesReclassees} dépenses reclassées via pattern fournisseur`);
    console.log(`  ${orphelins} paiements sans dépense LTD correspondante (anomalie ou hors LTD)`);
    if (!APPLY) console.log(`\nDry-run. Relance avec --apply pour écrire.`);

    process.exit(0);
  } catch (err) {
    console.error('Erreur :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
