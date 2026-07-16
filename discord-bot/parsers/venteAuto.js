// ============================================================
// Parser : #ventes (ventes-auto LTD, distributeur in-game)
// Format observé :
//   "VENTE-1764721985287 | Vendeur: LTD | Client: Non spécifié |
//    Articles: Crème Glaci 2x24$ | Total: 48$"
//   "Type: Épicerie" parfois présent
// IMPORTANT : noms d'items avec typos FiveM (Crème Glaci, Crème Fruiche)
// → on capte tel quel et on les mappera plus tard via l'outil de découverte.
// ============================================================

import { firstEmbed, getMoney } from './_helpers.js';

export function parseVenteAutoEmbed(msg) {
  const e = firstEmbed(msg);
  let texte;
  if (e) {
    texte = `${e.title || ''} ${e.description || ''}`;
    (e.fields || []).forEach(f => texte += ` ${f.name}: ${f.value}`);
  } else {
    texte = msg.content || '';
  }

  // Doit ressembler à une vente-auto
  if (!/VENTE[-_]\d+/i.test(texte) && !/Vendeur\s*:?\s*LTD\b/i.test(texte)) {
    return null;
  }

  // ID de la vente
  const matchId = texte.match(/VENTE[-_](\d+)/i);
  const venteId = matchId ? matchId[1] : '';

  // Vendeur (toujours "LTD" pour ce canal)
  const matchVendeur = texte.match(/vendeur\s*:?\s*([^|\n]+?)(?:\s*\||$)/i);
  const vendeurNom = matchVendeur ? matchVendeur[1].trim() : 'LTD';

  // Client
  const matchClient = texte.match(/client\s*:?\s*([^|\n]+?)(?:\s*\||$)/i);
  const clientNom = matchClient ? matchClient[1].trim() : '';

  // Type (Épicerie / Essence / etc.)
  const matchType = texte.match(/type\s*:?\s*([^|\n]+?)(?:\s*\||$)/i);
  const typeVente = matchType ? matchType[1].trim() : '';

  // Articles : on capte le bloc complet (parsing item-par-item nécessite le mapping)
  const matchArticles = texte.match(/articles?\s*:?\s*([^|]+?)(?:\s*\|\s*total|$)/i);
  const articlesBrut = matchArticles ? matchArticles[1].trim() : '';

  // Parse les items individuels au format "NomItem QtyxPrix$"
  // Ex. "Crème Glaci 2x24$" → { nom: "Crème Glaci", quantite: 2, prixUnitaire: 24 }
  const items = [];
  const reItem = /([\p{L}\p{M}\d\s'.-]+?)\s+(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*\$/gu;
  for (const m of articlesBrut.matchAll(reItem)) {
    items.push({
      nomBrut: m[1].trim(),
      quantite: parseInt(m[2], 10),
      prixUnitaire: getMoney(m[3])
    });
  }

  // Total
  const matchTotal = texte.match(/total\s*:?\s*([\d\s.,]+)\s*\$/i);
  const montant = matchTotal ? getMoney(matchTotal[1]) : 0;

  if (montant <= 0 && items.length === 0) return null;

  return {
    venteId,
    vendeurNom,
    clientNom,
    typeVente,
    articlesBrut,
    items,
    montant,
    source: 'ventes-auto'  // marqueur pour distinguer dans la base
  };
}
