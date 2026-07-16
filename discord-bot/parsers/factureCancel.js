// ============================================================
// Parser : xbankaccount - cancel (facture annulee IG)
// ============================================================
// Format observe dans #logs-ig (Faab'Hook) :
//   Title       : "xbankaccount - cancel"
//   Description : "Facture annulee"
//   Fields (cles importantes) :
//     billId                : 1914843        <- correspond a notre factureId
//     category              : xbill
//     logType               : cancel
//     amount                : 880
//     reason                : X110 Appats
//     cancellerDiscord      : <id>           <- qui a supprime la facture IG
//     cancellerName         : <discord>
//     cancellerPropername   : "Kyle Jackson"
//     fromDiscord/Name/Propername : emetteur original (vendeur)
//     toDiscord/Name/Propername   : destinataire original (client)
//     time                  : 1778759974 (epoch seconds)
//     formattedTime         : "13h59 14/05/2026"
//
// Filtre : logType == 'cancel' && category == 'xbill'.
// Pas de filtre IBAN ici (l'embed cancel ne porte pas d'iban). La selection
// des factures pertinentes pour le LTD se fait cote handler Firebase : on
// ne touche que les /ventes/fac-{billId} qui existent deja en base (donc
// emises par un employe LTD et trackees).
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

export function parseFactureCancelEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = (e.title || '').toLowerCase();
  if (!title.includes('xbankaccount')) return null;
  if (!title.includes('cancel')) return null;

  const logType  = (getField(e, 'logType')  || '').toLowerCase().trim();
  const category = (getField(e, 'category') || '').toLowerCase().trim();
  if (logType !== 'cancel') return null;
  if (category !== 'xbill') return null;

  const billId = (getField(e, 'billId') || '').trim();
  if (!billId) return null;

  const montant = getMoney(getField(e, 'amount'), true);

  const cancellerDiscord    = (getField(e, 'cancellerDiscord')    || '').trim();
  const cancellerName       = (getField(e, 'cancellerName')       || '').trim();
  const cancellerPropername = (getField(e, 'cancellerPropername') || '').trim();

  const fromDiscord    = (getField(e, 'fromDiscord')    || '').trim();
  const fromName       = (getField(e, 'fromName')       || '').trim();
  const fromPropername = (getField(e, 'fromPropername') || '').trim();

  const toPropername = (getField(e, 'toPropername') || '').trim();
  const reason       = (getField(e, 'reason')       || '').trim();

  // time : epoch en secondes. Si absent, on laisse null (handler utilisera serverTimestamp).
  const timeRaw = (getField(e, 'time') || '').trim();
  const time = timeRaw && /^\d+$/.test(timeRaw) ? parseInt(timeRaw, 10) : null;
  const formattedTime = (getField(e, 'formattedTime') || '').trim();

  return {
    billId,
    montant,
    raison: reason,
    cancellerDiscord,
    cancellerName,
    cancellerPropername,
    vendeurDiscord: fromDiscord,
    vendeurName: fromName,
    vendeurPropername: fromPropername,
    clientPropername: toPropername,
    time,
    formattedTime
  };
}
