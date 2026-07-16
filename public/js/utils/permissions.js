// ============================================================
// Permissions par rôle — LTD Little Seoul
// ============================================================

export const ROLES = {
  PATRON:                 'patron',
  CO_PATRON:              'co-patron',
  DRH:                    'drh',
  RESP_VENTE:             'responsable-vente',
  CHEF_EQUIPE:            'chef-equipe',
  RESP_POMPISTE:          'responsable-pompiste',
  VENDEUR_NOVICE:         'vendeur-novice',
  VENDEUR_INTER:          'vendeur-intermediaire',
  VENDEUR_EXP:            'vendeur-experimente',
  LIVREUR:                'livreur',
  POMPISTE_NOVICE:        'pompiste-novice',
  POMPISTE_INTER:         'pompiste-intermediaire',
  POMPISTE_EXP:           'pompiste-experimente',
  // Rôle TECHNIQUE temporaire (passation, support assistant)
  // Tous les droits du Patron côté UI/Admin, mais EXCLU des calculs financiers
  // (compta, masse salariale, salaires, effectif RH).
  ADMIN_TECHNIQUE:        'admin-technique'
};

export const ROLE_LABELS = {
  'patron':                  'Patron',
  'co-patron':               'Co-Patron',
  'drh':                     'DRH',
  'responsable-vente':       'Responsable Vente',
  'chef-equipe':             "Chef d'équipe",
  'responsable-pompiste':    'Responsable Pompiste',
  'vendeur-novice':          'Vendeur Novice',
  'vendeur-intermediaire':   'Vendeur Intermédiaire',
  'vendeur-experimente':     'Vendeur Expérimenté',
  'livreur':                 'Livreur',
  'pompiste-novice':         'Pompiste Novice',
  'pompiste-intermediaire':  'Pompiste Intermédiaire',
  'pompiste-experimente':    'Pompiste Expérimenté',
  'admin-technique':         'Admin Technique'
};

const DIRECTION = ['patron', 'co-patron'];
const SUPER_ADMINS = ['admin-technique'];
// Chef d'equipe : superviseur ventes. Perimetre RESTREINT (decision patron
// 2026-07-01) — voit UNIQUEMENT Stocks epicerie, Stations essence, Ventes (+ son
// espace, paies, guide, tuto). PAS de dashboard, compta, banque, RH, revenus
// carburant, notes de frais, ni admin. Le responsable-vente a EXACTEMENT le meme
// perimetre (il ne gere plus de comptes).
const CHEF = 'chef-equipe';
const LECTURE_COMPTA = [...DIRECTION, 'drh', ...SUPER_ADMINS];
const RH_FULL = [...DIRECTION, 'drh', ...SUPER_ADMINS];
const VENDEURS = ['vendeur-novice', 'vendeur-intermediaire', 'vendeur-experimente'];
// Livreur : equipe vente, paye comme un vendeur (part CA prorata, plafond 15 000)
// MAIS exempte d'avertissement quota — il fait les livraisons demandees par le
// patron, pas de cible CA disciplinaire. Le role 'livreur' (pas 'vendeur-*')
// echappe nativement a genererAvertissementsAuto (qui ne traite que /^vendeur-/
// et /^pompiste-/). Decision patron 2026-06-30.
const LIVREURS = ['livreur'];
const POMPISTES = ['pompiste-novice', 'pompiste-intermediaire', 'pompiste-experimente'];

