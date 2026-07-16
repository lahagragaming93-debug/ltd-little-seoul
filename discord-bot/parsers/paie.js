// ============================================================
// Parser : paie
// Format observé :
//   PAIEMENT D'UN EMPLOYÉ
//   Payeur: Prénom NOM + ID Discord + ID Perso
//   Bénéficiaire: Prénom NOM + ID Discord + ID Perso
//   Montant: XXXX $
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

export function parsePaieEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;
  const title = ((e.title || '') + ' ' + (e.description || '')).toLowerCase();
  if (!title.includes('paiement') && !title.includes('paie')) return null;

  const payeur        = getField(e, 'payeur') || '';
  const beneficiaire  = getField(e, 'bénéficiaire') || getField(e, 'beneficiaire') || '';
  const montant       = getMoney(getField(e, 'montant'));

  const p = parsePerson(payeur);
  const b = parsePerson(beneficiaire);

  return {
    payeurNom:        p.nom,
    payeurDiscord:    p.discord,
    payeurIdPerso:    p.idPerso,
    beneficiaireNom:     b.nom,
    beneficiaireDiscord: b.discord,
    beneficiaireIdPerso: b.idPerso,
    montant
  };
}

function parsePerson(s) {
  if (!s) return { nom: '', discord: '', idPerso: '' };
  const discord = (s.match(/<@!?(\d+)>/) || [])[1] ||
                  (s.match(/discord:?\s*(\d{15,21})/i) || [])[1] || '';
  const idPerso = (s.match(/id\s*perso:?\s*([\w-]+)/i) || [])[1] ||
                  (s.match(/character[_ ]?id:?\s*([\w-]+)/i) || [])[1] || '';
  const nomMatch = s.replace(/<@!?\d+>/g, '').match(/([A-ZÀ-Ÿ][a-zà-ÿ\-']+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ\-']+)/);
  const nom = nomMatch ? nomMatch[1] : s.trim();
  return { nom, discord, idPerso };
}
