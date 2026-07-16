// ============================================================
// Calcul de la paie — au prorata du travail réel
// Réf : prompt projet, conforme TTE Chap. IV — Secteur 2
// ============================================================

import { PLAFOND_SALAIRE, PLAFOND_CA_VENDEUR, BONUS_QUOTA_VENDEUR_MAX,
         QUOTA_CA_VENDEUR_DEFAULT,
         PRODUITS_QUOTA_FAB, isNouveauSystemeVendeur,
         DRH_SALAIRE_FIXE,
         PAIE_HYBRIDE_DEPUIS, RESP_VENTE_FIXE, RESP_VENTE_VAR_MAX,
         CHEF_EQUIPE_FIXE, CHEF_EQUIPE_VAR_MAX, LIVREUR_FIXE, LIVREUR_VENTE_VAR_MAX, partVariableVente,
         isVendeur, isLivreur, isPompiste, isResponsable, isDirection } from './permissions.js';
import { weekId } from './formatters.js';

/**
 * Extrait les compteurs de fabrication d'un doc /quotasVendeur/{weekId}_{uid}.
 * Normalise a 0 les produits absents. Garantit que les call sites restent en
 * phase si on ajoute un 5e produit au catalogue.
 */
export function fabricationsFromQuotaDoc(quotaVDoc = {}) {
  const out = {};
  for (const id of PRODUITS_QUOTA_FAB) out[id] = Number(quotaVDoc?.[id] || 0);
  return out;
}

/**
 * Score quota fabrication vendeur — moyenne des ratios actifs.
 * Symetrique a scorePompiste : produit avec quota a 0 = desactive, ignore.
 * Si aucun produit actif (tous a 0) : 0.
 * Chaque ratio est plafonne a 1 (depasser un produit ne compense pas un autre).
 */
export function scoreQuotaFabrication(fabrications = {}, quotaFab = {}) {
  const ratios = [];
  for (const id of PRODUITS_QUOTA_FAB) {
    const q = Number(quotaFab[id] ?? 0);
    if (q > 0) {
      ratios.push(Math.min(1, (Number(fabrications[id] ?? 0)) / q));
    }
  }
  if (ratios.length === 0) return 0;
  return ratios.reduce((s, x) => s + x, 0) / ratios.length;
}

/**
 * Salaire vendeur — prorata CA sur quotaCAVendeur + bonus quota fabrication.
 *
 * Decision patron 2026-05-25 :
 *   quotaCAVendeur = 50 000, plafond part CA = 8/9/10k, bonus max = 5 000$.
 *   Plafond total inchange : 13/14/15k.
 *
 * Formule :
 *   partCA   = MIN(CA / quotaCAVendeur, 1) × PLAFOND_CA_VENDEUR[role]
 *   bonusFab = score_quota_fabrication × BONUS_QUOTA_VENDEUR_MAX
 *   total    = MIN(partCA + bonusFab, plafond[role])
 *
 * Si quotaCAVendeur <= 0 ou non finite : salaire = 0 (defensif).
 *
 * @param {string} role
 * @param {number} caGenere
 * @param {object} fabrications     { produitId: quantite, ... }  cumul semaine
 * @param {object} quotaFab         { produitId: quota, ... }     config hebdo
 * @param {number} quotaCAVendeur   cible CA hebdo (config.quotaCAVendeur)
 */
export function salaireVendeur(role, caGenere, fabrications = {}, quotaFab = {}, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
  if (!isVendeur(role)) return 0;
  const plafondSalaire = PLAFOND_SALAIRE[role] ?? 0;
  const qCA = Number(quotaCAVendeur);

  if (!isNouveauSystemeVendeur(qCA)) return 0;

  const plafondCA = PLAFOND_CA_VENDEUR[role] ?? 0;
  const ratioCA = qCA > 0 ? Math.min(1, (caGenere || 0) / qCA) : 0;
  const salaireCA = ratioCA * plafondCA;
  const bonusFab = scoreQuotaFabrication(fabrications, quotaFab) * BONUS_QUOTA_VENDEUR_MAX;
  return Math.min(Math.round(salaireCA + bonusFab), plafondSalaire);
}

/**
 * Salaire livreur (revision decision patron 2026-07-02) :
 *   5 000 $ FIXE pour honorer les livraisons de la semaine (les livraisons elles-memes
 *   ne generent toujours PAS de CA — page « Declaration de livraison »)
 *   + une part VARIABLE sur ses VENTES declarees, au meme taux qu'un vendeur
 *     experimente (prorata du CA perso sur le quota), plafonnee a 10 000 $.
 *   => total max 15 000 $ (atteint a 50 000 $ de CA perso).
 * MIROIR de paie-calc.mjs::salaireLivreur — garder synchronise.
 */
