// ============================================================
// Parser : xaction (stations-essence — format FlashFA)
// Deux événements observés (2026-07-16, salon #logs-little-seoul) :
//
//   "xaction - station_fill" (ravitaillement de la cuve par un employé)
//     vol_before, vol_after, vol_added, markerId, actionId, source,
//     characterId, discord, name, properName
//
//   "xaction - fuel_fill" (vente de carburant à un véhicule)
//     vol_before, vol_after, vol_removed, price, markerId, actionId,
//     vehicleId, vehicleModel, source, characterId, discord, name, properName
//     (le crédit banque arrive séparément via xbankaccount - addmoney,
//      reason "Redistribution N°<actionId>")
//
// Payload → handler onStationFuel côté botIngest :
//   { markerId, kind: 'fill'|'sale', volAfter, volDelta, price?,
//     acteurNom, acteurId, vehicleId?, timestamp }
// L'autorité du niveau de cuve est vol_after (robuste aux logs manqués).
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

export function parseXactionEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = (e.title || '').toLowerCase();
  if (!title.includes('xaction')) return null;

  let kind = null;
  if (title.includes('station_fill'))   kind = 'fill';
  else if (title.includes('fuel_fill')) kind = 'sale';
  else return null; // autres xaction : ignorés pour l'instant

  const markerId = (getField(e, 'markerId') || '').trim();
  if (!markerId) return null;

  const volAfter = getMoney(getField(e, 'vol_after'), true);
  const volDelta = kind === 'fill'
    ? getMoney(getField(e, 'vol_added'), true)
    : -getMoney(getField(e, 'vol_removed'), true);

  const payload = {
    markerId,
    kind,
    volAfter,
    volDelta,
    acteurNom: (getField(e, 'properName') || '').trim() || null,
    acteurId:  (getField(e, 'characterId') || '').trim() || null,
    timestamp: msg.createdTimestamp ? new Date(msg.createdTimestamp).toISOString() : new Date().toISOString()
  };
  if (kind === 'sale') {
    payload.price = getMoney(getField(e, 'price'), true);
    payload.vehicleId = (getField(e, 'vehicleId') || '').trim() || null;
  }
  return payload;
}
