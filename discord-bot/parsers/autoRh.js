// ============================================================
// Parser : #auto-rh (embauches + exclusions + départs)
// Formats observés (EN MAJUSCULES dans les vrais logs) :
//   "EXCLUSION : Prénom NOM (Discord:xxx, ID perso:xxx) exclu par Blake Patron (999...)"
//   "NOUVEL EMPLOYÉ : Prénom NOM (Discord:xxx, ID perso:xxx)"
//   "DÉPART : Prénom NOM (Discord:xxx, ID perso:xxx) — membre a quitté le groupe"
// ============================================================

import { firstEmbed } from './_helpers.js';

export function parseAutoRhEmbed(msg) {
  // Concatène title + description + fields pour parser au plus large
  const e = firstEmbed(msg);
  let texte;
  if (e) {
    texte = `${e.title || ''} ${e.description || ''}`;
    (e.fields || []).forEach(f => texte += ` ${f.name}: ${f.value}`);
  } else {
    texte = msg.content || '';
  }

  // Détection du type — 3 events possibles
  let type;
  if (/d[ée]part|quitt[ée]|left|leave/i.test(texte))                    type = 'depart';
  else if (/exclusion|licenci|exclu(?:\s|$)/i.test(texte))              type = 'exclusion';
  else if (/nouvel?\s+employ|embauche|nouveau\s+memb/i.test(texte))     type = 'embauche';
  else return null;

  // Extraction des IDs (les plus fiables)
  const idDiscord = (texte.match(/discord\s*:\s*(\d+)/i) || [])[1] || '';
  const idPerso   = (texte.match(/(?:id\s*)?perso\s*:\s*(\d+)/i) || [])[1] || '';

  if (!idDiscord && !idPerso) return null;

  // Extraction du nom (avant la première parenthèse)
  // Pattern : "[TYPE] : Prénom Nom (Discord:..."
  const matchNom = texte.match(/(?:nouvel?\s+employ[ée]?|exclusion|exclu|d[ée]part)\s*:?\s*([^()]+?)\s*\(/i);
  const fullName = (matchNom ? matchNom[1] : '').trim();
  const parts = fullName.split(/\s+/);
  const prenom = parts[0] || '';
  const nom = parts.slice(1).join(' ').toUpperCase() || '';

  // "exclu par X (Discord ID)" ou "embauché par X" — capte le nom + l'ID Discord du Patron si présent
  const matchPar = texte.match(/(?:exclu|embauch[ée])\s+par\s+([^()|]+?)(?:\s*\((\d+)\))?\s*(?:[|\n]|$)/iu);
  const parQui = matchPar ? matchPar[1].trim() : '';
  const parQuiIdDiscord = matchPar && matchPar[2] ? matchPar[2] : '';

  return { type, prenom, nom, idDiscord, idPerso, parQui, parQuiIdDiscord };
}