export function salaireLivreur(caParticulier = 0, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
  const variable = partVariableVente(caParticulier, quotaCAVendeur, LIVREUR_VENTE_VAR_MAX);
  return Math.min(LIVREUR_FIXE + variable, PLAFOND_SALAIRE['livreur'] ?? 15000);
}

/**
 * Salaire pompiste — moyenne des quotas actifs (bidons et/ou caoutchoucs).
 * Quota a 0 = dimension desactivee cette semaine, le plafond se reporte
 * entierement sur l'autre dimension. Si les deux sont a 0 : salaire = 0.
 */
export function salairePompiste(role, bidonsRealises, caoutchoucsRealises,
                                quotaBidons = 1700, quotaCaoutchoucs = 800) {
  if (!isPompiste(role)) return 0;
  const plafond = PLAFOND_SALAIRE[role] ?? 0;
  const scores = [];
  if (quotaBidons > 0)      scores.push(Math.min(1, (bidonsRealises      ?? 0) / quotaBidons));
  if (quotaCaoutchoucs > 0) scores.push(Math.min(1, (caoutchoucsRealises ?? 0) / quotaCaoutchoucs));
  if (scores.length === 0) return 0;
  const moyenne = scores.reduce((s, x) => s + x, 0) / scores.length;
  return Math.round(moyenne * plafond);
}

/**
 * Salaire responsable VENTE — fixe (saisi manuellement par patron, plafond 17 000)
 * Decision patron Blake 2026-05-24 : meme regime que le responsable POMPISTE.
 * Ses ventes/crafts personnels ne sont PAS commissionnes (il pilote son equipe).
 * Si non decide (null) ou setté à 0 par erreur → fallback sur plafond.
 * (Ancienne formule pro-rata `(CA / 40000) × 17000` abandonnee : annule l'idee
 * du 2026-05-14 — Blake clarifie que les deux responsables doivent etre traites
 * de maniere identique sur le calcul de paie.)
 */