export const ACCESS = {
  dashboard:         [...DIRECTION, 'drh', ...SUPER_ADMINS],
  stocks_epicerie:   [...DIRECTION, 'drh', 'responsable-vente', CHEF, 'responsable-pompiste', ...SUPER_ADMINS],
  stocks_essence:    [...DIRECTION, 'drh', 'responsable-vente', CHEF, 'responsable-pompiste', ...POMPISTES, ...SUPER_ADMINS],
  // Permission de MODIFICATION des stocks (ajuster une quantité, éditer un produit,
  // corriger l'inventaire). Différente de l'ACCÈS aux pages stocks ci-dessus (voir).
  // Par défaut : direction, DRH, resp. vente, resp. pompiste, super-admin. Le chef
  // d'équipe (et tout autre rôle) l'obtient au cas par cas via accesSupp — Admin >
  // Modifier le compte > « Permissions de modification ». Décision patron 2026-07-02.
  stocks_edit:       [...DIRECTION, 'drh', 'responsable-vente', 'responsable-pompiste', ...SUPER_ADMINS],
  ventes:            [...DIRECTION, 'drh', 'responsable-vente', CHEF, ...SUPER_ADMINS],
  // Déclaration de livraison : le livreur déclare ses livraisons (traçabilité,
  // SANS CA) ; la direction + DRH consultent l'historique. Décision patron 2026-07-02.
  livraisons:        [...DIRECTION, 'drh', ...LIVREURS, ...SUPER_ADMINS],
  // Droit de DÉCLARER une livraison : le livreur (par son rôle) + toute personne à qui
  // la direction accorde la permission (accesSupp, panneau « Permissions de modification »).
  // Une déclaration de livraison ne génère JAMAIS de CA ni de salaire (collection /livraisons
  // séparée des ventes) — quel que soit le rôle de la personne qui déclare.
  livraisons_declare: [...LIVREURS, ...SUPER_ADMINS],
  comptabilite:      LECTURE_COMPTA,
  // L'EDITION compta reste strictement direction + super-admin (PAS chef-equipe).
  comptabilite_edit: [...DIRECTION, ...SUPER_ADMINS],
  rh:                RH_FULL,
  stations:          [...DIRECTION, 'drh', 'responsable-vente', CHEF, 'responsable-pompiste', ...POMPISTES, ...SUPER_ADMINS],
  // Banque LTD : direction + DRH + super-admin uniquement (audit financier sensible)
  banque:            [...DIRECTION, 'drh', ...SUPER_ADMINS],
  revenus_carburant: [...DIRECTION, 'drh', 'responsable-pompiste', ...SUPER_ADMINS],
  // Admin : direction + DRH + responsable-pompiste (gere ses pompistes) + super-admin.
  // Responsable-vente et chef-equipe N'ONT PLUS acces (decision patron 2026-07-01).
  admin:             [...DIRECTION, 'drh', 'responsable-pompiste', ...SUPER_ADMINS],
  notes_frais:       [...DIRECTION, 'drh', 'responsable-pompiste', ...SUPER_ADMINS],
  employee:          [...DIRECTION, 'drh', ...VENDEURS, ...LIVREURS, ...POMPISTES,
                      'responsable-vente', CHEF, 'responsable-pompiste', ...SUPER_ADMINS],
  paies:             [...DIRECTION, 'drh', ...VENDEURS, ...LIVREURS, ...POMPISTES,
                      'responsable-vente', CHEF, 'responsable-pompiste', ...SUPER_ADMINS],
  guide:             [...DIRECTION, 'drh', ...VENDEURS, ...LIVREURS, ...POMPISTES,
                      'responsable-vente', CHEF, 'responsable-pompiste', ...SUPER_ADMINS],
  tuto:              [...DIRECTION, 'drh', ...VENDEURS, ...LIVREURS, ...POMPISTES,
                      'responsable-vente', CHEF, 'responsable-pompiste', ...SUPER_ADMINS]
};

// accesSupp : liste de pages accordees a l'employe EN PLUS de son role (overrides
// ADDITIFS geres depuis Admin > Modifier le compte). Jamais soustractif.
export function canAccess(role, page, accesSupp = []) {
  const allowed = ACCESS[page];
  if (!allowed) return false;
  if (allowed.includes(role)) return true;
  return Array.isArray(accesSupp) && accesSupp.includes(page);
}

export function isDirection(role)    { return DIRECTION.includes(role); }
export function isVendeur(role)      { return VENDEURS.includes(role); }
export function isLivreur(role)      { return LIVREURS.includes(role); }
export function isPompiste(role)     { return POMPISTES.includes(role); }
export function isResponsable(role)  { return role === 'responsable-vente' || role === 'responsable-pompiste'; }
export function isSuperAdmin(role)   { return SUPER_ADMINS.includes(role); }
export function isEmployeeView(role) {
  return isVendeur(role) || isLivreur(role) || isPompiste(role);
}

// Peut effectuer des actions pompiste (ravitailler une station, corriger
// un stock, déclarer caoutchoucs, note de frais essence) ?
// → pompistes classiques + responsable-pompiste (qui pilote l'équipe MAIS
//   peut aussi rouler en station si besoin). NB : son salaire reste fixe
//   (cf. salaireResponsablePompiste dans utils/paie.js) — ses ravits sont
//   tracés (collection /redistributionsPompiste, agrégats /quotasPompiste)
//   mais n'impactent PAS son propre salaire estimé.
export function isPompisteRavitailleur(role) {
  return isPompiste(role) || role === 'responsable-pompiste';
}
// Idem pour les ventes : vendeur-* + responsable-vente peut déclarer une
// vente (utile si le RV dépanne un client), mais sans CA personnel.
export function isVendeurDeclarateur(role) {
  return isVendeur(role) || isLivreur(role) || role === 'responsable-vente' || role === 'chef-equipe';
}

