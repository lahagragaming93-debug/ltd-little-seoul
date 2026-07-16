// ============================================================
// Rattrape les anciennes annulations de facture IG (#logs-ig)
// ============================================================
// Avant le 2026-05-14, le parser xbankaccount ignorait les embeds
// "xbankaccount - cancel" → les ventes correspondantes restaient affichees
// comme "a declarer" dans le panel employe, alors qu'IG le vendeur les
// avait supprimees (typiquement : client pas solvable).
//
// Ce script :
//   1. Connecte Discord avec DISCORD_TOKEN
//   2. Fetch les N derniers messages de #logs-ig (paginated 100)
//   3. Filtre par parseFactureCancelEmbed (logType=cancel + category=xbill)
//   4. Pour chaque cancel, cherche /ventes/fac-{billId} dans Firestore
//   5. Si trouve et pas deja annule → marque annulee:true, cachee:true
//   6. Si la vente avait deja ete declaree manuellement → log + alerte direction
//
// IDEMPOTENT : si vente deja annulee, skip.
// ============================================================
// Usage :
//   cd discord-bot
//   node scripts/rattraper-factures-annulees.js                  dry-run, 500 msg
//   node scripts/rattraper-factures-annulees.js --apply
//   node scripts/rattraper-factures-annulees.js --apply --limit 2000
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { parseFactureCancelEmbed } from '../parsers/factureCancel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../firebase/serviceAccountKey.json');

const CHANNEL_ID  = process.env.CH_LOGS_IG;
const APPLY       = process.argv.includes('--apply');
const limitArgIdx = process.argv.indexOf('--limit');
const TOTAL_LIMIT = limitArgIdx > 0 ? Math.max(1, parseInt(process.argv[limitArgIdx + 1], 10) || 500) : 500;

if (!process.env.DISCORD_TOKEN) {
  console.error("Variable d'environnement manquante : DISCORD_TOKEN");
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error("Variable d'environnement manquante : CH_LOGS_IG");
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

client.once('ready', async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  console.log(`Mode : ${APPLY ? 'APPLY (ecrit dans Firestore)' : 'DRY-RUN'}`);
  console.log(`Canal : ${CHANNEL_ID} (#logs-ig), max ${TOTAL_LIMIT} messages\n`);

  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (!ch) throw new Error(`Canal ${CHANNEL_ID} introuvable`);
    console.log(`Canal trouve : #${ch.name}`);

    const messages = await fetchHistory(ch, TOTAL_LIMIT);
    console.log(`${messages.length} messages recuperes\n`);

    let cancelsTrouves = 0, ventesIntrouvables = 0, dejaAnnulees = 0,
        marquees = 0, alertesFraude = 0, errors = 0;

    for (const m of messages) {
      try {
        const payload = parseFactureCancelEmbed(m);
        if (!payload) continue;
        cancelsTrouves++;

        const billId = String(payload.billId);
        const docId = `fac-${billId}`;
        const ref = db.collection('ventes').doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
          ventesIntrouvables++;
          console.log(`  ${billId}  ↷ pas en base (facture d'une autre entite RP ou hors fenetre)`);
          continue;
        }
        const v = snap.data();
        if (v.annulee === true) {
          dejaAnnulees++;
          continue;
        }

        const annulateurNom = payload.cancellerPropername || payload.cancellerName || 'inconnu';
        const dateLisible = payload.formattedTime || (payload.time ? new Date(payload.time * 1000).toLocaleString('fr-FR') : '');
        const motif = `Supprimee IG par ${annulateurNom}${dateLisible ? ` le ${dateLisible}` : ''}`;
        const dejaDeclaree = v.source === 'manuelle' || !!v.remplaceeParId;

        console.log(`  ${billId.padEnd(8)}  ${(v.vendeurNom || '?').padEnd(20)}  ${String(v.montant || 0).padStart(6)} $  ←  ${motif}${dejaDeclaree ? '  ⚠ APRES DECLARATION' : ''}`);

        if (APPLY) {
          await ref.set({
            annulee: true,
            cachee: true,
            motifAnnulation: motif,
            annulateurDiscord: payload.cancellerDiscord || '',
            annulateurNom: annulateurNom,
            annulationSource: 'discord-cancel-backfill',
            dateAnnulation: FieldValue.serverTimestamp()
          }, { merge: true });
          marquees++;

          if (dejaDeclaree) {
            await db.collection('alertes').add({
              type: 'vente-annulee-apres-declaration',
              message: `⚠ [BACKFILL] Facture #${billId} (${v.montant || 0}$) annulee IG par ${annulateurNom} APRES declaration. Vendeur : ${v.vendeurNom || '?'}. Verifier que l'argent a bien ete rendu au client.`,
              gravite: 'warn',
              metadata: {
                factureId: billId,
                venteId: docId,
                vendeurId: v.vendeurId || null,
                vendeurNom: v.vendeurNom || '',
                annulateurNom,
                annulateurDiscord: payload.cancellerDiscord || '',
                montant: v.montant || 0,
                sourceVente: v.source || ''
              },
              resolue: false,
              timestamp: FieldValue.serverTimestamp()
            });
            alertesFraude++;
          }
        }
      } catch (err) {
        console.error(`  ERREUR sur msg ${m.id} : ${err.message}`);
        errors++;
      }
    }

    console.log(`\nResume :`);
    console.log(`  ${messages.length} messages recuperes`);
    console.log(`  ${cancelsTrouves} embeds 'xbankaccount - cancel' parses`);
    console.log(`  ${ventesIntrouvables} ignores (vente pas en base — autre entite RP ou hors fenetre)`);
    console.log(`  ${dejaAnnulees} ignores (deja annulees)`);
    if (APPLY) {
      console.log(`  ${marquees} ventes marquees annulee+cachee`);
      console.log(`  ${alertesFraude} alertes direction creees (annulation APRES declaration)`);
    } else {
      console.log(`  ${cancelsTrouves - ventesIntrouvables - dejaAnnulees} ventes seraient marquees (relance avec --apply)`);
    }
    console.log(`  ${errors} erreurs`);
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('Erreur fatale :', err.message);
    process.exit(2);
  }
});

client.login(process.env.DISCORD_TOKEN);
