// ============================================================
// Parser : logs-services
// Formats supportes :
//   - Ancien : "Service commencé/terminé Prénom NOM" (NOM en caps)
//   - Jessica 2026-05 : "Luciana Angel Mars a commencé son service."
//     (RP name en title case, plusieurs prenoms possibles, pas d'ID)
// ============================================================

import { firstEmbed } from './_helpers.js';

export function parseServiceEmbed(msg) {
  const text = embedText(msg) || msg.content || '';
  if (!text) return null;

  let action = null;
  if (/service\s+commenc[ée]/i.test(text)) action = 'start';
  else if (/service\s+termin[ée]/i.test(text)) action = 'end';
  else return null;

  // Format Jessica : "Luciana Angel Mars a commencé son service."
  let employeNom = '';
  const matchJessica = text.match(/^(.+?)\s+a\s+(?:commenc[ée]|termin[ée])\s+son\s+service/im);
  if (matchJessica) {
    employeNom = matchJessica[1].trim();
  } else {
    // Fallback ancien format "Prénom NOM"
    const m = text.match(/([A-ZÀ-Ÿ][a-zà-ÿ\-']+)\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-']+)/);
    if (m) employeNom = `${m[1]} ${m[2]}`;
  }

  // ID Discord ou character ID si presents (rares dans le format Jessica)
  const idDiscord = (text.match(/<@!?(\d+)>/) || [])[1] ||
                    (text.match(/discord:?\s*(\d{15,21})/i) || [])[1] || '';
  const idPerso = (text.match(/character[_ ]?id:?\s*([\w-]+)/i) || [])[1] || '';

  return {
    action,
    employeNom,
    employeIdDiscord: idDiscord,
    employeId: idPerso, // resolu cote Functions via /users (idPerso ou nom RP)
    timestamp: msg.createdTimestamp
  };
}

function embedText(msg) {
  const e = firstEmbed(msg);
  if (!e) return '';
  const parts = [e.title, e.description];
  if (e.fields) e.fields.forEach(f => parts.push(`${f.name}: ${f.value}`));
  return parts.filter(Boolean).join('\n');
}
