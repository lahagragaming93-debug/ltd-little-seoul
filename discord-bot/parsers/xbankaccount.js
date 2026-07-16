// ============================================================
// Parser : xbankaccount (script bancaire FiveM)
// Format observé dans #logs-ig :
//   Title: "xbankaccount - addmoney" ou "xbankaccount - removemoney"
//   Description: "Ajout/Retrait d'argent dans un compte"
//   Champs : iban, accountId, before, amount, after, reason
//   Pour les paiements de facture (Paiement facture N°XXX), l'embed contient
//   aussi : fromDiscord/Name/Propername (émetteur), toDiscord/Name/Propername
//   (destinataire). On capte ces champs pour identifier le compte cible (HDM,
//   Dynasty 8, etc.) — cross-référencé avec /depenses côté handler.
// IMPORTANT : on filtre uniquement iban == LTDLS (compte de l'entreprise).
// Tous les autres comptes (joueurs, autres entreprises) sont ignorés.
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

// IBAN du compte LTD (à modifier ici si jamais le compte change)
const IBAN_LTD = 'LTDLS';

export function parseXbankaccountEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  // Le title doit ressembler à "xbankaccount - <op>"
  // Variantes observées : addmoney / removemoney / withdraw / deposit
  // (Faab'Hook utilise withdraw au lieu de removemoney sur certains contextes)
  const title = (e.title || '').toLowerCase();
  if (!title.includes('xbankaccount')) return null;

  // Détecte le type d'opération
  let type;
  if (title.includes('addmoney') || title.includes('deposit'))    type = 'add';
  else if (title.includes('removemoney') || title.includes('withdraw')) type = 'remove';
  else return null; // autres types ignorés

  // 2026-05-14 Phase 3 : on capte 2 types d'embeds :
  //   1. iban == LTDLS → toutes les transactions LTD (comportement standard)
  //   2. iban != LTDLS MAIS type=add ET reason contient "Paiement facture N°"
  //      → c'est le destinataire d'une de NOS dépenses payée par facture.
  //      Permet l'identification automatique de HDM/Dynasty 8/etc. via leur
  //      accountId, sans besoin de mémoriser chaque N° de facture.
  const iban = (getField(e, 'iban') || '').trim();
  const accountId = getField(e, 'accountId') || getField(e, 'account id') || '';
  const before    = getMoney(getField(e, 'before'), true);
  const amount    = getMoney(getField(e, 'amount'), true);
  const after     = getMoney(getField(e, 'after'),  true);
  const reason    = getField(e, 'reason') || '';

  // Détection paiement de facture reçu par un fournisseur (côté destinataire)
  const factureMatch = reason.match(/Paiement\s+facture\s*N[°º]?\s*(\d+)/i);
  const billIdRecu = type === 'add' && factureMatch ? factureMatch[1] : null;

  if (iban !== IBAN_LTD) {
    // Compte non-LTD : on ne capte QUE si c'est une réception de facture
    // (sinon trop de bruit avec toutes les transactions RP de l'État).
    if (!billIdRecu) return null;
  }

  // Champs émetteur / destinataire :
  //  - Pour les paiements de facture (cancel embed), Faab'Hook fournit
  //    fromPropername / toPropername explicitement.
  //  - Pour les withdraw simples, il n'y a que name/properName du CALLER
  //    (= celui qui paye = LTD). Le destinataire (HDM, Dynasty 8…) n'est
  //    PAS dans l'embed et doit être identifié autrement (mapping facture-id
  //    via /config/global.fournisseurs).
  const fromDiscord    = (getField(e, 'fromDiscord')    || '').trim();
  const fromName       = (getField(e, 'fromName')       || '').trim();
  const fromPropername = (getField(e, 'fromPropername') || '').trim();
  const toDiscord      = (getField(e, 'toDiscord')      || '').trim();
  const toName         = (getField(e, 'toName')         || '').trim();
  const toPropername   = (getField(e, 'toPropername')   || '').trim();
  // Caller (qui a effectué la commande) — utile pour audit
  const callerName       = (getField(e, 'name')       || '').trim();
  const callerProperName = (getField(e, 'properName') || '').trim();
  const callerDiscord    = (getField(e, 'discord')    || '').trim();

  // Sécurité : si on n'a pas de chiffres cohérents, on skip
  if (!Number.isFinite(after) || !Number.isFinite(amount)) return null;

  return {
    type,         // 'add' (recette) | 'remove' (sortie)
    iban,
    accountId,
    soldeAvant: before,
    soldeApres: after,
    montant: amount,
    raison: reason,
    fromDiscord, fromName, fromPropername,
    toDiscord, toName, toPropername,
    callerName, callerProperName, callerDiscord,
    // Phase 3 : marqueur explicite pour les paiements reçus par un fournisseur
    billIdRecu,
    estLTD: iban === IBAN_LTD
  };
}
