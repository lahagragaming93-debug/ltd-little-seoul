// ============================================================
// Parser : facture payée — format FlashFA (Little Seoul).
// Sur ce serveur, le paiement d'une facture émet dans #logs-little-seoul :
//   Title: "xbankaccount - paid" (banque) ou "xbankaccount - paidCash" (espèces)
//   Description: "Payé" / "Payé en cash"
//   Champs (key:value) : billId, amount, reason, fromDiscord/fromName/
//   fromPropername (ÉMETTEUR de la facture = le vendeur), toDiscord/toName/
//   toPropername (client payeur), accountIdFrom, groupId, characterIdFrom/To,
//   createdTimeFormatted. PAS d'iban ni de soldes : le mouvement d'argent
//   correspondant ("addmoney · Paiement facture N°X", iban LTDLS) est déjà
//   capté par xbankaccount.js — ce parser ne produit QUE la fiche facture
//   (payload onFacture), déduplication assurée côté handler (doc fac-{billId}).
// Le logType "create" (facture émise non payée) est IGNORÉ : seule une facture
// payée est une vente. L'annulation reste gérée par factureCancel.js.
// ============================================================

import { firstEmbed, getField } from './_helpers.js';

export function parseFacturePaidEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = (e.title || '').toLowerCase();
  if (!title.includes('xbankaccount')) return null;
  // "paidcash" contient "paid" : un seul test suffit, mais on exclut
  // explicitement les autres logTypes (addmoney/withdraw/cancel/create).
  const isPaid = /\bpaid(cash)?\b/i.test(title);
  if (!isPaid) return null;

  const clean = (v) => String(v == null ? '' : v).replace(/^[a-zA-Z]+:/, '').trim();
  const billId = clean(getField(e, 'billId'));
  const amount = parseInt(clean(getField(e, 'amount')).replace(/[^\d-]/g, ''), 10);
  if (!billId || !Number.isFinite(amount) || amount <= 0) return null;

  const raison = clean(getField(e, 'reason'));
  const paiement = title.includes('paidcash') ? 'especes' : 'carte';

  return {
    factureId: billId,
    vendeurDiscord: clean(getField(e, 'fromDiscord')),
    vendeurNom: clean(getField(e, 'fromPropername')) || clean(getField(e, 'fromName')),
    clientDiscord: clean(getField(e, 'toDiscord')),
    clientNom: clean(getField(e, 'toPropername')) || clean(getField(e, 'toName')),
    montant: amount,
    raison,
    paiement,
    items: parseItemsFlashFA(raison)
  };
}

// La raison FlashFA est un texte libre ("3000 caoutchouc + 300 vis",
// "200 bidon d'essence pour MOF"). On tente les motifs quantité connus ;
// sans correspondance, items=[] et le handler traite la facture comme
// « particulier » sur le montant total (comportement legacy).
function parseItemsFlashFA(raison) {
  if (!raison) return [];
  const out = [];
  // "Nx Item" / "N x Item" (ex. "5x Bonbon, 2 x Cola Zero")
  const re1 = /(\d+)\s*[xX×]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]+?)(?=,|;|\+|$|\s+\d+\s*[xX×])/g;
  let m;
  while ((m = re1.exec(raison))) out.push({ quantite: parseInt(m[1], 10), nom: m[2].trim() });
  if (out.length) return out;
  // "Item xN" (ex. "Corde x1500")
  const re2 = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]*?)\s*[xX×]\s*(\d+)/g;
  while ((m = re2.exec(raison))) {
    const nom = m[1].trim(), qte = parseInt(m[2], 10);
    if (nom && qte > 0) out.push({ quantite: qte, nom });
  }
  if (out.length) return out;
  // "N item" séparés par + ou , (ex. "3000 caoutchouc + 300 vis")
  const re3 = /(\d+)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'\- ]+?)(?=\s*[+,;]|$)/g;
  while ((m = re3.exec(raison))) {
    const qte = parseInt(m[1], 10), nom = m[2].trim();
    if (nom && qte > 0) out.push({ quantite: qte, nom });
  }
  return out;
}