export function salaireResponsableVente(salaireDecide, weekKey = null, caParticulier = 0, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
  const plafond = PLAFOND_SALAIRE['responsable-vente'] ?? 17000;
  // Nouveau modele hybride a partir de la semaine du 22/06 (decision patron
  // 2026-06-21) : 10 000 fixe + part variable (taux vendeur exp) plafonnee a 7 000.
  if (weekKey && weekKey >= PAIE_HYBRIDE_DEPUIS) {
    const variable = partVariableVente(caParticulier, quotaCAVendeur, RESP_VENTE_VAR_MAX);
    return Math.min(RESP_VENTE_FIXE + variable, plafond);
  }
  // Ancien regime (jusqu'au 21/06 inclus) : salaire fixe (decide ou plafond).
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

/**
 * Salaire Chef d'equipe (nouveau poste, decision patron 2026-06-21).
 * 8 000 fixe + part variable (meme taux qu'un vendeur experimente) plafonnee a
 * 8 000 => plafond total 16 000 (atteint a 40 000 $ de CA perso). Pas de bonus
 * fabrication. La part variable se calcule sur le CA particulier de la personne.
 */
export function salaireChefEquipe(caParticulier = 0, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
  const plafond = PLAFOND_SALAIRE['chef-equipe'] ?? 16000;
  const variable = partVariableVente(caParticulier, quotaCAVendeur, CHEF_EQUIPE_VAR_MAX);
  return Math.min(CHEF_EQUIPE_FIXE + variable, plafond);
}

/**
 * Salaire responsable POMPISTE — fixe (saisi manuellement par patron, plafond 17 000)
 * Si non decide (null) ou setté à 0 par erreur → fallback sur plafond.
 */
export function salaireResponsablePompiste(salaireDecide) {
  const plafond = PLAFOND_SALAIRE['responsable-pompiste'] ?? 17000;
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

/**
 * Salaire direction — fixe au plafond
 * DRH : montant FIXE (18 000 $) impose par le patron, salaireDecide ignore.
 * Patron / Co-Patron : decide manuellement, plafond 20 000. Si non decide ou
 * setté à 0 par erreur → fallback sur le plafond (sinon ils n'apparaissent pas
 * dans la masse salariale, ce qui fausse les stats TTE).
 */
export function salaireDirection(role, salaireDecide) {
  if (role === 'drh') return DRH_SALAIRE_FIXE;
  if (!isDirection(role)) return 0;
  const plafond = PLAFOND_SALAIRE[role] ?? 0;
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

/**
 * Calcule le salaire estimé d'un employé selon son rôle.
 * @param {object} e — fiche employé (role + métriques de la semaine)
 * @param {object} cfg — configuration (quotaBidons, quotaCaoutchoucs)
 */
export function salaireEstime(e, cfg = {}, weekKey = null) {
  const quotaBidons = cfg.quotaBidons ?? 1700;
  const quotaCaoutchoucs = cfg.quotaCaoutchoucs ?? 800;
  const quotaFab = cfg.quotaFabrication ?? {};
  const quotaCA = Number(cfg.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  // Par defaut on date sur la semaine en cours (affichage live). Les semaines
  // passees s'affichent via les snapshots /paiesEstimees, pas via ce calcul live.
  const wk = weekKey || weekId();

  if (isVendeur(e.role)) {
    return salaireVendeur(e.role, e.caGenere ?? 0, e.fabrications ?? {}, quotaFab, quotaCA);
  }
  if (isLivreur(e.role)) {
    return salaireLivreur(e.caGenere ?? 0, quotaCA);
  }
  if (isPompiste(e.role)) {
    return salairePompiste(e.role, e.bidonsRealises ?? 0,
                           e.caoutchoucsRealises ?? 0,
                           quotaBidons, quotaCaoutchoucs);
  }
  if (e.role === 'responsable-vente') {
    // Modele hybride a partir du 22/06 (fixe 10 000 + CA), sinon fixe historique.
    return salaireResponsableVente(e.salaireDecide ?? 0, wk, e.caGenere ?? 0, quotaCA);
  }
  if (e.role === 'chef-equipe') {
    return salaireChefEquipe(e.caGenere ?? 0, quotaCA);
  }
  if (e.role === 'responsable-pompiste') {
    return salaireResponsablePompiste(e.salaireDecide ?? 0);
  }
  if (isDirection(e.role) || e.role === 'drh') {
    return salaireDirection(e.role, e.salaireDecide ?? PLAFOND_SALAIRE[e.role]);
  }
  return 0;
}

/**
 * Score pompiste en pourcentage — moyenne des quotas actifs.
 * Quota a 0 = dimension desactivee, ignoree. Si tous a 0 : score = 0.
 */
export function scorePompiste(bidons, caoutchoucs, quotaBidons = 1700, quotaCaoutchoucs = 800) {
  const scores = [];
  if (quotaBidons > 0)      scores.push(Math.min(1, (bidons      ?? 0) / quotaBidons));
  if (quotaCaoutchoucs > 0) scores.push(Math.min(1, (caoutchoucs ?? 0) / quotaCaoutchoucs));
  if (scores.length === 0) return 0;
  return (scores.reduce((s, x) => s + x, 0) / scores.length) * 100;
}

// === Primes hebdomadaires (Art. 4-1.10) — tranches de CA ===
// Valeurs exemplatives — modifiables depuis le code si TTE évolue
export const PRIMES_HEBDO_TRANCHES = [
  { caMin: 0,        caMax: 200000,   prime: 0     },
  { caMin: 200000,   caMax: 400000,   prime: 5000  },
  { caMin: 400000,   caMax: 600000,   prime: 10000 },
  { caMin: 600000,   caMax: Infinity, prime: 15000 }
];

export function primeHebdo(ca) {
  const t = PRIMES_HEBDO_TRANCHES.find(t => ca >= t.caMin && ca < t.caMax);
  return t ? t.prime : 0;
}

export const PRIMES_MENSUELLES_TRANCHES = [
  { beneficeMin: 0,        beneficeMax: 500000,   prime: 0     },
  { beneficeMin: 500000,   beneficeMax: 1000000,  prime: 20000 },
  { beneficeMin: 1000000,  beneficeMax: 2000000,  prime: 40000 },
  { beneficeMin: 2000000,  beneficeMax: Infinity, prime: 60000 }
];

export function primeMensuelle(beneficeNet) {
  const t = PRIMES_MENSUELLES_TRANCHES.find(t =>
    beneficeNet >= t.beneficeMin && beneficeNet < t.beneficeMax);
  return t ? t.prime : 0;
}

// === Vérification masse salariale — TTE 90% du CA ===
export function checkMasseSalariale(masse, ca) {
  if (ca === 0) return { ok: false, ratio: 0, alerte: false };
  const ratio = masse / ca;
  return {
    ok: ratio <= 0.90,
    ratio,
    alerte: ratio > 0.85
  };
}
