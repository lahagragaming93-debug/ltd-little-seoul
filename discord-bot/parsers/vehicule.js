// ============================================================
// Parser : logs-vehicules (Jéssica)
// ============================================================
// Format observé :
//   Title       : 🚗 ***__VÉHICULE SORTI DU GARAGE__***
//                 (parfois "RENTRÉ DANS LE GARAGE" — à confirmer)
//   Description :
//     🙍‍♂️ • **Employé**: <@999759053381185596>
//     📛 • **Nom RP**: `Morgan Harper`
//     🎯 • **Character ID**: `104715`
//     🚘 • **Véhicule ID**: `994770`
//     📍 • **Marker ID**: `50171`
//     🆔 • **Action ID**: `49678`
//     🖥️ • **Source**: `567`
//     📅 • **Heure**: <t:1778336660:f>
// ============================================================

import { firstEmbed } from './_helpers.js';

function cleanDescription(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/`/g, '');
}

function extract(desc, label) {
  // Cherche "Label: valeur" dans une ligne, retourne la valeur (trim).
  const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i');
  const m = desc.match(re);
  return m ? m[1].trim() : '';
}

function extractDiscordId(s) {
  return ((s || '').match(/<@!?(\d+)>/) || [])[1] || '';
}

function extractTimestamp(s) {
  // Format Discord : <t:1778336660:f> => seconds epoch
  const m = (s || '').match(/<t:(\d+):/);
  return m ? Number(m[1]) * 1000 : null;
}

export function parseVehiculeEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const titleClean = String(e.title || '').replace(/[*_`]/g, '').toUpperCase();
  if (!titleClean.includes('VÉHICULE') && !titleClean.includes('VEHICULE')) return null;

  // Détection action : SORTI / RENTRÉ / autre
  let action = 'autre';
  if (titleClean.includes('SORTI'))  action = 'sortie';
  else if (titleClean.includes('RENTR') || titleClean.includes('RETOUR')) action = 'retour';

  const desc = cleanDescription(e.description);
  const employeRaw   = extract(desc, 'Employé');
  const employeDiscord = extractDiscordId(employeRaw);
  const employeNom   = extract(desc, 'Nom RP');
  const characterId  = extract(desc, 'Character ID');
  const vehiculeId   = extract(desc, 'Véhicule ID') || extract(desc, 'Vehicule ID');
  const markerId     = extract(desc, 'Marker ID');
  const actionId     = extract(desc, 'Action ID');
  const source       = extract(desc, 'Source');
  const heureRaw     = extract(desc, 'Heure');
  const heureMs      = extractTimestamp(heureRaw);

  return {
    action,
    employeDiscord,
    employeNom,
    characterId,
    vehiculeId,
    markerId,
    actionId,
    source,
    heureMs
  };
}
