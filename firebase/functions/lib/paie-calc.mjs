// ============================================================
// Calcul des paies — version backend (ESM)
// ============================================================
// Miroir backend de public/js/utils/paie.js et public/js/utils/permissions.js.
// Utilisée par snapshotPaiesEstimees (figeage des estimations à la cloture)
// et par le script de backfill W18.
//
// DECISION DESIGN (2026-05-18) :
//  - Duplication pragmatique de la logique de calcul (pas de bundling shared).
//  - Si tu modifies les commissions / plafonds / formules ici, mets a jour
//    public/js/utils/paie.js et public/js/utils/permissions.js en parallele.
//  - Tests d'integration : le script scripts/backfill-snapshot-paies-w18.mjs
//    compare la valeur calculee avec celle affichee sur /rh (semaine en
//    cours) pour s'assurer qu'on n'a pas dérivé.
// ============================================================

// === Plafonds salaire (TTE Chap. IV - Secteur 2) ===
export const PLAFOND_SALAIRE = {
  'patron':                   20000,
  'co-patron':                20000,
  'drh':                      20000,
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

export const DRH_SALAIRE_FIXE = 18000;
export const CA_PLAFOND_RESP_VENTE = 40000;

// === Vendeurs : prorata CA + bonus quota fabrication ===
// Voir public/js/utils/permissions.js pour la doc complete.
// Decision patron 2026-05-25 : quotaCAVendeur=50 000, plafondCA=8/9/10k,
// bonus max=5 000$, plafond total inchange 13/14/15k.
export const QUOTA_CA_VENDEUR_DEFAULT = 50000;

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

// === Modele hybride Responsable Ventes + Chef d'equipe (decision patron 2026-06-21) ===
// MIROIR de public/js/utils/permissions.js — garder synchronise.
// Activation calee sur la cloture dominicale : nouvelle formule SEULEMENT pour
// les semaines >= ce lundi. La semaine qui se termine le 21/06 (weekKey
// 2026-06-15) reste a l'ancien modele. Comparaison lexicale weekKey ISO => sure.
export const PAIE_HYBRIDE_DEPUIS = '2026-06-22';
export const RESP_VENTE_FIXE = 10000;
export const RESP_VENTE_VAR_MAX = 7000;
export const CHEF_EQUIPE_FIXE = 8000;
export const CHEF_EQUIPE_VAR_MAX = 8000;
// Livreur (revision decision patron 2026-07-02) : 5 000 fixe (livraisons) + part
// variable sur ses ventes declarees (taux vendeur exp) plafonnee a 10 000 => max 15 000.
// MIROIR de public/js/utils/permissions.js — garder synchronise.
const LIVREUR_FIXE = 5000;
const LIVREUR_VENTE_VAR_MAX = 10000;

// Part variable "vente" : meme taux qu'un vendeur experimente (prorata CA perso
// sur quota vendeur x plafond CA exp = 20%), plafonnee a varMax. Pas de bonus fab.
function partVariableVente(caParticulier, quotaCAVendeur, varMax) {
  const q = Number(quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  if (!(q > 0)) return 0;
  const tauxExpPlafond = PLAFOND_CA_VENDEUR['vendeur-experimente'] ?? 10000;
  const brut = Math.min(1, (caParticulier || 0) / q) * tauxExpPlafond;
  return Math.min(Math.round(brut), varMax);
}

const DIRECTION = ['patron', 'co-patron'];
const SUPER_ADMINS = ['admin-technique'];
const VENDEURS = ['vendeur-novice', 'vendeur-intermediaire', 'vendeur-experimente'];
const POMPISTES = ['pompiste-novice', 'pompiste-intermediaire', 'pompiste-experimente'];

export function isVendeur(role)      { return VENDEURS.includes(role); }
export function isLivreur(role)      { return role === 'livreur'; }
export function isPompiste(role)     { return POMPISTES.includes(role); }
export function isResponsable(role)  { return role === 'responsable-vente' || role === 'responsable-pompiste'; }
export function isDirection(role)    { return DIRECTION.includes(role); }
export function isSuperAdmin(role)   { return SUPER_ADMINS.includes(role); }
// admin-technique exclu des calculs financiers (cf. permissions.js)
export function compteEnFinance(role) { return !isSuperAdmin(role); }

// ============================================================
// Formules salaire
// ============================================================

function scoreQuotaFabrication(fabrications = {}, quotaFab = {}) {
  const ratios = [];
  for (const id of PRODUITS_QUOTA_FAB) {
    const q = Number(quotaFab[id] ?? 0);
    if (q > 0) ratios.push(Math.min(1, (Number(fabrications[id] ?? 0)) / q));
  }
  if (ratios.length === 0) return 0;
  return ratios.reduce((s, x) => s + x, 0) / ratios.length;
}

function salaireVendeur(role, caGenere, fabrications = {}, quotaFab = {}, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
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

// Salaire livreur (revision decision patron 2026-07-02) : 5 000 $ FIXE pour les
// livraisons (qui ne generent toujours PAS de CA — page « Declaration de livraison »)
// + part VARIABLE sur ses VENTES declarees (meme taux qu'un vendeur experimente)
// plafonnee a 10 000 => total max 15 000 (atteint a 50 000 $ de CA perso).
// MIROIR de public/js/utils/paie.js::salaireLivreur — garder synchronise.
function salaireLivreur(caParticulier = 0, quotaCAVendeur = QUOTA_CA_VENDEUR_DEFAULT) {
  const variable = partVariableVente(caParticulier, quotaCAVendeur, LIVREUR_VENTE_VAR_MAX);
  return Math.min(LIVREUR_FIXE + variable, PLAFOND_SALAIRE['livreur'] ?? 15000);
}

function salairePompiste(role, bidons, caoutchoucs, quotaBidons = 1700, quotaCaoutchoucs = 800) {
  if (!isPompiste(role)) return 0;
  const plafond = PLAFOND_SALAIRE[role] ?? 0;
  // Quota a 0 = dimension desactivee. Le plafond se redistribue sur les
  // dimensions actives uniquement. Si toutes a 0 : salaire = 0.
  const scores = [];
  if (quotaBidons > 0)      scores.push(Math.min(1, (bidons      ?? 0) / quotaBidons));
  if (quotaCaoutchoucs > 0) scores.push(Math.min(1, (caoutchoucs ?? 0) / quotaCaoutchoucs));
  if (scores.length === 0) return 0;
  const moyenne = scores.reduce((s, x) => s + x, 0) / scores.length;
  return Math.round(moyenne * plafond);
}

// Decision patron Blake 2026-05-24 : responsable-vente est traite exactement
// comme responsable-pompiste (salaire fixe au plafond 17000 ou montant decide
// patron). Ses ventes/crafts personnels ne sont PAS commissionnes — il pilote
// l'equipe vendeurs. Annule l'ancienne formule pro-rata du 2026-05-14.
// Decision patron 2026-06-21 : modele HYBRIDE a partir de la semaine du 22/06.
//   10 000 fixe + part variable (taux vendeur exp) plafonnee a 7 000 => max 17 000.
// Avant le 22/06 : ancien regime salaire fixe (decide ou plafond). La bascule est
// pilotee par weekKey (la cloture passe le weekKey de la semaine concernee).
function salaireResponsableVente(salaireDecide, weekKey, caParticulier, quotaCAVendeur) {
  const plafond = PLAFOND_SALAIRE['responsable-vente'] ?? 17000;
  if (weekKey && weekKey >= PAIE_HYBRIDE_DEPUIS) {
    const variable = partVariableVente(caParticulier, quotaCAVendeur, RESP_VENTE_VAR_MAX);
    return Math.min(RESP_VENTE_FIXE + variable, plafond);
  }
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

// Chef d'equipe (nouveau poste 2026-06-21) : 8 000 fixe + part variable (taux
// vendeur exp) plafonnee a 8 000 => max 16 000. Pas de bonus fabrication.
function salaireChefEquipe(caParticulier, quotaCAVendeur) {
  const plafond = PLAFOND_SALAIRE['chef-equipe'] ?? 16000;
  const variable = partVariableVente(caParticulier, quotaCAVendeur, CHEF_EQUIPE_VAR_MAX);
  return Math.min(CHEF_EQUIPE_FIXE + variable, plafond);
}

function salaireResponsablePompiste(salaireDecide) {
  const plafond = PLAFOND_SALAIRE['responsable-pompiste'] ?? 17000;
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

function salaireDirection(role, salaireDecide) {
  // DRH : salaire decide par le patron (deblocage 2026-07-22, plafond 20 000) ;
  // defaut DRH_SALAIRE_FIXE (18 000) sans montant decide. MIROIR de utils/paie.js.
  if (role === 'drh') {
    const plafond = PLAFOND_SALAIRE['drh'] ?? 20000;
    const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : DRH_SALAIRE_FIXE;
    return Math.min(Math.round(v), plafond);
  }
  if (!isDirection(role)) return 0;
  const plafond = PLAFOND_SALAIRE[role] ?? 0;
  const v = (salaireDecide != null && salaireDecide > 0) ? salaireDecide : plafond;
  return Math.min(Math.round(v), plafond);
}

// ============================================================
// API publique : calculerPaieEstimee
// ============================================================
//
// Calcule l'estimation hebdomadaire pour UN utilisateur.
//
// Inputs :
//  - user             : { id, role, prenom, nom, salaireDecide?, statut? }
//  - ventes           : Array<{ vendeurId, montant, montantParticulier?, benefice? }>
//                       deja filtre (cachee:false). Caller responsable du filtre.
//  - redistributions  : Array<{ ... }> (CA carburant — pas utilise pour les
//                       individus actuellement, mais accepte pour signature
//                       stable / extensions futures).
//  - quota            : { bidons, caoutchoucs } - quota pompiste de la semaine
//  - cfg              : { quotaBidons, quotaCaoutchoucs }
//
// Retourne :
//  {
//    montantEstime,    // $ a verser
//    ca,               // CA total de ses ventes
//    caParticulier,    // sous-total particulier (commissionnable)
//    bidons,           // quota pompiste rempli
//    caoutchoucs,      // quota pompiste rempli
//    formule           // libelle court de la formule appliquee (pour audit)
//  }
//
// Conventions :
//  - admin-technique : montantEstime = 0 (rôle technique non rémunéré).
//  - role inconnu    : montantEstime = 0.
//  - direction & responsable-pompiste : fallback sur PLAFOND si salaireDecide
//    null/0 (sinon ils n'apparaissent pas dans la masse salariale).
// ============================================================
export function calculerPaieEstimee({ user, ventes = [], redistributions = [], quota = null, quotaV = null, cfg = {}, weekKey = null } = {}) {
  if (!user) return { montantEstime: 0, ca: 0, caParticulier: 0, bidons: 0, caoutchoucs: 0, fabrications: {}, formule: 'no-user' };

  const role = user.role || '';
  const quotaBidons = cfg.quotaBidons ?? 1700;
  const quotaCaoutchoucs = cfg.quotaCaoutchoucs ?? 800;
  const quotaFab = cfg.quotaFabrication || {};
  const quotaCAVendeur = Number(cfg.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);

  // CA personnel = ventes attribuees a cet utilisateur
  const myVentes = ventes.filter(v => v.vendeurId === user.id);
  // Un don/subvention classé sur une vente ne compte ni dans le CA ni dans la
  // commission du vendeur (sinon salaire estimé gonflé artificiellement).
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente';
  const ca = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (Number(v.montant) || 0) : 0), 0);
  const caParticulier = myVentes.reduce(
    (s, v) => s + (estVenteCA(v) ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0
  );

  // Quota pompiste
  const bidons = quota?.bidons || 0;
  const caoutchoucs = quota?.caoutchoucs || 0;

  // Quota vendeur fabrication
  const fabrications = {};
  for (const id of PRODUITS_QUOTA_FAB) fabrications[id] = Number(quotaV?.[id] || 0);

  let montantEstime = 0;
  let formule = '';

  if (isVendeur(role)) {
    montantEstime = salaireVendeur(role, caParticulier, fabrications, quotaFab, quotaCAVendeur);
    formule = `vendeur (CA prorata ${quotaCAVendeur} + bonus quota fab max ${BONUS_QUOTA_VENDEUR_MAX})`;
  } else if (isLivreur(role)) {
    montantEstime = salaireLivreur(caParticulier, quotaCAVendeur);
    formule = `livreur (CA prorata ${quotaCAVendeur}, plafond ${PLAFOND_SALAIRE['livreur']}, sans avert. quota)`;
  } else if (isPompiste(role)) {
    montantEstime = salairePompiste(role, bidons, caoutchoucs, quotaBidons, quotaCaoutchoucs);
    formule = `pompiste (moyenne quota bidons/caoutchoucs)`;
  } else if (role === 'responsable-vente') {
    montantEstime = salaireResponsableVente(user.salaireDecide, weekKey, caParticulier, quotaCAVendeur);
    formule = (weekKey && weekKey >= PAIE_HYBRIDE_DEPUIS)
      ? `responsable-vente (10000 fixe + part CA max 7000)`
      : `responsable-vente (salaire fixe decide ou plafond)`;
  } else if (role === 'chef-equipe') {
    montantEstime = salaireChefEquipe(caParticulier, quotaCAVendeur);
    formule = `chef-equipe (8000 fixe + part CA max 8000)`;
  } else if (role === 'responsable-pompiste') {
    montantEstime = salaireResponsablePompiste(user.salaireDecide);
    formule = `responsable-pompiste (salaire decide ou plafond)`;
  } else if (role === 'drh') {
    montantEstime = salaireDirection('drh', user.salaireDecide);
    formule = (user.salaireDecide != null && user.salaireDecide > 0)
      ? `drh (salaire decide)`
      : `drh (defaut 18 000)`;
  } else if (isDirection(role)) {
    montantEstime = salaireDirection(role, user.salaireDecide);
    formule = `direction (salaire decide ou plafond)`;
  } else if (isSuperAdmin(role)) {
    montantEstime = 0;
    formule = `admin-technique (non remunere)`;
  } else {
    montantEstime = 0;
    formule = `role-inconnu:${role}`;
  }

  return {
    montantEstime,
    ca,
    caParticulier,
    bidons,
    caoutchoucs,
    fabrications,
    formule
  };
}

// ============================================================
// snapshotPaiesEstimees — appele a la cloture (manuelle ou cron)
// ============================================================
//
// Cree un doc /paiesEstimees/{weekKey}_{userId} par utilisateur actif au
// moment de la cloture, avec son estimation figee.
//
// Inputs :
//   - db          : Firestore admin instance
//   - FieldValue  : firestore.FieldValue (pour serverTimestamp)
//   - Timestamp   : firestore.Timestamp (pour les bornes de date)
//   - weekKey     : string YYYY-MM-DD (lundi de la semaine cloturee)
//   - debut, fin  : Date (bornes UTC de la semaine cloturee)
//
// Sortie :
//   { created, skipped, errors, total } : compteurs (pour log)
//
// Garanties :
//   - Idempotent : id deterministe {weekKey}_{userId}, skip si exists.
//   - Inclut TOUS les users actifs ayant compteEnFinance(role) (exclut
//     admin-technique, qui touche 0).
//   - Plante en silence si un user pose probleme : on log et on continue,
//     l'objectif est de NE PAS faire echouer la cloture.
// ============================================================
export async function snapshotPaiesEstimees({ db, FieldValue, Timestamp, weekKey, debut, fin }) {
  const result = { weekKey, created: 0, skipped: 0, errors: 0, total: 0 };

  if (!db || !FieldValue || !Timestamp) {
    console.error('[snapshotPaiesEstimees] arguments manquants', { hasDb: !!db });
    return result;
  }
  if (!weekKey || !debut || !fin) {
    console.error('[snapshotPaiesEstimees] weekKey/debut/fin requis', { weekKey });
    return result;
  }

  try {
    const [usersSnap, ventesSnap, quotasSnap, quotasVSnap, cfgSnap, redistSnap] = await Promise.all([
      db.collection('users').where('statut', '==', 'actif').get(),
      db.collection('ventes')
        .where('timestamp', '>=', Timestamp.fromDate(debut))
        .where('timestamp', '<=', Timestamp.fromDate(fin)).get(),
      db.collection('quotasPompiste').where('semaine', '==', weekKey).get(),
      db.collection('quotasVendeur').where('semaine', '==', weekKey).get(),
      db.collection('config').doc('global').get(),
      db.collection('redistributions')
        .where('timestamp', '>=', Timestamp.fromDate(debut))
        .where('timestamp', '<=', Timestamp.fromDate(fin)).get()
    ]);

    // Filtre les ventes "cachees" (doublons bot vs manuelle) cote serveur.
    const ventes = ventesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.cachee);
    const redistributions = redistSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const quotaByUser = {};
    quotasSnap.docs.forEach(d => {
      const q = d.data();
      if (q.employeId) quotaByUser[q.employeId] = q;
    });
    const quotaVByUser = {};
    quotasVSnap.docs.forEach(d => {
      const q = d.data();
      if (q.employeId) quotaVByUser[q.employeId] = q;
    });
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => compteEnFinance(u.role || ''));
    result.total = users.length;

    for (const user of users) {
      try {
        const snapId = `${weekKey}_${user.id}`;
        const ref = db.collection('paiesEstimees').doc(snapId);
        const existing = await ref.get();
        if (existing.exists) {
          result.skipped++;
          continue;
        }

        const calc = calculerPaieEstimee({
          user,
          ventes,
          redistributions,
          quota: quotaByUser[user.id] || null,
          quotaV: quotaVByUser[user.id] || null,
          cfg,
          weekKey   // date la formule (resp-vente hybride a partir du 22/06)
        });

        await ref.set({
          userId: user.id,
          weekKey,
          role: user.role || '',
          prenom: user.prenom || '',
          nom: user.nom || '',
          idDiscord: user.idDiscord || '',
          montantEstime: calc.montantEstime,
          ca: calc.ca,
          caParticulier: calc.caParticulier,
          bidons: calc.bidons,
          caoutchoucs: calc.caoutchoucs,
          fabrications: calc.fabrications,
          formule: calc.formule,
          paye: false,
          datePaiement: null,
          paieMatcheeId: null,
          paieMatcheeMontant: null,
          dateDebutSemaine: Timestamp.fromDate(debut),
          dateFinSemaine: Timestamp.fromDate(fin),
          createdAt: FieldValue.serverTimestamp()
        });
        result.created++;
      } catch (errUser) {
        result.errors++;
        console.error('[snapshotPaiesEstimees] erreur user', user.id, errUser?.message || errUser);
      }
    }

    console.log('[snapshotPaiesEstimees] OK', result);
    return result;
  } catch (err) {
    console.error('[snapshotPaiesEstimees] erreur globale', err?.message || err);
    result.errors++;
    return result;
  }
}
