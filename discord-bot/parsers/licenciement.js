// ============================================================
// Parser : #logs-licenciement (bot Jéssica)
// ============================================================
// Format observé :
//   title : "***__EMPLOYÉ LICENCIÉ__***"
//   desc  :
//     🙍‍♂️ • **Employé**: <@discord_id>
//     🆔 • **ID**: `discord_id`
//     🆔 • **ID Personnage**: `121311`
//     📝 • **Nom**: `Omsbon`
//     📝 • **Prénom**: `Brad`
//     📱 • **N° Portable**: `9472104`
//     💳 • **IBAN**: `GZ92EU`
//     📅 • **Date d'embauche**: 30/03/2026 22:04:06
//     📅 • **Date de fin**: 20/04/2026 18:49:52
//     📌 • **Type**: Démission        (ou Licenciement, Exclusion, etc.)
//     👤 • **Licencié par**: krayzz.
//     📝 • **Raison**: *texte libre*
//     🔒 • **Casier libéré**: `Non attribué`
// ============================================================
// IMPORTANT : ce parser donne idPerso FiveM + idDiscord + tous les
// champs RH d'un coup. Permet de mettre a jour le user statut='exclu'
// ET de logger l'evenement complet pour audit.
// ============================================================

import { firstEmbed } from './_helpers.js';

// Parse le pattern "<emoji> • **Cle**: valeur" en lignes
function lineFields(desc) {
  const out = {};
  for (const line of String(desc || '').split('\n')) {
    const m = line.match(/\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    let val = m[2].trim();
    // Strip backticks et asterisques externes
    val = val.replace(/^`+|`+$/g, '').replace(/^\*+|\*+$/g, '').trim();
    out[key] = val;
  }
  return out;
}

function extractMention(s) {
  const m = String(s || '').match(/<@!?(\d+)>/);
  return m ? m[1] : '';
}

export function parseLicenciementEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;
  const title = e.title || '';
  if (!/EMPLOY[ÉE]\s+LICENCI[ÉE]|licenci/i.test(title)) return null;

  const desc = e.description || '';
  const f = lineFields(desc);

  return {
    type:             'licenciement',
    memberDiscordId:  extractMention(f['employé'] || f['employe'] || ''),
    discordId:        f['id'] || '',
    idPerso:          f['id personnage'] || '',
    nom:              (f['nom'] || '').toUpperCase(),
    prenom:           f['prénom'] || f['prenom'] || '',
    telephone:        f['n° portable'] || f['n portable'] || '',
    iban:             f['iban'] || '',
    dateEmbauche:     f["date d'embauche"] || f['date dembauche'] || f['date d embauche'] || '',
    dateFin:          f['date de fin'] || '',
    typeLicenciement: f['type'] || '',
    parQui:           f['licencié par'] || f['licencie par'] || '',
    raison:           f['raison'] || '',
    casierLibere:     f['casier libéré'] || f['casier libere'] || '',
    rawDescription:   desc
  };
}
