// ============================================================
// Parser : #statsbank (récap hebdo officiel FiveM) — V2 format réel
// Format observé :
//   "Semaine 15 (6-12 avr) : CA 622134$ | Sorties 629552$ | Déficit -7418$ |
//    Factures 362 → 240215$ | Tranche 5 (46%) | Top vendeurs : Curtis Lys 97 factures 60294,
//    Maverick Jackerton 88/41256, Ethan Miller 60/31673, Irina Harlow 46/13254,
//    Constantin Whitaker 44/82193$"
//
// Variantes :
//   - "Bénéfice" au lieu de "Déficit" si positif
//   - "Solde actuel" parfois absent
//   - "Top vendeurs" parfois absent (si pas de factures)
//   - Année non indiquée → on déduit de la date courante
// ============================================================

import { firstEmbed, getMoney } from './_helpers.js';

export function parseStatsbankEmbed(msg) {
  const e = firstEmbed(msg);
  let texte;
  if (e) {
    texte = `${e.title || ''} ${e.description || ''}`;
    (e.fields || []).forEach(f => texte += ` ${f.name}: ${f.value}`);
  } else {
    texte = msg.content || '';
  }

  // Doit contenir au moins "Semaine" + "CA"
  if (!/semaine/i.test(texte) || !/CA\s*[:\s]/i.test(texte)) return null;

  // Numéro de semaine (année optionnelle, on prend l'année courante par défaut)
  const matchSem = texte.match(/semaine\s+(\d+)(?:\s+(\d{4}))?/i);
  if (!matchSem) return null;
  const numeroSemaine = parseInt(matchSem[1], 10);
  const annee = matchSem[2] ? parseInt(matchSem[2], 10) : new Date().getFullYear();

  // Période texte (ex. "6-12 avr")
  const matchPeriode = texte.match(/\(([^)]+)\)/);
  const periode = matchPeriode ? matchPeriode[1].trim() : '';

  // Helpers d'extraction tolérants (avec ou sans :)
  const lire = (regex) => {
    const m = texte.match(regex);
    return m ? getMoney(m[1]) : 0;
  };
  const lireSigne = (regex) => {
    const m = texte.match(regex);
    if (!m) return 0;
    const negatif = /^-/.test(m[1]);
    const val = getMoney(m[1]);
    return negatif ? -val : val;
  };

  const ca           = lire(/ca\s*[:\s]\s*([\d\s.,]+)\s*\$/i);
  const sorties      = lire(/sorties?\s*[:\s]\s*([\d\s.,]+)\s*\$/i);
  // "Déficit -7418$" ou "Bénéfice 12345$" — déficit signifie négatif
  let beneficeBrut = 0;
  const matchDeficit = texte.match(/d[ée]ficit\s*[:\s]\s*(-?[\d\s.,]+)\s*\$/i);
  if (matchDeficit) {
    const val = getMoney(matchDeficit[1]);
    // si écrit "-7418" la valeur sera positive (getMoney filtre le signe)
    beneficeBrut = -Math.abs(val);
  } else {
    beneficeBrut = lire(/b[ée]n[ée]fice\s*(?:brut)?\s*[:\s]\s*([\d\s.,]+)\s*\$/i);
  }

  const soldeActuel  = lire(/solde\s+actuel\s*[:\s]\s*([\d\s.,]+)\s*\$/i);
  const loyers       = lire(/loyers?\s*[:\s]\s*([\d\s.,]+)\s*\$/i);
  const impotEstime  = lire(/imp[oô]t\s+estim[ée]\s*\([^)]*\)\s*[:\s]\s*([\d\s.,]+)\s*\$/i);

  // Tranche d'impôt (formats : "tranche 5, 46%" OU "Tranche 5 (46%)")
  const matchTranche = texte.match(/tranche\s+(\d+)\s*[,\s(]\s*(\d+)\s*%/i);
  const trancheImpot = matchTranche ? parseInt(matchTranche[1], 10) : null;
  const tauxImpot    = matchTranche ? parseInt(matchTranche[2], 10) : null;

  // Factures — 2 formats : "Factures 362 → 240215$" OU "Factures: 1 (260)"
  let nbFactures = 0, montantFactures = 0;
  const matchFactArrow = texte.match(/factures?\s*[:\s]\s*(\d+)\s*→\s*([\d\s.,]+)\s*\$/i);
  if (matchFactArrow) {
    nbFactures = parseInt(matchFactArrow[1], 10);
    montantFactures = getMoney(matchFactArrow[2]);
  } else {
    const matchFactPar = texte.match(/factures?\s*[:\s]\s*(\d+)\s*\(([\d.,]+)\)/i);
    if (matchFactPar) {
      nbFactures = parseInt(matchFactPar[1], 10);
      montantFactures = getMoney(matchFactPar[2]);
    }
  }

  // Payes (similaire)
  const matchPayes = texte.match(/payes?\s*[:\s]\s*(\d+)(?:\s*[(→]([\d.,]+)\)?)?/i);
  const nbPayes      = matchPayes ? parseInt(matchPayes[1], 10) : 0;
  const montantPayes = matchPayes && matchPayes[2] ? getMoney(matchPayes[2]) : 0;

  // === TOP VENDEURS (nouveauté) ===
  // Format : "Top vendeurs : Nom Prénom X factures Y, Nom2 Z/W, Nom3 A/B$"
  // (séparateurs incohérents : "X factures Y", "X/Y", virgules)
  const topVendeurs = [];
  const matchTop = texte.match(/top\s+vendeurs?\s*:?\s*(.+?)$/i);
  if (matchTop) {
    const blocTop = matchTop[1];
    // Pattern : "Prénom Nom (espace) NbFactures (factures|/) Montant"
    const reVendeur = /([\p{L}'][\p{L}'\s-]+?)\s+(\d+)\s*(?:factures?\s+|\/)\s*([\d.,]+)\s*\$?/giu;
    for (const m of blocTop.matchAll(reVendeur)) {
      const nomPrenom = m[1].trim();
      // Filtre : ignore les "fragments" trop courts (ex. "Mars" tout seul)
      if (nomPrenom.split(/\s+/).length < 2) continue;
      topVendeurs.push({
        nom: nomPrenom,
        nbFactures: parseInt(m[2], 10),
        montant: getMoney(m[3])
      });
    }
  }

  return {
    numeroSemaine,
    annee,
    periode,
    ca,
    sorties,
    beneficeBrut, // négatif si déficit
    soldeActuel,
    loyers,
    impotEstime,
    trancheImpot,
    tauxImpot,
    nbFactures,
    montantFactures,
    nbPayes,
    montantPayes,
    topVendeurs   // tableau [{ nom, nbFactures, montant }, …]
  };
}