// Le rôle est-il pris en compte dans les calculs financiers
// (masse salariale, salaires affichés en compta, effectif RH facturable) ?
// Les admin-technique sont EXCLUS — c'est leur raison d'être.
export function compteEnFinance(role) {
  return !isSuperAdmin(role);
}

// ============================================================
// Hiérarchie de gestion des comptes
// ============================================================
// canManageUser(currentRole, targetRole) : currentRole peut-il créer/modifier/
// suspendre/supprimer un compte ayant targetRole ?
//
//   Patron        : tout
//   Co-Patron     : tout sauf Patron
//   DRH           : tout sauf Patron, Co-Patron (peut gérer un autre DRH)
//   Resp Vente    : uniquement vendeur-novice / vendeur-intermediaire / vendeur-experimente
//   Resp Pompiste : uniquement pompiste-novice / pompiste-intermediaire / pompiste-experimente
//   Autres rôles  : aucun (les vendeurs/pompistes ne gèrent personne)
export function canManageUser(currentRole, targetRole) {
  if (!currentRole || !targetRole) return false;
  // Super-admin technique : tous les droits, peut tout gérer (lui-même inclus)
  if (currentRole === 'admin-technique') return true;
  // Patron : tout, y compris admin-technique (sécurité — peut le retirer)
  if (currentRole === 'patron') return true;
  // Co-Patron : tout sauf Patron et Admin Technique
  if (currentRole === 'co-patron') return targetRole !== 'patron' && targetRole !== 'admin-technique';
  // DRH : tout sauf direction et admin-technique
  if (currentRole === 'drh') {
    return targetRole !== 'patron' && targetRole !== 'co-patron' && targetRole !== 'admin-technique';
  }
  if (currentRole === 'responsable-vente')   return VENDEURS.includes(targetRole) || LIVREURS.includes(targetRole);
  if (currentRole === 'responsable-pompiste')return POMPISTES.includes(targetRole);
  return false;
}

// Liste des rôles qu'un utilisateur peut assigner (création + changement de rôle)
export function assignableRoles(currentRole) {
  return Object.values(ROLES).filter(r => canManageUser(currentRole, r));
}

// La configuration globale (quotas, prix essence, webhook) : direction + super-admin
export function canEditConfig(role) {
  return isDirection(role) || isSuperAdmin(role);
}

// Création d'un nouveau produit dans le catalogue : direction + DRH + Resp Pompiste + super-admin
// 2026-05-22 : Resp Pompiste ajoute (demande patron — gestion complete des stocks epicerie).
export function canCreateProduit(role) {
  return isDirection(role) || role === 'drh' || role === 'responsable-pompiste' || isSuperAdmin(role);
}

export function defaultLandingPage(role) {
  if (isSuperAdmin(role)) return 'dashboard.html';
  if (isDirection(role) || role === 'drh') return 'dashboard.html';
  if (role === 'responsable-vente' || role === 'chef-equipe') return 'ventes.html';
  if (role === 'responsable-pompiste') return 'stations.html';
  return 'employee.html';
}

// Plafonds salaire (TTE Chap. IV - Secteur 2)
// admin-technique : 0 — il ne perçoit aucun salaire (rôle technique non rémunéré)
// drh : 18 000 $ FIXE (decision patron 2026-05-14, pas de variable)
export const PLAFOND_SALAIRE = {
  'patron':                   20000,
  'co-patron':                20000,
  'drh':                      18000,
  'responsable-vente':        17000,
  'chef-equipe':              16000,
  'responsable-pompiste':     17000,
  'vendeur-novice':           13000,
  'vendeur-intermediaire':    14000,
  'vendeur-experimente':      15000,
  'livreur':                  15000,
  'pompiste-novice':          13000,
  'pompiste-intermediaire':   14000,
  'pompiste-experimente':     15000,
  'admin-technique':          0
};

// Salaire DRH : montant FIXE (pas decide). Decision patron 2026-05-14.
export const DRH_SALAIRE_FIXE = 18000;

// LEGACY (non utilisee depuis 2026-05-24) : le responsable vente est desormais
// traite EXACTEMENT comme le responsable pompiste — salaire fixe au plafond
// (17 000 $) ou montant decide par le patron. Ses ventes/crafts ne sont PAS
// commissionnes. Constante conservee pour ne pas casser d'eventuels imports
// historiques mais plus utilisee dans le calcul de paie.
export const CA_PLAFOND_RESP_VENTE = 40000;

