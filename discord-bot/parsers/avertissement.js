// ============================================================
// Parser : #logs-avertissement (bot Jéssica)
// ============================================================
// Format observé (1 type pour l'instant, "Service trop court") :
//   title : "⚠️ Service trop court"
//   desc  :
//     🙍‍♂️ • **Membre**: <@discord_id>
//     ⏱️ • **Durée**: X minutes
//     🕒 • **Début**: HH:MM:SS
//     🕒 • **Fin**: HH:MM:SS
//     ✅ • *Envoyer un avertissement*  (boutons interactifs)
//     ❌ • *Ignorer*
// ============================================================

import { firstEmbed } from './_helpers.js';

function parseDescField(desc, key) {
  // Pattern : "<emoji> • **Cle**: valeur"
  const re = new RegExp(`\\*\\*${key}\\*\\*\\s*:?\\s*(.+?)(?=\\n|$)`, 'i');
  const m = desc.match(re);
  return m ? m[1].trim() : '';
}

export function parseAvertissementEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;
  const title = e.title || '';
  // Filtre : doit ressembler à un avertissement (titre OU contenu)
  const isAvertissement =
    /avertissement|service.*court/i.test(title) ||
    /avertissement/i.test(msg.content || '');
  if (!isAvertissement) return null;

  const desc = e.description || '';
  const memberMatch = desc.match(/Membre\*\*\s*:?\s*<@!?(\d+)>/i);
  const dureeMatch  = desc.match(/Dur[ée]e\*\*\s*:?\s*(\d+)\s*minutes?/i);

  // Sous-type = titre nettoyé (sans emojis ni étoiles)
  const sousType = title
    .replace(/[*_⚠️🚨ℹ️​-‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    type:             'avertissement',
    sousType:         sousType || 'avertissement',
    memberDiscordId:  memberMatch ? memberMatch[1] : '',
    dureeMinutes:    dureeMatch ? parseInt(dureeMatch[1], 10) : null,
    debut:            parseDescField(desc, 'Début'),
    fin:              parseDescField(desc, 'Fin'),
    rawDescription:   desc
  };
}
