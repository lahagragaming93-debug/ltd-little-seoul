// ============================================================
// Parser : dépenses
// Format observé :
//   SORTIE D'ARGENT
//   Compte ID / Utilisateur / Montant / Solde avant / Solde après / Raison
//
// La déductibilité finale est décidée côté handler onDepense, qui croise
// avec /config/global.fournisseurs (patterns par boutiqueId / compte-cible /
// regex). Ce parser ne fait que pré-extraire les indices utiles :
//   - boutiqueId : extrait du pattern "Achat boutique N°XXX"
//   - factureId  : extrait du pattern "Paiement facture N°XXXXXXX"
//   - patternRaison : la raison normalisée pour le matching côté handler
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

export function parseDepenseEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = ((e.title || '') + ' ' + (e.description || '')).toLowerCase();
  if (!title.includes("sortie") && !title.includes("dépense") && !title.includes("depense")) return null;

  const compteId    = getField(e, 'compte id') || getField(e, 'compte') || '';
  const utilisateur = getField(e, 'utilisateur') || '';
  const montant     = getMoney(getField(e, 'montant'));
  const soldeAvant  = getMoney(getField(e, 'solde avant'));
  const soldeApres  = getMoney(getField(e, 'solde après') || getField(e, 'solde apres'));
  const raison      = getField(e, 'raison') || '';

  // Extraction des indices structurés depuis la raison
  // Ex. "Achat boutique N°263" -> boutiqueId = "263"
  const boutiqueMatch = raison.match(/Achat\s+boutique\s*N[°º]?\s*(\d+)/i);
  const boutiqueId = boutiqueMatch ? boutiqueMatch[1] : null;
  // Ex. "Paiement facture N°1910769" -> factureId = "1910769"
  const factureMatch = raison.match(/Paiement\s+facture\s*N[°º]?\s*(\d+)/i);
  const factureId = factureMatch ? factureMatch[1] : null;

  return {
    compteId,
    utilisateur,
    montant,
    soldeAvant,
    soldeApres,
    raison,
    boutiqueId,
    factureId
  };
}