// === Vendeurs : systeme prorata CA + bonus quota fabrication ===
//
// Decision patron 2026-05-25 :
//   quotaCAVendeur = 50 000        (cible CA hebdo commissionnable)
//   plafond part CA = 8 / 9 / 10k  (novice / inter / exp)
//   bonus quota fab max = 5 000$   (score moyen × 5 000)
//   plafond total inchange = 13 / 14 / 15k (= plafondCA + bonusMax)
//
// Formule :
//   partCA   = MIN(CA / quotaCAVendeur, 1) × PLAFOND_CA_VENDEUR[role]
//   bonusFab = scoreQuotaFabrication(fab, quotaFab) × BONUS_QUOTA_VENDEUR_MAX
//   salaire  = MIN(partCA + bonusFab, PLAFOND_SALAIRE[role])
//
// Pour atteindre le plafond plein (13/14/15k) : 50 000 $ de CA commissionnable
// ET 100 % du quota fabrication.
//
// Le patron pilote la cible CA via config.quotaCAVendeur (panel RH > Quotas
// hebdo). Tant que quotaCAVendeur > 0, le systeme nouveau s'applique.
//
// Cf. /02-drh.md et /05-vendeur.md pour la doc.

// Garde defensif : la formule prorata n'a de sens que pour un quotaCAVendeur
// strictement positif (sinon division par zero). Accepte cfg ou valeur brute.
export function isNouveauSystemeVendeur(cfgOrQuotaCA) {
  const q = (cfgOrQuotaCA && typeof cfgOrQuotaCA === 'object')
    ? Number(cfgOrQuotaCA.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT)
    : Number(cfgOrQuotaCA);
  return Number.isFinite(q) && q > 0;
}

export const PLAFOND_CA_VENDEUR = {
  'vendeur-novice':         8000,
  'vendeur-intermediaire':  9000,
  'vendeur-experimente':    10000
};
export const BONUS_QUOTA_VENDEUR_MAX = 5000;
export const PRODUITS_QUOTA_FAB = [
  'bouteille-eau-purifiee',
  'mastic-carrosserie',
  'visseries',
  'pain-burger',
  'lumiere-violette',
  'sac-jute'
];

// Valeur par defaut quand config.quotaCAVendeur est absent en Firestore.
// = nouvelle cible CA depuis 2026-05-25.
export const QUOTA_CA_VENDEUR_DEFAULT = 50000;

// === Modele hybride Responsable Ventes + Chef d'equipe (decision patron 2026-06-21) ===
// Activation calee sur la cloture dominicale : la nouvelle formule ne s'applique
// QUE pour les semaines >= ce lundi (la semaine qui se termine le 21/06 reste a
// l'ancien modele : Responsable Ventes = salaire fixe). Comparaison lexicale de
// weekKey 'YYYY-MM-DD' (ISO) => sure.
export const PAIE_HYBRIDE_DEPUIS = '2026-06-22';
// Responsable Ventes : 10 000 fixe + part variable (meme taux qu'un vendeur
// experimente) plafonnee a 7 000 => plafond total 17 000 (atteint a 35 000 $ de CA).
export const RESP_VENTE_FIXE = 10000;
export const RESP_VENTE_VAR_MAX = 7000;
// Chef d'equipe : 8 000 fixe + part variable (meme taux vendeur exp) plafonnee a
// 8 000 => plafond total 16 000 (atteint a 40 000 $ de CA).
export const CHEF_EQUIPE_FIXE = 8000;
export const CHEF_EQUIPE_VAR_MAX = 8000;
// Livreur (revision decision patron 2026-07-02) : 5 000 fixe (livraisons) + part
// variable sur ses ventes declarees (meme taux qu'un vendeur experimente) plafonnee
// a 10 000 => plafond total 15 000 (atteint a 50 000 $ de CA perso). Sans bonus fab.
export const LIVREUR_FIXE = 5000;
export const LIVREUR_VENTE_VAR_MAX = 10000;

// Part variable "vente" : meme pourcentage qu'un vendeur experimente, soit le
// prorata du CA perso sur le quota vendeur x plafond CA exp (10 000 / 50 000 = 20%),
// puis plafonnee a varMax. Aucun bonus quota fabrication (decision patron : non).
export function partVariableVente(caParticulier, quotaCAVendeur, varMax) {
  const q = Number(quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  if (!(q > 0)) return 0;
  const tauxExpPlafond = PLAFOND_CA_VENDEUR['vendeur-experimente'] ?? 10000;
  const brut = Math.min(1, (caParticulier || 0) / q) * tauxExpPlafond;
  return Math.min(Math.round(brut), varMax);
}
