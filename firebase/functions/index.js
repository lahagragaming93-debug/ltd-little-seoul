// ============================================================
// Cloud Functions — LTD Little Seoul
// ============================================================
// Tâches :
//  - Clôture automatique chaque dimanche à 00 h 00 (heure Paris)
//  - Génération d'alertes (stocks, masse salariale)
//  - Helper HTTP pour le bot Discord (validation token + ingestion)
// ============================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest }  from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { defineSecret } from 'firebase-functions/params';
import { snapshotPaiesEstimees, PRODUITS_QUOTA_FAB, calculerPaieEstimee } from './lib/paie-calc.mjs';
import { snapshotSheetSemaine } from './lib/snapshot-sheet-semaine.mjs';
import { snapshotSheetTitle } from './lib/week-iso.mjs';

const SHEET_ID_COMPTA = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';

initializeApp();
const db = getFirestore();
const adminAuth = getAdminAuth();

const BOT_TOKEN       = defineSecret('LTD_BOT_INGEST_TOKEN');
const COMPTA_TOKEN    = defineSecret('LTD_COMPTA_EXPORT_TOKEN');
const DASHBOARD_SA_KEY = defineSecret('DASHBOARD_SA_KEY');
// Webhook Discord #ltd-little-seoul (serveur BLA) pour poster le JSON IRS à la clôture.
const BLA_LTD_JSON_WEBHOOK = defineSecret('BLA_LTD_JSON_WEBHOOK');
// Webhooks des salons de logs (serveur BLA) — JSON { "<salon>": "<url webhook>" }.
// Alimente le relai des logs IG (botIngest) + les logs site (logSite).
const LOG_WEBHOOKS = defineSecret('LTD_LOG_WEBHOOKS');

// ----------------------------------------------------------------
// 1. Clôture hebdomadaire — Lundi 00h00 Paris
// ----------------------------------------------------------------
// Cron déplacé du dim 00:00 au lundi 00:00 pour clôturer une semaine
// RP COMPLÈTE (lundi 00:00 → dimanche 23:59:59) et non tronquée.
// === Cloture etape 1 : ventes + depenses (lundi 00:00 Paris) ===
// Inclut aussi le CA carburant (/redistributions). Pas encore la masse
// salariale car les paies arrivent post-cloture (deadline mardi 21h).
// Statut = 'cloturee-partielle' jusqu'a la cloture etape 2.
export const clotureHebdo = onSchedule({
  schedule: '0 0 * * 1',
  timeZone: 'Europe/Paris',
  region:   'europe-west1',
  secrets:  [DASHBOARD_SA_KEY]
}, async () => {
  console.log('=== Début clôture hebdomadaire (étape 1 : ventes + dépenses) ===');
  const now = new Date();

  // À lundi 00:00 Paris (cron), on clôture la semaine qui vient de finir.
  // FIX 2026-06-08 : avant, `ref = now - 1ms`. Mais un cron ne se déclenche
  // JAMAIS à 00h00.000 pile (délai de quelques ms à quelques s). Donc now - 1ms
  // retombait sur LUNDI 00h00 → weekRangeRPParis renvoyait la semaine EN COURS
  // (fenêtre quasi nulle, vide) au lieu de la semaine précédente. Bug observé le
  // 2026-06-08 : doc /semaines/2026-06-08 "semaine 24" vide (ca=0), semaine 23
  // jamais fermée. Correctif ROBUSTE (indépendant du délai de déclenchement) :
  // on prend le LUNDI 00h00 de la semaine COURANTE (weekRangeRPParis(now).debut)
  // puis - 1ms → dimanche 23:59:59.999 Paris de la semaine PRÉCÉDENTE.
  // (clotureHebdoPaies étape 2 utilise now - 2j, déjà robuste.)
  const ref = new Date(weekRangeRPParis(now).debut.getTime() - 1);
  const { debut, weekKey } = weekRangeRPParis(ref);
  const fin = ref;

  // Agréger (ventes produits + ventes carburant + dépenses)
  const [ventesSnap, redistSnap, depensesSnap, cfgSnap] = await Promise.all([
    db.collection('ventes')
      .where('timestamp', '>=', Timestamp.fromDate(debut))
      .where('timestamp', '<=', Timestamp.fromDate(fin)).get(),
    db.collection('redistributions')
      .where('timestamp', '>=', Timestamp.fromDate(debut))
      .where('timestamp', '<=', Timestamp.fromDate(fin)).get(),
    db.collection('depenses')
      .where('timestamp', '>=', Timestamp.fromDate(debut))
      .where('timestamp', '<=', Timestamp.fromDate(fin)).get(),
    db.collection('config').doc('global').get(),
  ]);

  // Fige les OBJECTIFS de quota de la semaine (config globale au moment de la
  // cloture). Permet aux pilotages vendeurs/pompistes d'afficher les vrais
  // objectifs d'une semaine passee, et pas le quota courant (qui peut avoir
  // change depuis). Les realises sont deja archives (quotasVendeur/Pompiste).
  const cfgCloture = cfgSnap.exists ? cfgSnap.data() : {};
  const quotaConfig = {
    quotaBidons:       cfgCloture.quotaBidons       ?? 1700,
    quotaCaoutchoucs:  cfgCloture.quotaCaoutchoucs   ?? 800,
    quotaCAVendeur:    cfgCloture.quotaCAVendeur     ?? 50000,
    quotaFabrication:  cfgCloture.quotaFabrication   || {}
  };

  // Filtre = source='discord' (bot Faab'Hook) + !annulee.
  // STRICTEMENT identique a snapshotSheetSemaine ligne 543-545.
  // NE PAS ajouter !v.cachee : les ventes "cachees" sont en fait des ventes du
  // bot matchees avec une declaration manuelle, et restent valides pour l'audit
  // IRS. Patch 2026-05-25.
  const ventesFiltrees = ventesSnap.docs.map(d => d.data())
    .filter(v => v.source === 'discord' && !v.annulee);

  // Une entrée classée fiscalement hors 'vente' (don reçu/versé, subvention,
  // autre entrée) ne compte PAS dans le CA produits (Art 4-2.1 : CA = ventes/
  // contrats/abonnements). Défaut (champ absent) = 'vente' → inchangé.
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente';
  const caProduits  = ventesFiltrees.reduce((s, v) => s + (estVenteCA(v) ? (Number(v.montant) || 0) : 0), 0);
  const caCarburant = redistSnap.docs.reduce((s, d) => s + (Number(d.data().montant) || 0), 0);
  const ca          = caProduits + caCarburant;
  const benefice    = ventesFiltrees.reduce((s, v) => s + (estVenteCA(v) ? (Number(v.benefice) || 0) : 0), 0);
  // Entrées classées hors 'vente' (don reçu/versé, subvention, autre) : encaissées
  // mais HORS CA, à déclarer/afficher à part (don reçu imposable 10/30% Art 3-1.5).
  const entreesFiscales = {};
  ventesFiltrees.forEach(v => { const c = v.categorieFiscale; if (c && c !== 'vente') entreesFiscales[c] = (entreesFiscales[c] || 0) + (Number(v.montant) || 0); });
  const donsRecus = entreesFiscales['don-recu'] || 0;
  // Exclure les depenses type='paie' (doublon avec /paies) ET type='impot-paye'
  // (paiement d'impot = hors assiette, Art. 4-3.4 — ni charge ni poste declaration).
  const depensesReelles = depensesSnap.docs.filter(d => { const t = d.data().type; return t !== 'paie' && t !== 'impot-paye'; });
  const depTotal    = depensesReelles.reduce((s, d) => s + (d.data().montant || 0), 0);
  const dedu        = deductiblesAvecPlafondHonoraires(depensesReelles.map(d => d.data()));

  await db.collection('semaines').doc(weekKey).set({
    numero: weekKey,
    dateDebut: Timestamp.fromDate(debut),
    dateFin:   Timestamp.fromDate(fin),
    ca,
    caProduits,
    caCarburant,
    donsRecus,
    entreesFiscales,
    beneficeBrut: benefice,
    depenses: depTotal,
    chargesDeductibles: dedu,
    masseSalariale: 0,             // pas encore connue (sera mise en cloture etape 2)
    benefice: ca - depTotal,       // provisoire (sans masse)
    nbVentes: ventesFiltrees.length + redistSnap.size,
    nbDepenses: depensesSnap.size,
    quotaConfig,                   // objectifs de quota figes pour cette semaine
    statut: 'cloturee-partielle',
    dateCloture: FieldValue.serverTimestamp()
  }, { merge: true });

  console.log('Cloture etape 1 OK', weekKey, { ca, caProduits, caCarburant, depTotal });

  // === Auto-avertissements quotas non atteints ===
  // Genere AU MOMENT DE LA CLOTURE DES VENTES (dimanche 23:59 -> lundi 00:00).
  // Logique RP : si l'employe n'a pas rempli ses quotas a la fin de la semaine
  // (et donc avant que les paies soient versees), il prend l'avert tout de
  // suite. Pas besoin d'attendre mardi 21h05 (la cloture des paies est une
  // etape financiere distincte, sans rapport avec la performance hebdo).
  //
  // Pompiste : quota bidons OU caoutchoucs partiel -> 1 avert avec motif detaille
  // Vendeur  : CA hebdo < quotaCAVendeur -> 1 avert
  // Idempotent : id deterministe auto_{weekKey}_{uid} = max 1 avert auto/sem/user
  // Direction (patron, co-patron, admin-tech) jamais ciblee.
  try {
    await genererAvertissementsAuto(weekKey, debut, fin);
  } catch (e) {
    console.error('[avertissements-auto]', e);
  }

  // === Snapshot estimations paies (Option B 2026-05-18) ===
  // Fige les montants estimés par employe pour /rh "semaine precedente" +
  // pilotage "Reste a verser". Idempotent (id={weekKey}_{userId}).
  // Try/catch englobant : ne JAMAIS faire echouer la cloture si ca plante.
  try {
    const res = await snapshotPaiesEstimees({
      db, FieldValue, Timestamp, weekKey, debut, fin
    });
    console.log('[clotureHebdo] snapshot paies estimees:', res);
  } catch (e) {
    console.error('[clotureHebdo] snapshotPaiesEstimees error:', e?.message || e);
  }

  // === Snapshot onglet Sheet semaine (audit IRS, fige) ===
  // Cree/met-a-jour l'onglet "Semaine N (jj-jj mois aaaa)" dans le Sheet
  // Comptabilite. Idempotent : reecrit le meme onglet a la 2e cloture.
  // Try/catch englobant : JAMAIS faire echouer la cloture si Sheets KO.
  try {
    const semSnap = await db.collection('semaines').doc(weekKey).get();
    const semaineData = semSnap.exists ? semSnap.data() : {};
    const sheets = getSheetsClient();
    const snapSheetRes = await snapshotSheetSemaine({
      db, sheets, weekKey,
      weekDebut: debut, weekFin: fin,
      semaineData
    });
    console.log('[clotureHebdo] snapshot sheet semaine:', snapSheetRes);

    // === Rename onglets live Ventes/Depenses pour la NOUVELLE semaine ===
    // Au moment ou le cron tourne (lundi 00h00 Paris), la semaine RP courante
    // qui vient de commencer est la semaine N+1. On rename les onglets live
    // pour que leur titre explicite la semaine couverte.
    await renameLiveOnglets(sheets);
  } catch (e) {
    console.error('[clotureHebdo] snapshotSheetSemaine error:', e?.message || e);
  }
});

// Rename les onglets live "Ventes"/"Depenses" (ou variantes "Ventes Semaine N ...")
// avec le titre dynamique pour la semaine RP courante. Idempotent.
async function renameLiveOnglets(sheets) {
  try {
    // wkKey vient directement de weekRangeRPParis (calcul horloge Paris correct).
    // Avant : reconstruit via lundiCour.getDate() -> bug TZ (S-1 sur serveur UTC).
    const { debut: lundiCour, fin: dimCour, weekKey: wkKey } = weekRangeRPParis();
    // Ex : "Semaine 21 (18-24 mai 2026)"
    const suffix = snapshotSheetTitle(wkKey, lundiCour, dimCour).replace(/^Semaine /, 'Semaine ');
    const titleVentes  = `Ventes ${suffix}`;
    const titleDepenses = `Dépenses ${suffix}`;

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID_COMPTA, includeGridData: false });
    const reqs = [];
    for (const s of meta.data.sheets || []) {
      const t = s.properties.title;
      const id = s.properties.sheetId;
      if (/^Ventes( |$)/.test(t) && t !== titleVentes) {
        reqs.push({ updateSheetProperties: { properties: { sheetId: id, title: titleVentes }, fields: 'title' } });
      } else if (/^D[ée]penses( |$)/.test(t) && t !== titleDepenses) {
        reqs.push({ updateSheetProperties: { properties: { sheetId: id, title: titleDepenses }, fields: 'title' } });
      }
    }
    if (reqs.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID_COMPTA, requestBody: { requests: reqs } });
      console.log(`[renameLiveOnglets] ${reqs.length} onglet(s) renomme(s) -> ${titleVentes} / ${titleDepenses}`);
    } else {
      console.log('[renameLiveOnglets] noop (titres deja a jour)');
    }
  } catch (e) {
    console.error('[renameLiveOnglets] error:', e?.message || e);
  }
}

// === Cloture etape 2 : masse salariale + benefice net (mardi 21:05 Paris) ===
// Fenetre de paie : lundi N+1 00:00 -> mardi N+1 21:00. Au mardi 21:05, on
// recolte toutes les paies effectivement versees pour la semaine N (clos
// dimanche 23:59) et on finalise le doc /semaines.
export const clotureHebdoPaies = onSchedule({
  schedule: '5 21 * * 2',
  timeZone: 'Europe/Paris',
  region:   'europe-west1'
}, async () => {
  console.log('=== Début clôture hebdomadaire (étape 2 : paies) ===');
  const now = new Date();

  // Semaine close il y a 2 jours. À mardi 21:05 Paris, on vise un instant DANS
  // cette semaine (now - 2 jours = dimanche ~21h Paris) et on prend ses bornes
  // via weekRangeRPParis (horloge Paris, DST-correct).
  // Fix 2026-06-02 : avant, bornes via setHours(0,0,0,0) en UTC => lundi 02h
  // Paris l'été => trou lundi 00h-02h. Idem clotureHebdo.
  const { debut, fin, weekKey } = weekRangeRPParis(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));

  // Fenetre paie : lundi-S 02h00 -> lundi-S+1 02h00 Paris (decalee de 2h, coherent
  // avec cloturerSemaine).
  // EXCLUT explicitement les paies lun-S 00h-02h (= paies S-1 en creneau accelere legacy).
  // Patch 2026-05-25 v3.
  const debutFenetrePaie = new Date(debut.getTime() + 2 * 3600 * 1000);
  const finFenetrePaie = new Date(fin.getTime() + 1 + 2 * 3600 * 1000);

  // Recharge le doc semaine pour recalculer le benefice net
  const semSnap = await db.collection('semaines').doc(weekKey).get();
  if (!semSnap.exists) {
    console.error('Cloture etape 2 : doc /semaines/' + weekKey + ' introuvable. Etape 1 a echoue ?');
    return;
  }
  const sem = semSnap.data();

  // Skip si la semaine a deja ete cloturee manuellement par le patron (bouton
  // 🔒 /comptabilite). On laisse la valeur manuelle prevaloir pour preserver
  // la trace cloturePar / noteCloture / dateClotureManuelle.
  if (sem.statut === 'cloturee-manuelle' || sem.clotureManuelle === true) {
    console.log('Cloture etape 2 skip', weekKey, '- deja cloturee manuellement par', sem.cloturParNom || sem.cloturePar || '?');
    return;
  }

  const paiesSnap = await db.collection('paies')
    .where('timestamp', '>=', Timestamp.fromDate(debutFenetrePaie))
    .where('timestamp', '<=', Timestamp.fromDate(finFenetrePaie)).get();

  const masse = paiesSnap.docs.reduce((s, d) => s + (d.data().montant || 0), 0);
  const beneficeNet = (sem.ca || 0) - (sem.depenses || 0) - masse;

  await db.collection('semaines').doc(weekKey).set({
    masseSalariale: masse,
    benefice: beneficeNet,
    statut: 'cloturee',
    dateClotureFinale: FieldValue.serverTimestamp(),
    fenetrePaieDebut: Timestamp.fromDate(debutFenetrePaie),
    fenetrePaieFin: Timestamp.fromDate(finFenetrePaie)
  }, { merge: true });

  console.log('Cloture etape 2 OK', weekKey, { masse, beneficeNet, nbPaies: paiesSnap.size });
});

async function genererAvertissementsAuto(weekKey, debutSem, finSem) {
  const cfg = (await db.collection('config').doc('global').get()).data() || {};
  const quotaBidons       = Number(cfg.quotaBidons       ?? 1700);
  const quotaCaoutchoucs  = Number(cfg.quotaCaoutchoucs  ??  800);
  const quotaCAVendeur    = Number(cfg.quotaCAVendeur    ?? 50000);
  const quotaFab          = cfg.quotaFabrication || {};

  // Pre-fetch en parallele : users, ventes semaine, quotasPompiste, quotasVendeur.
  // Evite N round-trips sequentiels dans la boucle (cf. routine simplify).
  const [usersSnap, ventesSnap, quotasPSnap, quotasVSnap] = await Promise.all([
    db.collection('users').where('statut', '==', 'actif').get(),
    db.collection('ventes')
      .where('timestamp', '>=', Timestamp.fromDate(debutSem))
      .where('timestamp', '<=', Timestamp.fromDate(finSem)).get(),
    db.collection('quotasPompiste').where('semaine', '==', weekKey).get(),
    db.collection('quotasVendeur').where('semaine', '==', weekKey).get()
  ]);

  const caParVendeur = {};
  ventesSnap.docs.forEach(d => {
    const v = d.data();
    if (v.vendeurId && (!v.categorieFiscale || v.categorieFiscale === 'vente')) caParVendeur[v.vendeurId] = (caParVendeur[v.vendeurId] || 0) + (Number(v.montant) || 0); // don hors quota vendeur
  });
  const quotaPByUser = new Map(quotasPSnap.docs.map(d => [d.data().employeId, d.data()]));
  const quotaVByUser = new Map(quotasVSnap.docs.map(d => [d.data().employeId, d.data()]));

  // Pre-fetch des avertissements auto deja existants pour cette semaine.
  // Sans ce batch, on faisait 1 .get() par user (.docs.length round-trips).
  const avertsSnap = await db.collection('avertissements')
    .where('semaineSource', '==', weekKey).where('auto', '==', true).get();
  const avertsExistants = new Set(avertsSnap.docs.map(d => d.id));

  const batch = db.batch();
  let nbCrees = 0;

  for (const uDoc of usersSnap.docs) {
    const u = uDoc.data();
    const role = u.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    if (isDir) continue;

    const motifsManques = [];
    if (/^pompiste-/.test(role) || role === 'responsable-pompiste') {
      const q = quotaPByUser.get(uDoc.id) || { bidons: 0, caoutchoucs: 0 };
      const b = Number(q.bidons || 0);
      const c = Number(q.caoutchoucs || 0);
      // Quota a 0 = dimension desactivee : pas d'avertissement.
      if (quotaBidons      > 0 && b < quotaBidons)      motifsManques.push(`bidons ${b}/${quotaBidons}`);
      if (quotaCaoutchoucs > 0 && c < quotaCaoutchoucs) motifsManques.push(`caoutchoucs ${c}/${quotaCaoutchoucs}`);
    } else if (/^vendeur-/.test(role)) {
      const ca = caParVendeur[uDoc.id] || 0;
      if (ca < quotaCAVendeur) motifsManques.push(`CA ${Math.round(ca)} \$/${quotaCAVendeur} \$`);
      const qv = quotaVByUser.get(uDoc.id) || {};
      for (const pid of PRODUITS_QUOTA_FAB) {
        const q = Number(quotaFab[pid] || 0);
        if (q <= 0) continue;
        const fait = Number(qv[pid] || 0);
        if (fait < q) motifsManques.push(`${pid} ${fait}/${q}`);
      }
    } else {
      continue;
    }

    if (motifsManques.length === 0) continue;
    const id = `auto_${weekKey}_${uDoc.id}`;
    if (avertsExistants.has(id)) continue;
    batch.set(db.collection('avertissements').doc(id), {
      employeId: uDoc.id,
      employeNom: `${u.prenom || ''} ${u.nom || ''}`.trim(),
      motif: `Quota hebdo non atteint (semaine ${weekKey}) : ${motifsManques.join(', ')}`,
      parQui: 'system',
      parQuiNom: 'Clôture hebdo automatique',
      auto: true,
      actif: true,
      dateCreation: FieldValue.serverTimestamp(),
      semaineSource: weekKey
    });
    nbCrees++;
  }
  if (nbCrees > 0) await batch.commit();
  console.log(`[avertissements-auto] semaine ${weekKey} : ${nbCrees} avert(s) crees`);
}

// ----------------------------------------------------------------
// 2. Génération d'alertes au fil de l'eau
// ----------------------------------------------------------------

// Stock bas / rupture
// Le seuil et le nom sont stockés dans /produits/{id}, pas /stocks/{id}.
// /stocks contient juste la quantité (mise à jour par le bot Discord ou les
// ajustements manuels). On va donc lire le produit en parallèle.
export const alerteStock = onDocumentWritten({
  document: 'stocks/{id}',
  region: 'europe-west1'
}, async (event) => {
  const after = event.data?.after?.data();
  if (!after) return;
  const id = event.params.id;
  const qte = after.quantite ?? 0;

  // Récupère le seuil + nom depuis /produits/{id}
  const prodSnap = await db.collection('produits').doc(id).get();
  const prod = prodSnap.exists ? prodSnap.data() : {};
  const seuil = prod.seuilAlerte ?? after.seuilAlerte ?? 0;
  const nom   = prod.nom || after.nom || id;

  console.log(`[alerteStock] ${id} qte=${qte} seuil=${seuil} (produit=${prodSnap.exists})`);

  // Pas d'alerte tant qu'aucun seuil n'est configure manuellement (par le patron).
  // Couvre rupture ET stock bas — les valeurs par defaut (qte=0 sans seuil) ne
  // doivent pas spammer.
  if (seuil <= 0) return;
  if (qte === 0) {
    await creerAlerte('stock-rupture', `Rupture : ${nom}`, 'danger', { stockId: id });
  } else if (qte <= seuil) {
    await creerAlerte('stock-bas', `Stock bas : ${nom} (${qte}/${seuil})`, 'warn', { stockId: id });
  }
});

// Stations sous seuil — supporte seuil en L (seuilAlerte) ou en % (seuilAlertePct).
// Anti-spam : creerAlerte dédoublonne par stationId tant que l'alerte est non résolue.
// 2026-05-11 : aussi alerte info quand un pompiste modifie manuellement stockActuel
// (sourceMajAuto='modal-manuel-pompiste'), pour traçabilité audit hebdo direction.
export const alerteStation = onDocumentWritten({
  document: 'stations/{id}',
  region: 'europe-west1'
}, async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after) return;
  const stationId = event.params.id;
  const stockActuel = after.stockActuel || 0;
  const stockMax    = after.stockMax    || 0;
  const seuilL      = after.seuilAlerte    || 0;
  const seuilPct    = after.seuilAlertePct || 0;
  const nom = after.nom || stationId;

  // === Modification manuelle pompiste : alerte info audit ===
  // Sources pompiste :
  //   'modal-manuel-pompiste' (legacy, saisie directe stockActuel)
  //   'modal-bidons-pompiste' (depuis 2026-05-11, saisie en bidons 15L)
  // La direction utilise 'modal-manuel-direction' qui ne fire pas cette branche.
  const isPompisteEdit = before && before.stockActuel !== after.stockActuel && (
    after.sourceMajAuto === 'modal-manuel-pompiste' ||
    after.sourceMajAuto === 'modal-bidons-pompiste'
  );
  if (isPompisteEdit) {
    const auteur = after.derniereModifPar?.nom || after.derniereModifPar?.uid || 'pompiste inconnu';
    const ancien = before.stockActuel || 0;
    const delta  = stockActuel - ancien;
    const sens   = delta >= 0 ? `+${delta}` : `${delta}`;
    // Pas de dedupe (chaque modif manuelle = 1 alerte distincte avec timestamp)
    await db.collection('alertes').add({
      type: 'station-modif-manuelle',
      message: `🛢 ${auteur} a ravitaillé ${nom} : ${ancien.toLocaleString('fr-FR')} L → ${stockActuel.toLocaleString('fr-FR')} L (${sens} L)`,
      gravite: 'info',
      metadata: { stationId, ancien, nouveau: stockActuel, delta, auteur, source: after.sourceMajAuto },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });
  }

  // Seuil en litres absolus (ancien comportement)
  if (seuilL > 0 && stockActuel < seuilL) {
    await creerAlerte('station-bas',
      `Station ${nom} sous ${seuilL} L (actuel: ${stockActuel} L)`,
      'warn', { stationId });
    return;
  }
  // Seuil en pourcentage (nouveau, alimenté par stationsDashboard)
  if (seuilPct > 0 && stockMax > 0) {
    const pct = Math.round((stockActuel / stockMax) * 100);
    if (pct < seuilPct) {
      const gravite = pct < 5 ? 'danger' : 'warn';
      await creerAlerte('station-bas',
        `Station ${nom} à ${pct}% (seuil ${seuilPct}%) — ${stockActuel.toLocaleString('fr-FR')} / ${stockMax.toLocaleString('fr-FR')} L`,
        gravite, { stationId });
    }
  }
});

// Vente sans sortie de stock corrélée
export const alerteVenteSansStock = onDocumentCreated({
  document: 'ventes/{id}',
  region: 'europe-west1'
}, async (event) => {
  const v = event.data?.data();
  if (!v) return;
  if (v.stockVerifie === false) {
    await creerAlerte('vente-sans-stock',
      `Vente #${v.factureId} (${v.montant} $) sans sortie de stock corrélée.`,
      'warn', { venteId: event.params.id });
  }
});

async function creerAlerte(type, message, gravite = 'warn', metadata = {}) {
  // Anti-doublons : si metadata identifie une entité (stationId, stockId,
  // venteId), on dédoublonne par entité tant que l'alerte est non résolue —
  // évite le spam quand stockActuel fluctue. Sinon fallback sur le message.
  const dedupKey = metadata.stationId || metadata.stockId || metadata.venteId || message;
  const dejaSnap = await db.collection('alertes')
    .where('type', '==', type)
    .where('resolue', '==', false)
    .limit(50).get();
  const existe = dejaSnap.docs.find(d => {
    const m = d.data().metadata || {};
    const k = m.stationId || m.stockId || m.venteId || d.data().message;
    return k === dedupKey;
  });
  if (existe) {
    console.log(`[creerAlerte] doublon ignoré : ${type} key=${dedupKey}`);
    return;
  }

  await db.collection('alertes').add({
    type, message, gravite, metadata,
    resolue: false,
    timestamp: FieldValue.serverTimestamp()
  });
  console.log(`[creerAlerte] créée : ${type} "${message}" (gravite=${gravite})`);

  // Notification Discord (best effort, n'arrête pas le flow si échec)
  notifierDiscord(type, message, gravite).catch(e =>
    console.error('Discord webhook error:', e.message));
}

// Envoie l'alerte sur le webhook Discord configuré dans /config/global.discordWebhookAlertes
async function notifierDiscord(type, message, gravite) {
  const cfg = await db.collection('config').doc('global').get();
  const url = cfg.exists ? cfg.data().discordWebhookAlertes : null;
  if (!url) {
    console.log('[notifierDiscord] aucun webhook configuré dans /config/global.discordWebhookAlertes');
    return;
  }
  console.log(`[notifierDiscord] envoi vers webhook (${url.slice(0, 50)}…) — type=${type}`);
  const color = gravite === 'danger' ? 0xa02020 : (gravite === 'warn' ? 0xc97f1a : 0x4a6b8a);
  const emoji = gravite === 'danger' ? '🔴' : (gravite === 'warn' ? '⚠️' : 'ℹ️');
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `${emoji} LTD Little Seoul — ${type}`,
        description: message,
        color,
        timestamp: new Date().toISOString(),
        footer: { text: 'Plateforme LTD' }
      }]
    })
  });
}

// ============================================================
// notifyDeclarationDiscord — JSON IRS auto sur Discord à la clôture
// ------------------------------------------------------------
// Quand une semaine atteint la clôture COMPLÈTE (statut 'cloturee' [cron
// étape 2] ou 'cloturee-manuelle' [bouton patron] — la masse salariale est
// alors connue), génère le JSON IRS PLAT et le poste dans #ltd-little-seoul du
// serveur Discord BLA (webhook secret BLA_LTD_JSON_WEBHOOK).
// ⚠️ Le mapping dépenses -> postes IRS DOIT rester identique à celui du portail
// BLA (portals/ltd-little-seoul/assets/js/portal.js, loadWeek + buildIrsJson). BLA NE
// CALCULE PAS l'impôt : le JSON = des lignes, l'IRS applique les tranches à
// l'import. Idempotent via /blaJsonPosted/{weekKey}.
// ============================================================
function blaWeekNum(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// Total des dépenses déductibles (hors salaires) AVEC plafonds honoraires.
// Garde la définition "large" pour tous les postes (déductible !== false) mais
// cape les honoraires avocat (30 000, Art. 4-2.8) et comptable (8 000, Art. 7-9.3)
// pour rester cohérent avec le JSON IRS (buildIrsJsonFromWeek). `deps` = tableau
// d'objets dépense {type, montant, deductible} déjà filtrés (sans paie/impot-paye).
function deductiblesAvecPlafondHonoraires(deps) {
  const PLAFOND_AVOCAT = 30000, PLAFOND_COMPTA = 8000;
  let avocatBrut = 0, comptaBrut = 0, autresDed = 0;
  for (const d of deps) {
    if (d.deductible === false) continue;   // canonique : undefined => déductible
    const t = String(d.type || '').toLowerCase();
    const m = Number(d.montant) || 0;
    if (t === 'honoraires' || t === 'frais-avocat') avocatBrut += m;
    else if (t === 'frais-comptabilite') comptaBrut += m;
    else autresDed += m;
  }
  return autresDed + Math.min(avocatBrut, PLAFOND_AVOCAT) + Math.min(comptaBrut, PLAFOND_COMPTA);
}

function buildIrsJsonFromWeek(sem, depenseDocs) {
  const caProduits  = Number(sem.caProduits) || 0;
  const caCarburant = Number(sem.caCarburant) || 0;
  const donsRecus   = Number(sem.donsRecus) || (sem.entreesFiscales && sem.entreesFiscales['don-recu']) || 0;
  const masse       = Number(sem.masseSalariale) || 0;

  const D = { salaires: masse, prime_hebdo: 0, prime_mensuelle: 0, matiere_premiere: 0, nourriture: 0,
              frais_avocat: 0, locations: 0, achats_vehicules: 0, frais_vehicules: 0, caution_remboursee: 0, dons_verses: 0 };
  const N = { locations: 0, achats_vehicules: 0, autres: 0 };

  // Honoraires : avocat ('honoraires'/'frais-avocat') et comptable
  // ('frais-comptabilite') partagent le poste IRS "Frais avocat / comptable"
  // (frais_avocat) mais ont deux plafonds hebdo distincts (Art. 4-2.8 avocat
  // 30 000 $ ; Art. 7-9.3 cabinet comptable 8 000 $). On cumule le BRUT
  // déductible par bucket puis on cape APRES la boucle : la part <= plafond
  // reste en frais_avocat, le surplus bascule en autres_non_deductibles.
  // Doit rester IDENTIQUE à la ventilation de public/js/pages/comptabilite.js.
  const PLAFOND_AVOCAT = 30000, PLAFOND_COMPTA = 8000;
  let avocatBrut = 0, comptaBrut = 0;

  for (const doc of depenseDocs) {
    const d = doc.data();
    const type = String(d.type || '').toLowerCase();
    if (type === 'paie' || type === 'impot-paye') continue;   // paie (masse sal.) + impot (hors assiette)
    const m = Number(d.montant) || 0;
    const ded = d.deductible !== false;       // canonique LTD/CSV (undefined => déductible)
    if (ded) {
      if (type === 'matieres-premieres' || type === 'matiere-premiere') D.matiere_premiere += m;
      else if (type === 'frais-vehicule' || type === 'frais-vehicules' || type === 'entretien-vehicules' || type === 'entretien-vehicule') D.frais_vehicules += m;
      else if (type === 'nourriture') D.nourriture += m;
      else if (type === 'prime-hebdo') D.prime_hebdo += m;
      else if (type === 'prime-mensuelle') D.prime_mensuelle += m;
      else if (type === 'honoraires' || type === 'frais-avocat') avocatBrut += m;
      else if (type === 'frais-comptabilite') comptaBrut += m;
      else if (type === 'locations' || type === 'location' || type === 'loyer') D.locations += m;
      else if (type === 'vehicules' || type === 'achat-vehicule') D.achats_vehicules += m;
      else if (type === 'caution-remboursee') D.caution_remboursee += m;
      else if (type === 'dons' || type === 'don') D.dons_verses += m;
      else N.autres += m;                     // déductible sans poste IRS (ex 'autre-deductible' = impôt) -> Autres non déd.
    } else {
      if (type === 'locations' || type === 'location' || type === 'loyer') N.locations += m;
      else if (type === 'vehicules' || type === 'achat-vehicule') N.achats_vehicules += m;
      else N.autres += m;
    }
  }

  // Application des plafonds honoraires (déductible capé ; surplus -> non déductible).
  const avocatDed = Math.min(avocatBrut, PLAFOND_AVOCAT);
  const comptaDed = Math.min(comptaBrut, PLAFOND_COMPTA);
  D.frais_avocat = avocatDed + comptaDed;
  N.autres += (avocatBrut - avocatDed) + (comptaBrut - comptaDed);

  const debut = sem.dateDebut && sem.dateDebut.toDate ? sem.dateDebut.toDate() : new Date();
  const mid = new Date(debut.getTime() + 3.5 * 86400000);  // jeudi ~midi : n° de semaine ISO robuste au fuseau
  const wk = blaWeekNum(mid);
  const r = (n) => Math.round(n || 0);

  const json = {
    numero_semaine: String(wk.week),
    commentaire: 'Préparée par BLA Corporate · Andrew BEAUCHAMP · semaine ' + wk.week + '/' + wk.year,
    ca: r(caProduits + caCarburant),
    autres_revenus: 0,
    dons_recus: r(donsRecus),
    sacem: 0,
    caution_encaissee: 0,
    salaires: r(D.salaires),
    prime_hebdo: r(D.prime_hebdo),
    prime_mensuelle: r(D.prime_mensuelle),
    matiere_premiere: r(D.matiere_premiere),
    nourriture: r(D.nourriture),
    frais_avocat: r(D.frais_avocat),
    locations_deductibles: r(D.locations),
    achats_vehicules_deductibles: r(D.achats_vehicules),
    frais_vehicules: r(D.frais_vehicules),
    caution_remboursee: r(D.caution_remboursee),
    dons_verses: r(D.dons_verses),
    locations_non_deductibles: r(N.locations),
    achats_vehicules_non_deductibles: r(N.achats_vehicules),
    autres_non_deductibles: r(N.autres)
  };
  const totalDeductibles = D.salaires + D.prime_hebdo + D.prime_mensuelle + D.matiere_premiere + D.nourriture
    + D.frais_avocat + D.locations + D.achats_vehicules + D.frais_vehicules + D.caution_remboursee + D.dons_verses;
  return { json, week: wk.week, caTotal: caProduits + caCarburant, totalDeductibles: r(totalDeductibles), donsRecus: r(donsRecus) };
}

export const notifyDeclarationDiscord = onDocumentWritten({
  document: 'semaines/{weekKey}',
  region: 'europe-west1',
  secrets: [BLA_LTD_JSON_WEBHOOK]
}, async (event) => {
  const after  = event.data?.after?.data();
  const before = event.data?.before?.data();
  if (!after) return;
  const isFull = (s) => s === 'cloturee' || s === 'cloturee-manuelle';
  if (!isFull(after.statut) || (before && isFull(before.statut))) return;   // 1× à la clôture complète

  const weekKey = event.params.weekKey;
  const postedRef = db.collection('blaJsonPosted').doc(weekKey);
  if ((await postedRef.get()).exists) return;                                // idempotence (backstop)

  const webhook = BLA_LTD_JSON_WEBHOOK.value();
  if (!webhook) { console.log('[notifyDeclarationDiscord] webhook absent (secret non défini)'); return; }
  if (!after.dateDebut || !after.dateFin) { console.log('[notifyDeclarationDiscord] bornes absentes', weekKey); return; }

  const depSnap = await db.collection('depenses')
    .where('timestamp', '>=', after.dateDebut)
    .where('timestamp', '<=', after.dateFin).get();

  const res = buildIrsJsonFromWeek(after, depSnap.docs);
  const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
  const IRS_URL = 'https://sanandreas-gouv-irs.ovh/declaration-impots';

  let bloc = '```json\n' + JSON.stringify(res.json, null, 2) + '\n```';
  const intro = 'Déclaration IRS — semaine S' + res.week + ' prête à importer. Copie ce bloc :\n';
  if ((intro + bloc).length > 1900) bloc = '```json\n' + JSON.stringify(res.json) + '\n```';
  const content = intro + bloc;

  const donTag = res.donsRecus > 50000 ? ' · imposé 30%' : (res.donsRecus > 0 ? ' · imposé 10%' : '');
  const embed = {
    title: 'Semaine S' + res.week + ' clôturée — JSON IRS prêt',
    color: 13215073,
    description: 'Va sur le portail IRS, étape 1 « Importer JSON », colle le bloc ci-dessus, vérifie et soumets. L\'impôt est calculé automatiquement par l\'IRS.',
    fields: [
      { name: 'Chiffre d\'affaires', value: fmt(res.caTotal) + ' $', inline: true },
      { name: 'Charges déductibles', value: fmt(res.totalDeductibles) + ' $', inline: true },
      { name: 'Dons reçus', value: fmt(res.donsRecus) + ' $' + donTag, inline: true },
      { name: 'Portail IRS', value: '[sanandreas-gouv-irs.ovh/declaration-impots](' + IRS_URL + ')' }
    ],
    footer: { text: 'BLA Corporate · Andrew BEAUCHAMP' },
    timestamp: new Date().toISOString()
  };

  try {
    const resp = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, embeds: [embed] })
    });
    if (!resp.ok) { console.error('[notifyDeclarationDiscord] webhook HTTP', resp.status, (await resp.text()).slice(0, 300)); return; }
    await postedRef.set({ weekKey, week: res.week, postedAt: FieldValue.serverTimestamp() });
    console.log('[notifyDeclarationDiscord] JSON IRS posté pour', weekKey, 'S' + res.week);
  } catch (e) {
    console.error('[notifyDeclarationDiscord] erreur post', e?.message || e);
  }
});

// ----------------------------------------------------------------
// Trigger : recompte les avertissements actifs d'un employe et
// denormalise sur /users/{uid}.avertsActifs (utilise par les rules
// Firestore et par le frontend pour bloquer les ecritures sensibles
// quand >= 3).
// ----------------------------------------------------------------
export const onAvertissementChange = onDocumentWritten({
  document: 'avertissements/{id}',
  region: 'europe-west1'
}, async (event) => {
  const after  = event.data?.after?.data();
  const before = event.data?.before?.data();
  const employeId = after?.employeId || before?.employeId;
  if (!employeId) return;
  const snap = await db.collection('avertissements')
    .where('employeId', '==', employeId)
    .where('actif', '==', true)
    .get();
  const nb = snap.size;
  await db.collection('users').doc(employeId).set({ avertsActifs: nb }, { merge: true });
  console.log(`[avertsActifs] user=${employeId} -> ${nb}`);
});

// ----------------------------------------------------------------
// 3. Endpoint HTTP pour le bot Discord — ingestion sécurisée
// ----------------------------------------------------------------
// Le bot envoie des évènements parsés ; cette fonction valide le
// token puis route vers le bon parser/écriture Firestore.
// ----------------------------------------------------------------

export const botIngest = onRequest({
  region: 'europe-west1',
  cors: false,
  invoker: 'public',          // webhook : invocation libre, sécurité par token x-bot-token
  secrets: [BOT_TOKEN, LOG_WEBHOOKS]
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const token = req.get('x-bot-token');
  if (!token || token !== BOT_TOKEN.value()) return res.status(401).send('Unauthorized');

  const { type, payload } = req.body || {};
  if (!type || !payload) return res.status(400).send('Missing type/payload');

  try {
    switch (type) {
      case 'inventory':       await onInventory(payload); break;
      case 'service':         await onService(payload); break;
      case 'stationFuel':     await onStationFuel(payload); break;
      case 'facture':         await onFacture(payload); break;
      case 'redistribution':  await onRedistribution(payload); break;
      case 'depense':         await onDepense(payload); break;
      case 'paie':            await onPaie(payload); break;
      case 'coffre':          await onCoffre(payload); break;
      case 'bankAccount':     await onBankAccount(payload); break;
      case 'factureCancel':   await onFactureCancel(payload); break;
      case 'autoRh':          await onAutoRh(payload); break;
      case 'autorankup':      await onAutorankup(payload); break;
      case 'statsbank':       await onStatsbank(payload); break;
      case 'rapportPompiste': await onRapportPompiste(payload); break;
      case 'stationsDashboard': await onStationsDashboard(payload); break;
      case 'dossierEmploye':  await onDossierEmploye(payload); break;
      case 'avertissement':   await onAvertissement(payload); break;
      case 'licenciement':    await onLicenciement(payload); break;
      case 'venteAuto':       await onVenteAuto(payload); break;
      case 'vehicule':        await onVehicule(payload); break;
      case 'stagiaire':       await onStagiaire(payload); break;
      case 'logBrut':         await onLogBrut(payload); break;
      default:                return res.status(400).send('Unknown type');
    }
    await relayIgLog(type, payload);   // relai vers le salon de logs BLA (audit)
    res.json({ ok: true });
  } catch (err) {
    console.error('botIngest error', err);
    res.status(500).send(err.message || 'Internal error');
  }
});

// ============================================================
// Relai des logs vers les salons Discord BLA (audit / recherche)
// ============================================================
// Type d'ingestion IG -> nom du salon de logs (serveur BLA).
const IG_LOG_CHANNEL = {
  venteAuto: 'ventes-employe', facture: 'ventes-employe', factureCancel: 'ventes-employe',
  redistribution: 'retributions', rapportPompiste: 'retributions',
  depense: 'depenses',
  bankAccount: 'banque', statsbank: 'banque',
  coffre: 'coffre',
  paie: 'paies',
  inventory: 'stocks-inventaire',
  avertissement: 'rh', licenciement: 'rh', autorankup: 'rh', autoRh: 'rh',
  dossierEmploye: 'rh', stagiaire: 'rh',
  service: 'services-vehicules', vehicule: 'services-vehicules'
  // stationsDashboard : pas de relai (message dashboard édité en place)
};
const IG_LABEL = {
  venteAuto: 'Vente', facture: 'Facture', factureCancel: 'Facture annulée',
  redistribution: 'Redistribution essence', rapportPompiste: 'Rapport pompiste',
  depense: 'Dépense', bankAccount: 'Mouvement bancaire', statsbank: 'Stats banque',
  coffre: 'Coffre', paie: 'Paie', inventory: 'Inventaire', avertissement: 'Avertissement',
  licenciement: 'Licenciement', autorankup: 'Montée en grade', autoRh: 'RH auto',
  dossierEmploye: 'Dossier employé', stagiaire: 'Stagiaire', service: 'Service', vehicule: 'Véhicule'
};
function logWebhooks() {
  try { return JSON.parse(LOG_WEBHOOKS.value() || '{}'); } catch { return {}; }
}
// Champs lisibles depuis un payload d'ingestion (générique, scalaires seulement).
function fieldsFromPayload(payload) {
  const out = [];
  for (const [k, v] of Object.entries(payload || {})) {
    if (k === '_meta') continue;
    if (v == null || v === '' || typeof v === 'object') continue;
    let val = String(v); if (val.length > 300) val = val.slice(0, 297) + '…';
    out.push({ name: k.slice(0, 240), value: val, inline: true });
    if (out.length >= 12) break;
  }
  return out.length ? out : [{ name: 'info', value: '(log)', inline: false }];
}
// Certains "mouvements bancaires" (xbankaccount) sont en réalité des
// REDISTRIBUTIONS essence (raison "Redistribution N°…") : elles doivent aller
// dans le salon retributions, PAS banque. Routage affiné selon le payload.
function channelForLog(type, payload) {
  if (type === 'bankAccount' || type === 'statsbank') {
    const r = String((payload && (payload.raison || payload.motif)) || '').toLowerCase();
    if (/redistribution|r[ée]tribution/.test(r)) return 'retributions';
    return 'banque';
  }
  return IG_LOG_CHANNEL[type];
}
function labelForLog(type, payload, chan) {
  if ((type === 'bankAccount' || type === 'statsbank') && chan === 'retributions') return 'Redistribution essence';
  return IG_LABEL[type] || type;
}
// Relai d'un log IG vers son salon. Ne jette JAMAIS (l'ingestion ne doit pas casser).
async function relayIgLog(type, payload) {
  try {
    const chan = channelForLog(type, payload);
    if (!chan) return;
    const url = logWebhooks()[chan];
    if (!url) return;
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{
        title: labelForLog(type, payload, chan),
        color: 13215073,
        fields: fieldsFromPayload(payload),
        footer: { text: 'LTD Little Seoul · log IG' },
        timestamp: new Date().toISOString()
      }] })
    });
  } catch (e) { console.error('relayIgLog', type, e && e.message); }
}

// ------------------------------------------------------------
// logSite — l'app LTD poste un événement (action sur le site) vers le salon
// dédié du serveur BLA. Auth : idToken Firebase de l'utilisateur connecté.
// ------------------------------------------------------------
const SITE_LOG_CHANNELS = new Set(['connexions', 'comptes-acces', 'stocks', 'ventes', 'livraisons', 'notes-frais', 'compta', 'config']);
export const logSite = onRequest({ region: 'europe-west1', cors: true, secrets: [LOG_WEBHOOKS] }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('POST');
  const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'auth' });
  let decoded;
  try { decoded = await adminAuth.verifyIdToken(m[1]); } catch { return res.status(401).json({ error: 'token' }); }
  const { channel, title, fields } = req.body || {};
  if (!SITE_LOG_CHANNELS.has(channel)) return res.status(400).json({ error: 'channel' });
  const url = logWebhooks()[channel];
  if (!url) return res.json({ ok: true, skipped: true });
  let acteur = decoded.email || decoded.uid;
  try {
    const u = await db.collection('users').doc(decoded.uid).get();
    if (u.exists) { const d = u.data() || {}; acteur = `${d.prenom || ''} ${d.nom || ''}`.trim() || acteur; }
  } catch {}
  const safeFields = Array.isArray(fields) ? fields.slice(0, 12).map(f => ({
    name: String(f.name || '—').slice(0, 240),
    value: String(f.value == null ? '—' : f.value).slice(0, 1000),
    inline: !!f.inline
  })) : [];
  try {
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{
        title: String(title || 'Événement').slice(0, 240),
        color: 13215073,
        fields: safeFields,
        footer: { text: 'LTD Little Seoul · log site · ' + acteur },
        timestamp: new Date().toISOString()
      }] })
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// === Catalogue public (vitrine client) ===
// Produits vendables (prixVente > 0, hors matières premières) + stations essence,
// en lecture seule et SANS auth : page publique consultée par les clients.
// Cache court côté CDN. Ne renvoie que des champs publics (jamais prixAchat/fournisseur).
export const catalogueVitrine = onRequest({ region: 'europe-west1', cors: true }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'GET, OPTIONS'); return res.status(204).send(''); }
  try {
    const [ps, ss] = await Promise.all([
      db.collection('produits').get(),
      db.collection('stations').get()
    ]);
    const produits = [];
    ps.forEach((doc) => {
      const p = doc.data() || {};
      const prix = Math.round(Number(p.prixVente) || 0);
      const cat = String(p.categorie || 'divers');
      if (prix <= 0 || cat === 'matiere_premiere') return; // exclut intrants / matières premières
      produits.push({ nom: String(p.nom || doc.id), categorie: cat, prix, pro: !!p.pourPro });
    });
    produits.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const stations = [];
    ss.forEach((doc) => {
      const s = doc.data() || {};
      stations.push({ nom: String(s.nom || doc.id), prixLitre: Math.round((Number(s.prixLitre) || 0) * 100) / 100 });
    });
    stations.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const categories = [...new Set(produits.map((p) => p.categorie))].sort((a, b) => a.localeCompare(b, 'fr'));
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ ok: true, produits, categories, stations, updatedAt: Date.now() });
  } catch (e) {
    console.error('[catalogueVitrine]', e && e.message);
    res.status(500).json({ ok: false, error: 'interne' });
  }
});

// === Handlers ===

async function onInventory({ type, item, itemNomBrut, count, source, owner, characterId, properName, name }) {
  // Le parser bot envoie déjà l'ID catalogue résolu dans `item` (ex: "bouteille-eau")
  // et le nom FiveM affiché dans `itemNomBrut`. Filtrage source + whitelist déjà faits.
  if (!item) return;
  const itemId  = slug(item); // idempotent si item est déjà un slug
  const itemNom = itemNomBrut || item;

  const ref = db.collection('stocks').doc(itemId);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data().quantite || 0) : 0;
  const delta = type === 'inventory-add' ? count : -count;
  await ref.set({
    quantite: cur + delta,
    nom: itemNom,
    derniereMaj: FieldValue.serverTimestamp(),
    par: properName || name || 'bot'
  }, { merge: true });

  await db.collection('mouvementsStock').add({
    type, item: itemId, itemNom,
    quantite: delta,
    par: properName || name || '',
    source: source || '',
    discord: name || '',
    characterId: characterId || '',
    owner: owner || '',
    timestamp: FieldValue.serverTimestamp()
  });

  // Quota pompiste : plus de decompte auto depuis logs FiveM depuis 2026-05-12.
  // Le pompiste declare lui-meme via le site (modal /stations bidons +
  // declaration caoutchoucs via pompisteDeclarerCaoutchoucs). Cela evite tout
  // doublon entre Discord et site et force la rigueur de declaration.
}

async function onService({ employeId, employeIdDiscord, employeNom, action, timestamp }) {
  const t = timestamp ? new Date(timestamp) : new Date();

  // Resolution de la cle Firestore : idPerso > idDiscord > lookup par nom RP.
  // Necessaire car les logs Jessica n'ont ni idPerso ni idDiscord (juste
  // "Prenom Nom a commence son service").
  let key = employeId || employeIdDiscord;
  if (!key && employeNom) {
    key = await resolveEmployeeIdByName(employeNom);
  }
  if (!key) {
    console.log(`[onService] employeNom="${employeNom}" pas resolu -> skip`);
    return;
  }

  if (action === 'start') {
    await db.collection('servicesOuverts').doc(key).set({
      employeId: key, employeNom, debut: Timestamp.fromDate(t)
    });
  } else if (action === 'end') {
    const ref = db.collection('servicesOuverts').doc(key);
    const snap = await ref.get();
    if (snap.exists) {
      const debut = snap.data().debut.toDate();
      const duree = t.getTime() - debut.getTime();
      await db.collection('services').add({
        employeId: key, employeNom,
        debut: Timestamp.fromDate(debut),
        fin: Timestamp.fromDate(t),
        duree
      });
      await ref.delete();
    }
  }
}

// ------------------------------------------------------------
// onStationFuel — événements stations au format FlashFA (xaction).
//   kind='fill' : ravitaillement de la cuve par un employé (station_fill).
//   kind='sale' : vente de carburant à un véhicule (fuel_fill) → alimente
//                 /redistributions (CA carburant) comme chez l'ancien modèle.
// L'autorité du niveau de cuve est volAfter (robuste aux logs manqués).
// La station est résolue par markerId (posé sur le doc /stations à la création).
// ------------------------------------------------------------
async function onStationFuel({ markerId, kind, volAfter, volDelta, price, vehicleId, acteurNom, acteurId, timestamp }) {
  const mid = Number(markerId) || String(markerId);
  const snap = await db.collection('stations').where('markerId', '==', mid).limit(1).get();
  if (snap.empty) {
    console.log(`[onStationFuel] station inconnue markerId=${markerId} (${kind}, vol_after=${volAfter}) -> créer le doc station avec ce markerId`);
    return;
  }
  const sDoc = snap.docs[0];

  // Niveau de cuve : vol_after fait foi.
  await sDoc.ref.set({
    stockActuel: Number(volAfter) || 0,
    dernierMouvement: FieldValue.serverTimestamp()
  }, { merge: true });

  // Vente de carburant → CA carburant (collection /redistributions, schéma existant).
  if (kind === 'sale') {
    const litres = Math.abs(Number(volDelta) || 0);
    const montant = Number(price) || 0;
    await db.collection('redistributions').add({
      redistributionId: `fuel-${markerId}-${timestamp || Date.now()}-${vehicleId || 'na'}`,
      station: sDoc.data().nom || sDoc.id,
      stationId: sDoc.id,
      litres,
      prixLitre: litres > 0 ? Math.round((montant / litres) * 100) / 100 : null,
      montant,
      stockAvant: (Number(volAfter) || 0) + litres,
      stockApres: Number(volAfter) || 0,
      client: acteurNom || null,
      clientId: acteurId || null,
      vehicleId: vehicleId || null,
      timestamp: FieldValue.serverTimestamp()
    });
  }
}

async function onFacture(p) {
  // Resolution de l'uid Firebase du vendeur :
  //   1. p.vendeurId si deja fourni
  //   2. lookup par idDiscord (si l'embed porte une mention <@123>)
  //   3. fallback nom RP case-insensitive (cas frequent : embed sans mention,
  //      juste "Facture par Ilyes Chaifi" -> resoud sur prenom+nom).
  // Sans ce fallback, vendeurId reste null -> la vente n'est pas comptee dans
  // le CA / salaire estime de l'employe (page employee.html, rh.js).
  let vendeurId = p.vendeurId || null;
  if (!vendeurId && p.vendeurDiscord) {
    const usnap = await db.collection('users').where('idDiscord', '==', p.vendeurDiscord).limit(1).get();
    if (!usnap.empty) vendeurId = usnap.docs[0].id;
  }
  if (!vendeurId && p.vendeurNom) {
    vendeurId = await resolveEmployeeIdByName(p.vendeurNom);
  }

  // 2026-05-11 : verification "vendeur en service".
  // Un employe ne doit emettre des factures que pendant son service. Si pas
  // de doc /servicesOuverts/{vendeurId} → alerte direction (potentielle fraude
  // ou oubli de prise de service).
  let enService = null;
  if (vendeurId) {
    const svcSnap = await db.collection('servicesOuverts').doc(vendeurId).get();
    enService = svcSnap.exists;
  }

  // Idempotent : meme factureId emis par #suivi-facture ET #factures = 1 seul doc
  const docId = p.factureId ? `fac-${p.factureId}` : `fac-msg-${Date.now()}`;
  const montantBot = Number(p.montant) || 0;

  // Calcul de la part "particulier" (commissionnable) a partir des items.
  // L'utilisateur a confirme qu'une facture est jamais mixte particulier+pro,
  // mais on calcule au pro-rata par precaution. Si on n'a pas d'items, on
  // suppose particulier par defaut (legacy bot).
  let montantParticulierBot = montantBot;
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length > 0) {
    try {
      let totalQte = 0;
      let qteParticulier = 0;
      for (const it of items) {
        const pid = String(it.id || it.produitId || '').trim();
        const qte = Number(it.quantite || 0);
        if (!pid || qte <= 0) continue;
        totalQte += qte;
        const prodSnap = await db.collection('produits').doc(pid).get();
        const pourPro = prodSnap.exists ? !!prodSnap.data().pourPro : true;
        if (!pourPro) qteParticulier += qte;
      }
      if (totalQte > 0) {
        montantParticulierBot = Math.round((qteParticulier / totalQte) * montantBot * 100) / 100;
      }
    } catch (e) {
      console.error('[onFacture] calcul montantParticulier error', e);
    }
  }

  // 2026-05-14 : calcul AUTOMATIQUE du bénéfice pour les ventes de la DIRECTION
  // et du RESPONSABLE VENTE.
  // Contexte : Blake (patron), co-patronne, DRH, responsable vente ne déclarent
  // pas systématiquement leurs ventes (salaire fixe pour direction, calculé sur
  // CA pour responsable vente — pas sur le bénéfice). Mais leurs ventes génèrent
  // du bénéfice pour le LTD qui doit apparaître en compta.
  //
  // Pour les vendeurs/pompistes, on garde benefice=null — ils DOIVENT déclarer
  // manuellement (anti-fraude employés, commission calculée sur leur CA).
  //
  // Lookup item : si pas d'ID fourni par le bot, on cherche le produit par nom
  // (insensible casse, contains both ways). Cache /produits une fois par appel.
  let beneficeAutoDirection = null;
  if (vendeurId && items.length > 0) {
    try {
      const userSnap = await db.collection('users').doc(vendeurId).get();
      const role = userSnap.exists ? (userSnap.data().role || '') : '';
      const isDirectionOuRV = ['patron', 'co-patron', 'admin-technique', 'drh', 'responsable-vente'].includes(role);
      if (isDirectionOuRV) {
        // Cache local des produits pour le lookup par nom
        const prodsSnap = await db.collection('produits').get();
        const prodsList = prodsSnap.docs.map(p => ({ id: p.id, ...p.data() }));
        const prodById = {};
        for (const p of prodsList) prodById[p.id] = p;

        function findProduit(it) {
          const pid = String(it.id || it.produitId || '').trim();
          if (pid && prodById[pid]) return prodById[pid];
          const nom = String(it.nom || '').toLowerCase().trim();
          if (!nom) return null;
          // Alias explicites définis sur le produit (priorité)
          for (const p of prodsList) {
            if (Array.isArray(p.aliases) && p.aliases.some(a => String(a).toLowerCase().trim() === nom)) return p;
          }
          // Exact sur nom
          for (const p of prodsList) {
            if ((p.nom || '').toLowerCase().trim() === nom) return p;
          }
          // Contains (les deux sens) — fallback fuzzy
          for (const p of prodsList) {
            const pNom = (p.nom || '').toLowerCase().trim();
            if (!pNom) continue;
            if (pNom.includes(nom) || nom.includes(pNom)) return p;
          }
          return null;
        }

        let coutTotal = 0;
        let allResolus = true;
        for (const it of items) {
          const qte = Number(it.quantite || 0);
          if (qte <= 0) { allResolus = false; continue; }
          const prod = findProduit(it);
          if (!prod) { allResolus = false; continue; }
          coutTotal += qte * (Number(prod.prixAchat) || 0);
        }
        if (allResolus && coutTotal > 0) {
          beneficeAutoDirection = Math.max(0, montantBot - coutTotal);
          console.log(`[onFacture] Vente ${role} #${p.factureId} : bénéfice auto = ${montantBot} - ${coutTotal} = ${beneficeAutoDirection}$`);
        } else if (items.length > 0) {
          console.log(`[onFacture] Vente ${role} #${p.factureId} : bénéfice non calculé (items non résolvables : ${items.map(i => i.nom).join(', ')})`);
        }
      }
    } catch (e) {
      console.error('[onFacture] calcul benefice direction/RV error', e);
    }
  }

  // Detection doublon — 2 mecanismes :
  //   (a) MATCH EXPLICITE : declaration manuelle declaree AVEC factureBotRef==p.factureId
  //       → l'employe a explicitement clique "Declarer" sur cette facture bot
  //       → c'est UN VRAI DOUBLON, on cache.
  //   (b) MATCH IMPLICITE (legacy) : declaration manuelle SANS factureBotRef avec
  //       meme vendeur + meme montant dans les 15 min ET pas deja utilisee pour
  //       cacher une autre vente bot. Utile pour le cas rare ou l'employe
  //       declare avant que le bot ait remonte (latence Discord > 5 min).
  //
  // Bug fix 2026-05-14 : avant, on cachait TOUTE vente bot qui matchait la 1re
  // manuelle trouvee (meme vendeur+montant 15 min). Resultat : si Teo fait
  // 3 ventes de 300$ a 5 min d'intervalle, et qu'il declare la 1re manuellement,
  // les 3 facturees bot etaient toutes liees a la meme manuelle et marquees
  // cachees. Teo ne pouvait plus declarer les 2 autres.
  let venteCachee = false;
  let remplaceeParId = null;
  let remplaceeParFactureId = null;
  if (vendeurId && montantBot > 0) {
    try {
      const quinzeMin = new Date(Date.now() - 15 * 60 * 1000);
      const manSnap = await db.collection('ventes')
        .where('timestamp', '>=', Timestamp.fromDate(quinzeMin))
        .get();

      // (a) Match explicite d'abord
      for (const m of manSnap.docs) {
        const mv = m.data();
        if (mv.source !== 'manuelle') continue;
        if (mv.vendeurId !== vendeurId) continue;
        if (String(mv.factureBotRef) === String(p.factureId)) {
          venteCachee = true;
          remplaceeParId = m.id;
          remplaceeParFactureId = mv.factureId;
          console.log(`[onFacture] Vente bot ${p.factureId} cachee (match explicite ${mv.factureId})`);
          break;
        }
      }

      // (b) Sinon match implicite (rare cas latence)
      if (!venteCachee) {
        for (const m of manSnap.docs) {
          const mv = m.data();
          if (mv.source !== 'manuelle') continue;
          if (mv.vendeurId !== vendeurId) continue;
          if (Number(mv.montant) !== montantBot) continue;
          // Skip si la manuelle est deja liee a une autre facture bot
          if (mv.factureBotRef) continue;
          // Skip si une autre vente bot pointe deja vers cette manuelle
          const dejaSnap = await db.collection('ventes')
            .where('remplaceeParId', '==', m.id)
            .limit(1).get();
          if (!dejaSnap.empty) continue;
          venteCachee = true;
          remplaceeParId = m.id;
          remplaceeParFactureId = mv.factureId;
          console.log(`[onFacture] Vente bot ${p.factureId} cachee (match implicite legacy ${mv.factureId})`);
          break;
        }
      }
    } catch (e) {
      console.error('[onFacture] check doublon manuel error', e);
    }
  }

  await db.collection('ventes').doc(docId).set({
    factureId: p.factureId,
    vendeurDiscord: p.vendeurDiscord || '',
    vendeurNom: p.vendeurNom || '',
    vendeurId,
    enServiceAuMomentDeLaVente: enService,
    client: p.clientNom || '',
    montant: montantBot,
    montantParticulier: montantParticulierBot,
    // Bénéfice : si vendeur direction → auto-calculé depuis items+prixAchat
    // (le patron Morgan n'a pas à déclarer ses ventes, salaire fixe).
    // Sinon → null, attente déclaration manuelle (anti-fraude employés).
    benefice: p.benefice ?? beneficeAutoDirection ?? null,
    beneficeSource: beneficeAutoDirection != null ? 'auto-direction' : (p.benefice != null ? 'bot-fourni' : null),
    raison: p.raison || '',
    paiement: p.paiement || '',
    items: p.items || [],
    stockVerifie: p.stockVerifie ?? null,
    source: 'discord',
    cachee: venteCachee,
    remplaceeParId,
    remplaceeParFactureId,
    timestamp: FieldValue.serverTimestamp()
  }, { merge: true });

  // Alerte si vendeur identifie mais PAS en service au moment de la vente
  if (vendeurId && enService === false) {
    await db.collection('alertes').add({
      type: 'vente-hors-service',
      message: `⚠ Vente #${p.factureId} (${p.montant}$) par ${p.vendeurNom || vendeurId} HORS SERVICE — devrait être en prise de service.`,
      gravite: 'warn',
      metadata: { factureId: p.factureId, vendeurId, vendeurNom: p.vendeurNom, montant: p.montant },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });
  }
}

async function onRedistribution(p) {
  await db.collection('redistributions').add({
    redistributionId: p.id,
    station: p.station,
    stationId: p.stationId || slug(p.station),
    litres: p.litres,
    prixLitre: p.prixLitre,
    montant: p.montant,
    stockAvant: p.stockAvant,
    stockApres: p.stockApres,
    niveau: p.niveau,
    timestamp: FieldValue.serverTimestamp()
  });
  // Mettre à jour le stock de la station
  const sRef = db.collection('stations').doc(p.stationId || slug(p.station));
  await sRef.set({
    nom: p.station,
    stockActuel: p.stockApres,
    derniereRedistribution: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function onDepense(p) {
  // Fix bug "<@undefined>" : si le bot Discord n'a pas pu résoudre l'utilisateur
  // (cas typique des dépenses automatiques type loyer), on substitue par un libellé clair.
  let utilisateur = p.utilisateur || '';
  if (/^<@!?undefined>$/i.test(utilisateur) || utilisateur === '') {
    utilisateur = 'Système (auto)';
  }

  const rawRaison = String(p.raison || '');

  // 2026-05-14 : auto-détection remboursement engagement.
  // Si la raison contient "remboursement" + (subvention|engagement|essence|dette),
  // on cherche un engagement actif et on décrémente le montant restant.
  // Le doc /depenses normal est créé en plus (audit).
  if (/remboursement/i.test(rawRaison) &&
      /(subvention|engagement|essence|dette|gouvernement|irs)/i.test(rawRaison)) {
    try {
      await detecterRemboursementEngagement({
        montant: Number(p.montant) || 0,
        raison: rawRaison,
        utilisateur
      });
    } catch (e) {
      console.error('[onDepense] detect remboursement error', e.message);
    }
  }

  // 2026-05-11 : detection paie/salaire en doublon avec /paies.
  // FiveM log les paies sur DEUX canaux : #paie (-> /paies) ET #depenses (sortie
  // d'argent) avec raison "Paye ponctuelle de membre" ou "Salaire". On marque
  // alors type='paie' pour que la page Comptabilite exclue ces entries de
  // "Charges non deductibles" (sinon doublon avec masse salariale).
  if (/\b(paye|paie|salaire|r[ée]mun[ée]ration)\b/i.test(rawRaison)) {
    await db.collection('depenses').add({
      compteId: p.compteId,
      utilisateur,
      montant: Number(p.montant) || 0,
      soldeAvant: p.soldeAvant,
      soldeApres: p.soldeApres,
      raison: rawRaison,
      type: 'paie',
      deductible: true,
      source: 'discord',
      timestamp: FieldValue.serverTimestamp()
    });
    return;
  }

  // Phase 2 cross-réf : avant le lookup mapping, on tente d'identifier le
  // compte cible (HDM, Dynasty 8, etc.) via /banqueLtd pour permettre
  // l'auto-classification par matchType='compte-cible'. Si onBankAccount
  // n'est pas encore arrivé (race condition), la résolution se fait en
  // sens inverse via crossRefBanqueDepense lors de onBankAccount.
  let compteCibleNom = '';
  let compteCibleAccountId = '';
  let compteCibleIban = '';
  try {
    const ref = await lookupCompteCibleDepuisBanque(Number(p.montant) || 0);
    if (ref) {
      compteCibleNom = ref.toPropername || ref.toName || '';
      compteCibleAccountId = ref.accountId || '';
    }
  } catch (e) {
    console.error('[onDepense] lookupCompteCible error', e.message);
  }

  // Phase 3 : si l'embed addmoney destinataire est déjà arrivé en avance,
  // on récupère l'accountId destinataire depuis /paiementsExternesEnAttente.
  if (!compteCibleAccountId && p.factureId) {
    try {
      const enAttenteSnap = await db.collection('paiementsExternesEnAttente')
        .doc(String(p.factureId)).get();
      if (enAttenteSnap.exists) {
        const ea = enAttenteSnap.data();
        compteCibleAccountId = ea.accountIdDestinataire || '';
        compteCibleIban = ea.ibanDestinataire || '';
        // On supprime l'entrée (best-effort)
        await enAttenteSnap.ref.delete().catch(() => {});
      }
    } catch (e) {
      console.error('[onDepense] lookupPaiementEnAttente error', e.message);
    }
  }

  // 2026-05-14 : auto-classification par mapping fournisseurs.
  // /config/global.fournisseurs contient un array de patterns alimenté par :
  //  - le script init-fournisseurs-mapping.js (seeds)
  //  - le bouton "Mémoriser ce fournisseur" dans la page Comptabilité (via
  //    Cloud Function reclasserDepense)
  // Chaque pattern : { id, label, matchType, matchValue, categorie, deductible, raisonClassification }
  // Le patron reste décisionnaire final (cf. feedback_tte_decision_patron) :
  // les champs `deductible` et `type` reflètent la SUGGESTION ; le patron
  // peut override via reclasserDepense qui pose `valideParPatron: true`.
  const payloadPourMatch = { ...p, compteCibleNom, compteCibleAccountId };
  let fournisseur = null;
  try {
    const cfgSnap = await db.collection('config').doc('global').get();
    const patterns = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];
    for (const pat of patterns) {
      if (matchesFournisseurPattern(pat, payloadPourMatch, rawRaison)) {
        fournisseur = pat;
        break;
      }
    }
  } catch (e) {
    console.error('[onDepense] lookup fournisseurs error', e);
  }

  let categorieSuggeree;
  let deductibleSuggere;
  let raisonClassification;
  if (fournisseur) {
    categorieSuggeree    = fournisseur.categorie;
    deductibleSuggere    = !!fournisseur.deductible;
    raisonClassification = fournisseur.raisonClassification || '';
  } else if (/matières?\s+premières?/i.test(rawRaison)) {
    // Fallback legacy
    categorieSuggeree = 'matieres-premieres';
    deductibleSuggere = true;
    raisonClassification = 'Détection legacy : raison contient "matières premières"';
  } else if (/avocat/i.test(rawRaison)) {
    categorieSuggeree = 'frais-avocat';
    deductibleSuggere = true;
    raisonClassification = 'Détection legacy : raison contient "avocat"';
  } else if (/entretien.+v[ée]hicule/i.test(rawRaison)) {
    categorieSuggeree = 'entretien-vehicules';
    deductibleSuggere = true;
    raisonClassification = 'Détection legacy : raison contient "entretien véhicule"';
  } else {
    categorieSuggeree = 'a-classifier';
    deductibleSuggere = false;
    raisonClassification = 'Pas de pattern fournisseur identifié — à classifier manuellement par patron';
  }

  await db.collection('depenses').add({
    compteId: p.compteId,
    utilisateur,
    montant: Number(p.montant) || 0,
    soldeAvant: p.soldeAvant,
    soldeApres: p.soldeApres,
    raison: rawRaison,
    boutiqueId: p.boutiqueId || null,
    factureId: p.factureId || null,
    compteCibleNom: compteCibleNom || null,
    compteCibleAccountId: compteCibleAccountId || null,
    compteCibleIban: compteCibleIban || null,
    // Suggestion auto (initiale)
    type: categorieSuggeree,
    deductible: deductibleSuggere,
    categorieSuggeree,
    deductibleSuggere,
    raisonClassification,
    fournisseurPatternId: fournisseur ? fournisseur.id : null,
    fournisseurLabel: fournisseur ? fournisseur.label : null,
    // Validation patron — par défaut non validée
    valideParPatron: false,
    source: 'discord',
    timestamp: FieldValue.serverTimestamp()
  });
}

// Helper : teste si un pattern fournisseur correspond à la dépense en cours.
// matchType supporté en phase 1 :
//   - 'boutique-id'   : compare payload.boutiqueId au matchValue (string)
//   - 'facture-id'    : compare payload.factureId au matchValue
//   - 'raison-regex'  : applique new RegExp(matchValue, 'i') sur la raison
//   - 'compte-cible'  : TODO Phase 2 (nécessite enrichissement xbankaccount
//                       avec toPropername)
// 2026-05-14 : auto-détection remboursement engagement (subvention essence,
// dettes…). Quand une dépense match le pattern de remboursement, on cherche
// un engagement actif dont le montant restant correspond, et on décrémente.
async function detecterRemboursementEngagement({ montant, raison, utilisateur }) {
  if (!montant || montant <= 0) return;
  // Cherche les engagements actifs, sort par montant restant croissant
  const snap = await db.collection('engagements')
    .where('statut', '==', 'actif')
    .get();
  if (snap.empty) return;

  // Match : on prend le premier engagement actif qui a montantRestant >= montant
  // (priorité aux engagements dont la mention apparaît dans la raison)
  let target = null;
  const candidats = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  // Filtre par mots-clés du label
  const raisonLower = raison.toLowerCase();
  const matched = candidats.filter(c => {
    const objet = (c.objet || '').toLowerCase();
    const bene = (c.beneficiaire || '').toLowerCase();
    return raisonLower.includes(objet.split(' ')[0]) ||
           raisonLower.includes(bene.split(' ')[0]) ||
           /essence/i.test(c.objet || '') && /essence/i.test(raison);
  });
  target = matched[0] || candidats[0];
  if (!target) return;

  const ancienRembourse = Number(target.montantRembourse) || 0;
  const ancienRestant = Number(target.montantRestant) || 0;
  const nouveauRembourse = ancienRembourse + montant;
  const nouveauRestant = Math.max(0, ancienRestant - montant);
  const nouveauStatut = nouveauRestant <= 0 ? 'rembourse' : 'actif';

  await target.ref.set({
    montantRembourse: nouveauRembourse,
    montantRestant: nouveauRestant,
    statut: nouveauStatut,
    dateMaj: FieldValue.serverTimestamp(),
    historiqueRemboursements: FieldValue.arrayUnion({
      montant,
      raison,
      utilisateur,
      timestamp: new Date().toISOString()
    })
  }, { merge: true });

  console.log(`[detecterRemboursementEngagement] ${target.id} : -${montant}$ → restant ${nouveauRestant}$ (statut ${nouveauStatut})`);

  if (nouveauStatut === 'rembourse') {
    await db.collection('alertes').add({
      type: 'engagement-rembourse',
      message: `🟢 Engagement "${target.objet}" intégralement remboursé (${ancienRembourse + montant}$).`,
      gravite: 'info',
      metadata: { engagementId: target.id, montantTotal: ancienRembourse + montant },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });
  }
}

function matchesFournisseurPattern(pat, payload, raison) {
  if (!pat || !pat.matchType || !pat.matchValue) return false;
  // 2026-05-14 : matchValue peut contenir PLUSIEURS valeurs séparées par
  // virgule (ex : "263,264,266" pour les multi-comptoirs Yootool). On split
  // sur "," et on test chaque valeur. Insensible aux espaces.
  const valeurs = String(pat.matchValue).split(',').map(v => v.trim()).filter(Boolean);
  switch (pat.matchType) {
    case 'boutique-id':
      return !!payload.boutiqueId && valeurs.includes(String(payload.boutiqueId));
    case 'facture-id':
      return !!payload.factureId && valeurs.includes(String(payload.factureId));
    case 'raison-regex':
      // Pour raison-regex, on prend la matchValue brute (la virgule peut
      // faire partie de la regex elle-même). Pas de split.
      try {
        return new RegExp(pat.matchValue, 'i').test(raison || '');
      } catch (e) {
        console.error('[matchesFournisseurPattern] regex invalide :', pat.matchValue, e.message);
        return false;
      }
    case 'compte-cible':
      // Phase 2 : payload doit contenir compteCibleNom (résolu via cross-réf
      // /banqueLtd dans onDepense / crossRefBanqueDepense).
      // Match insensible à la casse, sur substring (ex : matchValue="HDM" matche
      // toPropername="Heavy Duty Motors HDM"). Supporte aussi multi-valeurs.
      if (!payload.compteCibleNom) return false;
      const compte = String(payload.compteCibleNom).toLowerCase();
      return valeurs.some(v => compte.includes(v.toLowerCase()));
    case 'account-id-cible':
      // Phase 3 : payload doit contenir compteCibleAccountId (résolu via
      // enrichirDepensePaiementFacture quand le bot capte un addmoney côté
      // destinataire dans #logs-ig). Match exact sur l'accountId numérique.
      // C'est le matchType le plus FIABLE pour identifier un fournisseur car
      // l'accountId est unique et stable (ex : HDM = 67978).
      if (!payload.compteCibleAccountId) return false;
      return valeurs.includes(String(payload.compteCibleAccountId));
    default:
      return false;
  }
}

// Phase 3 — Enrichit une dépense LTD avec l'accountId destinataire identifié
// via le log addmoney côté fournisseur (capté hors iban LTDSEOUL).
// Cross-réf par billId (N° de facture présent dans la raison des 2 logs).
async function enrichirDepensePaiementFacture({ billId, accountIdDestinataire, ibanDestinataire }) {
  if (!billId) return;

  // Cherche la dépense LTD avec ce factureId
  const depSnap = await db.collection('depenses')
    .where('factureId', '==', String(billId))
    .limit(5)
    .get();

  if (depSnap.empty) {
    // Pas de dépense LTD pour ce billId — peut arriver si le log addmoney
    // arrive AVANT le log #depenses (race condition). On stocke en attente
    // pour traitement lors de l'arrivée de la dépense (best-effort).
    await db.collection('paiementsExternesEnAttente').doc(String(billId)).set({
      billId: String(billId),
      accountIdDestinataire,
      ibanDestinataire,
      timestamp: FieldValue.serverTimestamp()
    });
    return;
  }

  for (const d of depSnap.docs) {
    const dep = d.data();
    if (dep.valideParPatron === true) continue; // patron a tranché, on touche pas
    if (dep.compteCibleAccountId) continue; // déjà enrichi

    // Tente le mapping avec le nouvel accountId
    const payloadPourMatch = {
      ...dep,
      compteCibleAccountId: accountIdDestinataire,
      compteCibleNom: ibanDestinataire
    };
    let fournisseur = null;
    try {
      const cfgSnap = await db.collection('config').doc('global').get();
      const patterns = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];
      for (const pat of patterns) {
        if (matchesFournisseurPattern(pat, payloadPourMatch, dep.raison || '')) {
          fournisseur = pat;
          break;
        }
      }
    } catch (e) {
      console.error('[enrichirDepensePaiementFacture] lookup mapping error', e);
    }

    const update = {
      compteCibleAccountId: accountIdDestinataire,
      compteCibleIban: ibanDestinataire
    };
    if (fournisseur) {
      update.type = fournisseur.categorie;
      update.deductible = !!fournisseur.deductible;
      update.categorieSuggeree = fournisseur.categorie;
      update.deductibleSuggere = !!fournisseur.deductible;
      update.fournisseurPatternId = fournisseur.id;
      update.fournisseurLabel = fournisseur.label;
      update.raisonClassification = fournisseur.raisonClassification || '';
    }
    await d.ref.set(update, { merge: true });
  }
}

// Phase 2 — cross-réf /banqueLtd ←→ /depenses.
// Quand le bot capte les 2 logs (xbankaccount removemoney sur #logs-ig +
// dépense classique sur #depenses) pour un même paiement, ils arrivent
// dans un ordre non-déterminé. On résout le compte cible dans les 2 sens :
//   - onDepense → lookupCompteCibleDepuisBanque() : trouve le removemoney
//   - onBankAccount → crossRefBanqueDepense() : enrichit la dépense
//
// Critères de matching : même montant exact + timestamp à ±90 sec + iban
// LTDSEOUL + type='remove'. La précision suffit en pratique (peu de
// transactions exactement identiques dans une fenêtre de 90s).

async function lookupCompteCibleDepuisBanque(montant) {
  if (!montant || !Number.isFinite(montant)) return null;
  const since = new Date(Date.now() - 90 * 1000);
  const until = new Date(Date.now() + 5 * 1000);
  try {
    const snap = await db.collection('banqueLtd')
      .where('timestamp', '>=', Timestamp.fromDate(since))
      .where('timestamp', '<=', Timestamp.fromDate(until))
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    for (const d of snap.docs) {
      const b = d.data();
      if (b.type !== 'remove') continue;
      if (Number(b.montant) !== montant) continue;
      if (b.iban && b.iban !== 'LTDSEOUL') continue;
      if (!b.toPropername && !b.toName) continue;
      return b;
    }
  } catch (e) {
    if (!String(e.message || '').includes('index')) throw e;
    console.error('[lookupCompteCibleDepuisBanque] index manquant, skip');
  }
  return null;
}

async function crossRefBanqueDepense({ montant, toPropername, toDiscord, accountId }) {
  if (!montant || !Number.isFinite(montant) || !toPropername) return;
  const since = new Date(Date.now() - 90 * 1000);
  const until = new Date(Date.now() + 5 * 1000);
  let snap;
  try {
    snap = await db.collection('depenses')
      .where('timestamp', '>=', Timestamp.fromDate(since))
      .where('timestamp', '<=', Timestamp.fromDate(until))
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
  } catch (e) {
    if (String(e.message || '').includes('index')) {
      console.error('[crossRefBanqueDepense] index manquant, skip');
      return;
    }
    throw e;
  }

  for (const d of snap.docs) {
    const dep = d.data();
    if (Number(dep.montant) !== montant) continue;
    if (dep.compteCibleNom) continue; // déjà enrichi
    if (dep.valideParPatron) continue; // patron a déjà tranché, on ne touche pas

    // Enrichit la dépense et tente un nouveau lookup mapping avec compte-cible
    const payloadPourMatch = {
      ...dep,
      compteCibleNom: toPropername
    };
    let fournisseur = null;
    try {
      const cfgSnap = await db.collection('config').doc('global').get();
      const patterns = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];
      for (const pat of patterns) {
        if (matchesFournisseurPattern(pat, payloadPourMatch, dep.raison || '')) {
          fournisseur = pat;
          break;
        }
      }
    } catch (e) {
      console.error('[crossRefBanqueDepense] lookup mapping error', e);
    }

    const update = {
      compteCibleNom: toPropername,
      compteCibleAccountId: accountId || null,
      compteCibleDiscord: toDiscord || null
    };
    if (fournisseur) {
      update.type = fournisseur.categorie;
      update.deductible = !!fournisseur.deductible;
      update.categorieSuggeree = fournisseur.categorie;
      update.deductibleSuggere = !!fournisseur.deductible;
      update.fournisseurPatternId = fournisseur.id;
      update.fournisseurLabel = fournisseur.label;
      update.raisonClassification = fournisseur.raisonClassification || '';
    }
    await d.ref.set(update, { merge: true });
    return; // 1 dépense max enrichie par appel (premier match)
  }
}

// === Banque LTD : transactions xbankaccount sur iban LTDSEOUL ===
// Stocke chaque mouvement (entrée ou sortie) avec le solde après transaction.
// Utilisé pour afficher le solde temps réel + audit complet des mouvements.
//
// Cas spécial : si la raison est "Redistribution N°XXXXX" sur une entrée d'argent,
// c'est une VENTE CARBURANT (depuis la migration FiveM de 2026-05). Le N° = ID
// de la pompe côté FiveM. On crée aussi un doc /redistributions pour qu'elle
// apparaisse dans /revenus-carburant. Mapping N° → station via /config.fivemPompesMap.
async function onBankAccount(p) {
  // Phase 3 : si on reçoit un addmoney d'un fournisseur (iban != LTDSEOUL)
  // avec billIdRecu, on enrichit directement la dépense LTD correspondante
  // et on ne stocke RIEN dans /banqueLtd (ce n'est pas notre compte).
  if (!p.estLTD && p.billIdRecu) {
    try {
      await enrichirDepensePaiementFacture({
        billId: p.billIdRecu,
        accountIdDestinataire: p.accountId || '',
        ibanDestinataire: p.iban || ''
      });
    } catch (e) {
      console.error('[onBankAccount] enrichirDepense error', e.message);
    }
    return;
  }

  const docData = {
    type: p.type || 'add',          // 'add' (recette) | 'remove' (sortie)
    iban: p.iban || '',
    accountId: p.accountId || '',
    montant: Number(p.montant) || 0,
    soldeAvant: Number(p.soldeAvant) || 0,
    soldeApres: Number(p.soldeApres) || 0,
    raison: p.raison || '',
    // Émetteur / destinataire (Phase 2 — identification compte cible)
    fromDiscord: p.fromDiscord || '',
    fromName: p.fromName || '',
    fromPropername: p.fromPropername || '',
    toDiscord: p.toDiscord || '',
    toName: p.toName || '',
    toPropername: p.toPropername || '',
    source: 'discord-xbankaccount',
    timestamp: FieldValue.serverTimestamp()
  };
  await db.collection('banqueLtd').add(docData);

  // Pont FlashFA (2026-07-16) : sur ce serveur il n'existe PAS de salon
  // « dépenses » séparé — les retraits du compte entreprise SONT les dépenses.
  // Chaque sortie crée donc une dépense classifiable dans /depenses
  // (suggestion auto via le mapping fournisseurs, paies auto-typées 'paie',
  // sinon « a-classifier » — le patron/cabinet classe et mémorise).
  if ((p.type || 'add') === 'remove' && p.estLTD) {
    try {
      await onDepense({
        compteId: p.accountId || '',
        utilisateur: p.fromPropername || p.fromName || '',
        montant: Number(p.montant) || 0,
        soldeAvant: Number(p.soldeAvant) || 0,
        soldeApres: Number(p.soldeApres) || 0,
        raison: p.raison || '',
        factureId: p.billId || null
      });
    } catch (e) {
      console.error('[onBankAccount] pont dépense FlashFA error', e.message);
    }
  }

  // Phase 2 — cross-réf : si c'est un removemoney avec un toPropername, on
  // cherche une dépense correspondante dans /depenses (même montant, timestamp
  // à ±60s) qui n'a pas encore de fournisseur identifié. Si match, on enrichit
  // la dépense avec compteCibleNom + tente un nouveau lookup mapping pour
  // déclencher l'auto-classification via matchType='compte-cible'.
  if ((p.type || 'add') === 'remove' && (p.toPropername || p.toName)) {
    try {
      await crossRefBanqueDepense({
        montant: Number(p.montant) || 0,
        toPropername: p.toPropername || p.toName,
        toDiscord: p.toDiscord || '',
        accountId: p.accountId || ''
      });
    } catch (e) {
      console.error('[onBankAccount] crossRef dépense error', e.message);
    }
  }

  // Détection vente carburant (raison "Redistribution N°XXXXX" sur entrée)
  // DÉSACTIVÉ (2026-07-16, format FlashFA) : chaque vente carburant émet un
  // événement `xaction - fuel_fill` traité par onStationFuel, qui porte le CA
  // carburant EXACT (litres, prix, client) et le niveau réel de cuve (vol_after).
  // Recréer une redistribution depuis le crédit bancaire "Redistribution N°…"
  // DOUBLERAIT le CA carburant et fausserait le stock (double décrément).
  // Le crédit reste bien enregistré dans /banqueLtd (solde) ci-dessus.
  return;
  /* eslint-disable no-unreachable -- ancien mécanisme conservé pour référence
  if ((p.type || 'add') !== 'add') return;
  const matchRedis = String(p.raison || '').match(/Redistribution\s*N[°º]?\s*(\d+)/i);
  if (!matchRedis) return;
  const fivemPompeId = matchRedis[1];

  // Lookup mapping pompe FiveM → station dans config
  const cfgSnap = await db.collection('config').doc('global').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const mapping = cfg.fivemPompesMap || {};
  const stationId = mapping[fivemPompeId] || '';
  let stationNom = `Station #${fivemPompeId}`;
  let prixLitre = null;
  let stockAvant = null;
  let stockApres = null;
  let litres = null;

  if (stationId) {
    // Lecture + decrement dans une transaction pour eviter les races
    // si plusieurs ventes arrivent quasi-simultanement sur la meme pompe.
    const stationRef = db.collection('stations').doc(stationId);
    await db.runTransaction(async (tx) => {
      const sSnap = await tx.get(stationRef);
      if (!sSnap.exists) return;
      const s = sSnap.data();
      stationNom = s.nom || stationNom;
      prixLitre  = Number(s.prixLitre) || 0;
      stockAvant = Number(s.stockActuel) || 0;
      if (prixLitre > 0) {
        litres = (Number(p.montant) || 0) / prixLitre;
        stockApres = Math.max(0, Math.round((stockAvant - litres) * 100) / 100);
        tx.set(stationRef, {
          stockActuel: stockApres,
          derniereMajAuto: FieldValue.serverTimestamp(),
          sourceMajAuto: 'vente-carburant-auto-decrement'
        }, { merge: true });
      }
    });
  }

  await db.collection('redistributions').add({
    redistributionId: fivemPompeId,        // N° pompe FiveM (pas un id unique de vente)
    fivemPompeId,                          // explicite pour mapping/admin
    station: stationNom,
    stationId: stationId || '',
    montant: Number(p.montant) || 0,
    soldeAvant: Number(p.soldeAvant) || 0,
    soldeApres: Number(p.soldeApres) || 0,
    litres,                                // calcule via montant/prixLitre
    prixLitre,                             // snapshot au moment de la vente
    stockAvant,
    stockApres,
    source: 'banqueLtd-redistribution',
    timestamp: FieldValue.serverTimestamp()
  });
  */
}

// === Facture annulee IG (xbankaccount - cancel) ===
// L'employe IG supprime sa facture (typiquement : client pas solvable). On
// retrouve la /ventes/fac-{billId} correspondante et on la marque cachee +
// annulee, avec motif et identite de l'annulateur. Cas particuliers :
//   - vente bot deja cachee par doublon (declaration manuelle) : on log une
//     alerte direction (potentielle fraude : vendeur a declare puis annule
//     la facture IG pour eviter d'encaisser).
//   - vente manuelle directe (source=manuelle) : meme alerte direction.
//   - vente bot non encore declaree : marquage normal (cas le plus frequent).
//   - aucune vente en base : on ignore (facture d'une autre entite RP).
// Idempotent : si deja annulee, on skip.
async function onFactureCancel(p) {
  const billId = String(p.billId || '').trim();
  if (!billId) return;

  const docId = `fac-${billId}`;
  const ref = db.collection('ventes').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    // Pas dans nos /ventes : soit facture d'un autre joueur RP, soit facture
    // emise avant que le bot ne tourne. Rien a annuler.
    console.log(`[onFactureCancel] billId=${billId} pas en base, skip`);
    return;
  }
  const v = snap.data();
  if (v.annulee === true) {
    // Idempotent
    return;
  }

  // Motif lisible pour audit
  const annulateurNom = p.cancellerPropername || p.cancellerName || 'inconnu';
  const dateLisible = p.formattedTime || (p.time ? new Date(p.time * 1000).toLocaleString('fr-FR') : '');
  const motif = `Supprimee IG par ${annulateurNom}${dateLisible ? ` le ${dateLisible}` : ''}`;

  await ref.set({
    annulee: true,
    cachee: true, // disparait des listings standards (compta, KPI, dashboard)
    motifAnnulation: motif,
    annulateurDiscord: p.cancellerDiscord || '',
    annulateurNom: annulateurNom,
    annulationSource: 'discord-cancel',
    dateAnnulation: FieldValue.serverTimestamp()
  }, { merge: true });

  // Cas suspect : la vente avait deja ete declaree manuellement OU est elle-meme
  // une declaration manuelle directe (source=manuelle). Ca veut dire que le
  // vendeur a encaisse (ou pretendu encaisser) puis a supprime la facture IG.
  // Potentielle fraude → alerte direction.
  const dejaDeclaree = v.source === 'manuelle' || !!v.remplaceeParId;
  if (dejaDeclaree) {
    await db.collection('alertes').add({
      type: 'vente-annulee-apres-declaration',
      message: `⚠ Facture #${billId} (${v.montant || 0}$) annulee IG par ${annulateurNom} APRES declaration. Vendeur : ${v.vendeurNom || '?'}. Verifier que l'argent a bien ete rendu au client.`,
      gravite: 'warn',
      metadata: {
        factureId: billId,
        venteId: docId,
        vendeurId: v.vendeurId || null,
        vendeurNom: v.vendeurNom || '',
        annulateurNom,
        annulateurDiscord: p.cancellerDiscord || '',
        montant: v.montant || 0,
        sourceVente: v.source || ''
      },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });
  }
}

// === RH automatisée : embauches + exclusions (#auto-rh) ===
// Stratégie V1 :
//  - Toujours logger l'événement dans /rhEvenements (audit complet)
//  - EXCLUSION : tenter de retrouver l'utilisateur par idDiscord ou idPerso
//    et basculer son statut à 'suspendu' automatiquement
//  - EMBAUCHE : créer une alerte pour rappeler à l'admin de créer le compte
//    (création Firebase Auth manuelle pour l'instant — sécurité)
async function onAutoRh(p) {
  await db.collection('rhEvenements').add({
    type: p.type,
    prenom: p.prenom || '',
    nom: p.nom || '',
    idDiscord: p.idDiscord || '',
    idPerso: p.idPerso || '',
    parQui: p.parQui || '',
    timestamp: FieldValue.serverTimestamp()
  });

  if (p.type === 'exclusion' || p.type === 'depart') {
    // Suspendre auto le compte (exclusion = licenciement, depart = quitté volontairement)
    let userId = null;
    if (p.idDiscord) {
      const s = await db.collection('users').where('idDiscord', '==', p.idDiscord).limit(1).get();
      if (!s.empty) userId = s.docs[0].id;
    }
    if (!userId && p.idPerso) {
      const s = await db.collection('users').where('idPerso', '==', p.idPerso).limit(1).get();
      if (!s.empty) userId = s.docs[0].id;
    }
    if (userId) {
      const motif = p.type === 'depart' ? 'Départ volontaire' : (p.parQui || 'Exclusion');
      await db.collection('users').doc(userId).set({
        statut: 'suspendu',
        suspenduAt: FieldValue.serverTimestamp(),
        suspenduPar: motif,
        suspenduMotif: p.type
      }, { merge: true });
      console.log(`[autoRh] Compte ${userId} suspendu auto (${p.type}, idDiscord=${p.idDiscord})`);
    } else {
      console.log(`[autoRh] ${p.type} : aucun compte trouvé pour idDiscord=${p.idDiscord} idPerso=${p.idPerso}`);
    }
  } else if (p.type === 'embauche') {
    // Créer une alerte pour rappel à l'admin (création de compte manuel)
    await creerAlerte(
      'embauche-a-traiter',
      `🆕 Nouvel employé à intégrer : ${p.prenom} ${p.nom} (Discord:${p.idDiscord}, Perso:${p.idPerso}). Crée son compte via Admin.`,
      'info',
      { idDiscord: p.idDiscord, idPerso: p.idPerso, prenom: p.prenom, nom: p.nom }
    );
  }
}

// === Promotion automatique (#autorankup) ===
// Met à jour le rôle d'un employé existant si on le retrouve.
async function onAutorankup(p) {
  if (!p.nouveauRole) return;

  // Cherche l'employé par idDiscord, puis idPerso, puis nom complet
  let userId = null;
  if (p.idDiscord) {
    const s = await db.collection('users').where('idDiscord', '==', p.idDiscord).limit(1).get();
    if (!s.empty) userId = s.docs[0].id;
  }
  if (!userId && p.idPerso) {
    const s = await db.collection('users').where('idPerso', '==', p.idPerso).limit(1).get();
    if (!s.empty) userId = s.docs[0].id;
  }
  if (!userId && p.prenom && p.nom) {
    const s = await db.collection('users')
      .where('prenom', '==', p.prenom)
      .where('nom', '==', p.nom)
      .limit(1).get();
    if (!s.empty) userId = s.docs[0].id;
  }

  if (!userId) {
    console.log(`[autorankup] Aucun compte pour ${p.prenom} ${p.nom} (${p.idDiscord})`);
    return;
  }

  await db.collection('users').doc(userId).set({
    role: p.nouveauRole,
    promuAt: FieldValue.serverTimestamp(),
    promuPar: p.parQui || 'auto-bot',
    ancienRole: p.ancienRole || null
  }, { merge: true });
  console.log(`[autorankup] ${p.prenom} ${p.nom} : ${p.ancienRole} → ${p.nouveauRole}`);
}

// === Statsbank (récap hebdo officiel FiveM) ===
// Stockage pour comparaison avec nos calculs internes + import impôt estimé.
// Capte aussi le top vendeurs (nouveauté V2).
async function onStatsbank(p) {
  // Doc id = "S{numero}-{annee}" pour idempotence (1 doc par semaine)
  const docId = `S${String(p.numeroSemaine).padStart(2, '0')}-${p.annee}`;
  await db.collection('statsHebdoOfficiels').doc(docId).set({
    numeroSemaine: p.numeroSemaine,
    annee: p.annee,
    periode: p.periode || '',
    ca: p.ca || 0,
    sorties: p.sorties || 0,
    beneficeBrut: p.beneficeBrut || 0,    // peut être négatif (déficit)
    soldeActuel: p.soldeActuel || 0,
    loyers: p.loyers || 0,
    impotEstime: p.impotEstime || 0,
    trancheImpot: p.trancheImpot || null,
    tauxImpot: p.tauxImpot || null,
    nbFactures: p.nbFactures || 0,
    montantFactures: p.montantFactures || 0,
    nbPayes: p.nbPayes || 0,
    montantPayes: p.montantPayes || 0,
    topVendeurs: p.topVendeurs || [],    // [{ nom, nbFactures, montant }, …]
    source: 'discord-statsbank',
    derniereMaj: FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`[statsbank] ${docId} OK (CA=${p.ca}, bénéfice=${p.beneficeBrut}, ${p.topVendeurs?.length || 0} top vendeurs)`);
}

// === Rapport pompiste quotidien (#pompiste) ===
// NOTE 2026-05-11 : ne MET PLUS A JOUR stockActuel des stations. La source
// de verite stockActuel est maintenant : baseline manuel (modal /stations
// ou script) + decrement automatique via onBankAccount sur chaque vente
// carburant. Le rapport pompiste contenait des valeurs stale qui ecrasaient
// les vraies valeurs in-game. On garde la sauvegarde brute pour audit.
async function onRapportPompiste(p) {
  await db.collection('rapportsPompisteQuotidien').add({
    dateRapport: p.dateRapport || '',
    ca: p.ca || 0,
    nbCommandes: p.nbCommandes || 0,
    niveaux: p.niveaux || [],
    timestamp: FieldValue.serverTimestamp()
  });
}

// === Dashboard stations (#⛽ Station — message édité en place) ===
// NOTE 2026-05-11 : N'ECRIT PLUS stockActuel. Le dashboard in-game contenait
// des valeurs stale qui ecrasaient les vraies valeurs. La source de verite
// stockActuel est maintenant : baseline manuel + decrement via onBankAccount.
// On garde stockMax/prixLitre/derniereRavit/statut/niveauPct car ces infos
// restent utiles (capacite max, prix officiel, dernier ravit etc).
async function onStationsDashboard(p) {
  const stations = Array.isArray(p.stations) ? p.stations : [];
  for (const s of stations) {
    if (!s.stationId) continue;
    const ref = db.collection('stations').doc(s.stationId);
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : {};
    const patch = {
      nom:           s.nom || cur.nom || s.stationId,
      stockMax:      s.stockMax,
      niveauPct:     s.niveauPct,
      prixLitre:     s.prixLitre,
      derniereRavit: s.derniereRavit,
      statut:        s.statut,
      derniereMajAuto: FieldValue.serverTimestamp(),
      sourceMajAuto:   'stations-dashboard'
    };
    await ref.set(patch, { merge: true });
  }
  console.log(`[stationsDashboard] ${stations.length} stations sync (hors stockActuel)`);
}

// === Dossier employe (forum #Dossiers-Employers, threads) ===
// Stocke chaque fiche dans /dossiersEmployes/{threadId} (audit complet).
// 2026-05-11 : AUTO-CREATION COMPTE. Si aucun /users ne matche le nom+prenom :
//   - Cree Firebase Auth user avec username=prenom.nom (slugifie) + mdp aleatoire
//   - Cree /users avec telephone/iban/pole de la fiche + motDePasseProvisoire=true
//   - Cree une alerte info dans /alertes avec les identifiants a transmettre
// Si un /users existe deja : enrichit avec telephone/iban/pole sans toucher
// aux champs critiques (email/idDiscord/idPerso).
async function onDossierEmploye(p) {
  if (!p?.threadId) return;
  await db.collection('dossiersEmployes').doc(p.threadId).set({
    threadId:        p.threadId,
    threadName:      p.threadName || '',
    parentForumId:   p.parentForumId || '',
    auteurDiscordId: p.auteurDiscordId || '',
    auteurUsername:  p.auteurUsername || '',
    nomPrenom:       p.nomPrenom,
    prenom:          p.prenom,
    nom:             p.nom,
    telephone:       p.telephone || '',
    iban:            p.iban || '',
    cni:             p.cni || '',
    permis:          p.permis || '',
    pole:            p.pole || '',
    derniereMaj:     FieldValue.serverTimestamp()
  }, { merge: true });

  if (!p.nom || !p.prenom) return;
  const usersSnap = await db.collection('users')
    .where('nom', '==', p.nom)
    .where('prenom', '==', p.prenom)
    .get();

  if (usersSnap.size > 1) {
    console.log(`[dossierEmploye] ${usersSnap.size} users matchent ${p.prenom} ${p.nom} — skip (ambigu)`);
    return;
  }

  if (usersSnap.size === 0) {
    // === AUTO-CREATION DU COMPTE ===
    const slug = (s) => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    let username = `${slug(p.prenom)}.${slug(p.nom)}`;
    if (username.length < 3 || username.length > 30) {
      console.log(`[dossierEmploye] username '${username}' invalide — skip auto-creation`);
      return;
    }
    // Verifier unicite username (un homonyme deja en base)
    const usernameExisting = await db.collection('users').where('username', '==', username).limit(1).get();
    if (!usernameExisting.empty) {
      username = `${username}.${Date.now().toString(36).slice(-4)}`;
    }

    // Generer mot de passe
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let password = '';
    for (let i = 0; i < 12; i++) password += chars[Math.floor(Math.random() * chars.length)];

    const email = `${username}@ltd-little-seoul.local`;
    // Devine le role depuis le pole (par defaut vendeur-novice)
    const role = /pompiste/i.test(p.pole || '') ? 'pompiste-novice' : 'vendeur-novice';

    try {
      const userRecord = await adminAuth.createUser({
        email, password, emailVerified: true,
        displayName: `${p.prenom} ${p.nom}`
      });
      await db.collection('users').doc(userRecord.uid).set({
        username, email,
        prenom: p.prenom, nom: p.nom,
        idDiscord: p.auteurDiscordId || '',
        idPerso: '',
        role, statut: 'actif',
        dateEntree: new Date().toISOString().slice(0, 10),
        creePar: 'auto-dossier-employe',
        motDePasseProvisoire: true,
        telephone: p.telephone || '',
        iban: p.iban || '',
        pole: p.pole || '',
        cni: p.cni || '',
        permis: p.permis || '',
        sourceCreationThread: p.threadId
      });
      // Alerte direction avec les credentials a transmettre
      await db.collection('alertes').add({
        type: 'compte-cree-auto',
        message: `🆕 Compte auto-cree pour ${p.prenom} ${p.nom} (depuis fiche Discord). Identifiant: ${username} — Mot de passe initial: ${password}. A transmettre via Discord/in-game.`,
        gravite: 'info',
        metadata: { uid: userRecord.uid, username, password, prenom: p.prenom, nom: p.nom, threadId: p.threadId },
        resolue: false,
        timestamp: FieldValue.serverTimestamp()
      });
      console.log(`[dossierEmploye] AUTO-CREATION : ${p.prenom} ${p.nom} → ${username} (uid=${userRecord.uid})`);
    } catch (err) {
      console.error(`[dossierEmploye] AUTO-CREATION FAIL pour ${p.prenom} ${p.nom} :`, err.message);
      await db.collection('alertes').add({
        type: 'compte-cree-auto-error',
        message: `❌ Echec auto-creation compte pour ${p.prenom} ${p.nom} : ${err.message}`,
        gravite: 'warn',
        metadata: { prenom: p.prenom, nom: p.nom, threadId: p.threadId, error: err.message },
        resolue: false,
        timestamp: FieldValue.serverTimestamp()
      });
    }
    return;
  }

  // === ENRICHISSEMENT du user existant ===
  const userRef = usersSnap.docs[0].ref;
  const enrichPatch = {};
  if (p.telephone) enrichPatch.telephone = p.telephone;
  if (p.iban)      enrichPatch.iban      = p.iban;
  if (p.pole)      enrichPatch.pole      = p.pole;
  if (p.cni)       enrichPatch.cni       = p.cni;
  if (p.permis)    enrichPatch.permis    = p.permis;
  if (Object.keys(enrichPatch).length > 0) {
    enrichPatch.enrichiDepuisDossierAt = FieldValue.serverTimestamp();
    enrichPatch.enrichiDepuisDossierThread = p.threadId;
    await userRef.set(enrichPatch, { merge: true });
    console.log(`[dossierEmploye] /users/${userRef.id} enrichi avec ${Object.keys(enrichPatch).join(', ')}`);
  }
}

// === Avertissement (#logs-avertissement, bot Jessica) ===
// Logge dans /rhEvenements (type='avertissement'). Ne modifie PAS le user
// (c'est juste un signal pour le patron, pas une sanction definitive).
async function onAvertissement(p) {
  await db.collection('rhEvenements').add({
    type:             'avertissement',
    sousType:         p.sousType || 'avertissement',
    memberDiscordId:  p.memberDiscordId || '',
    dureeMinutes:     p.dureeMinutes ?? null,
    debut:            p.debut || '',
    fin:              p.fin || '',
    rawDescription:   p.rawDescription || '',
    timestamp:        FieldValue.serverTimestamp(),
    traitee:          false
  });
  console.log(`[avertissement] ${p.sousType} pour <@${p.memberDiscordId}> (duree=${p.dureeMinutes}min)`);
}

// === Licenciement (#logs-licenciement, bot Jessica) ===
// 1. Logge dans /rhEvenements (type='licenciement') — audit complet.
// 2. Met a jour le user correspondant en statut='exclu' si on le trouve
//    (match par idDiscord d'abord, fallback idPerso). Stocke la date de fin.
async function onLicenciement(p) {
  await db.collection('rhEvenements').add({
    type:             'licenciement',
    sousType:         p.typeLicenciement || 'licenciement',
    memberDiscordId:  p.memberDiscordId || '',
    discordId:        p.discordId || '',
    idPerso:          p.idPerso || '',
    nom:              p.nom || '',
    prenom:           p.prenom || '',
    telephone:        p.telephone || '',
    iban:             p.iban || '',
    dateEmbauche:     p.dateEmbauche || '',
    dateFin:          p.dateFin || '',
    parQui:           p.parQui || '',
    raison:           p.raison || '',
    casierLibere:     p.casierLibere || '',
    rawDescription:   p.rawDescription || '',
    timestamp:        FieldValue.serverTimestamp(),
    traitee:          false
  });

  // Tente de retrouver et suspendre le user
  let userDoc = null;
  if (p.memberDiscordId) {
    const s = await db.collection('users').where('idDiscord', '==', p.memberDiscordId).limit(1).get();
    if (!s.empty) userDoc = s.docs[0];
  }
  if (!userDoc && p.idPerso) {
    const s = await db.collection('users').where('idPerso', '==', p.idPerso).limit(1).get();
    if (!s.empty) userDoc = s.docs[0];
  }
  if (userDoc) {
    await userDoc.ref.set({
      statut:        'exclu',
      dateExclusion: p.dateFin || '',
      raisonExclusion: p.raison || '',
      typeExclusion: p.typeLicenciement || '',
      excluPar:      p.parQui || ''
    }, { merge: true });
    console.log(`[licenciement] /users/${userDoc.id} marque exclu (type=${p.typeLicenciement})`);
  } else {
    console.log(`[licenciement] aucun user matche pour ${p.prenom} ${p.nom} (discord=${p.memberDiscordId} idPerso=${p.idPerso}) — log uniquement`);
  }
}

// === Sortie/retour véhicule LTD (#logs-vehicules) ===
// Stocké dans /sortiesVehicules. Permet d'auditer l'usage des véhicules
// d'entreprise par employé (qui prend quoi, quand). Pas de side-effect
// sur les autres collections.
async function onVehicule(p) {
  let employeId = null;
  if (p.employeDiscord) {
    const u = await db.collection('users').where('idDiscord', '==', p.employeDiscord).limit(1).get();
    if (!u.empty) employeId = u.docs[0].id;
  }
  const ts = p.heureMs ? Timestamp.fromMillis(Number(p.heureMs)) : FieldValue.serverTimestamp();
  await db.collection('sortiesVehicules').add({
    action: p.action || 'autre',
    employeId,
    employeDiscord: p.employeDiscord || '',
    employeNom: p.employeNom || '',
    characterId: p.characterId || '',
    vehiculeId: p.vehiculeId || '',
    markerId: p.markerId || '',
    actionId: p.actionId || '',
    source: p.source || '',
    timestamp: ts
  });
}

// === Nouvel employé / stagiaire (#stagiaire) ===
// Crée un événement RH ET enrichit /users matchant idPerso (priorité)
// puis idDiscord, avec téléphone, IBAN, casier (si renseignés).
async function onStagiaire(p) {
  const dateEmbauche = p.dateEmbauche ? new Date(p.dateEmbauche) : null;

  // 1) Logger l'événement RH (audit)
  await db.collection('rhEvenements').add({
    type: 'embauche-stagiaire',
    employeDiscord: p.employeDiscord || '',
    employeUsername: p.employeUsername || '',
    idPerso: p.idPerso || '',
    nom: p.nom || '',
    prenom: p.prenom || '',
    telephone: p.telephone || null,
    iban: p.iban || null,
    casier: p.casier || null,
    dateEmbauche: dateEmbauche ? Timestamp.fromDate(dateEmbauche) : null,
    recruteurDiscord: p.recruteurDiscord || '',
    traitee: false,
    timestamp: FieldValue.serverTimestamp()
  });

  // 2) Enrichir /users si match idPerso ou idDiscord
  let userRef = null;
  if (p.idPerso) {
    const s = await db.collection('users').where('idPerso', '==', p.idPerso).limit(1).get();
    if (!s.empty) userRef = s.docs[0].ref;
  }
  if (!userRef && p.employeDiscord) {
    const s = await db.collection('users').where('idDiscord', '==', p.employeDiscord).limit(1).get();
    if (!s.empty) userRef = s.docs[0].ref;
  }
  if (userRef) {
    const patch = {};
    if (p.telephone) patch.telephone = p.telephone;
    if (p.iban)      patch.iban      = p.iban;
    if (p.casier)    patch.casier    = p.casier;
    if (dateEmbauche && !isNaN(dateEmbauche.getTime())) {
      patch.dateEmbauche = Timestamp.fromDate(dateEmbauche);
    }
    if (Object.keys(patch).length > 0) {
      await userRef.set(patch, { merge: true });
    }
  }
}

// === Vente-auto (#ventes — distributeur LTD automatique) ===
// Stockée dans /ventes avec source='ventes-auto' pour distinguer.
async function onVenteAuto(p) {
  await db.collection('ventes').add({
    factureId:  p.venteId || '',
    vendeurNom: p.vendeurNom || 'LTD',
    clientNom:  p.clientNom || '',
    typeVente:  p.typeVente || '',
    montant:    Number(p.montant) || 0,
    benefice:   0, // pas calculable sans mapping noms FiveM ↔ catalogue
    paiement:   '',
    raison:     p.articlesBrut || '',
    items:      p.items || [],
    stockVerifie: null,
    source:     'ventes-auto',
    timestamp:  FieldValue.serverTimestamp()
  });
}

async function onPaie(p) {
  // Résolution automatique de l'uid Firebase via idPerso ou idDiscord
  const resolveUid = async (idPerso, idDiscord) => {
    if (idPerso) {
      const s = await db.collection('users').where('idPerso', '==', idPerso).limit(1).get();
      if (!s.empty) return s.docs[0].id;
    }
    if (idDiscord) {
      const s = await db.collection('users').where('idDiscord', '==', idDiscord).limit(1).get();
      if (!s.empty) return s.docs[0].id;
    }
    return null;
  };
  const beneficiaireId = p.beneficiaireId || await resolveUid(p.beneficiaireIdPerso, p.beneficiaireDiscord);
  const payeurId       = p.payeurId       || await resolveUid(p.payeurIdPerso,       p.payeurDiscord);

  await db.collection('paies').add({
    payeurDiscord: p.payeurDiscord,
    payeurNom: p.payeurNom,
    payeurIdPerso: p.payeurIdPerso,
    payeurId,
    beneficiaireDiscord: p.beneficiaireDiscord,
    beneficiaireNom: p.beneficiaireNom,
    beneficiaireIdPerso: p.beneficiaireIdPerso,
    beneficiaireId,
    montant: Number(p.montant) || 0,
    timestamp: FieldValue.serverTimestamp()
  });
}

async function onCoffre(p) {
  // Snapshot inventaire — on remplace
  await db.collection('coffres').doc(p.coffreId).set({
    coffreId: p.coffreId,
    itemsDistincts: p.itemsDistincts,
    items: p.items,
    miseAJour: FieldValue.serverTimestamp()
  });
}

async function onLogBrut(p) {
  // Stockage générique pour les canaux non parsés (suivi-coffre-secondaire,
  // alerte-coffre, revenu, factures, statsbank, logs-licenciement, logs-avertissement).
  await db.collection('logsBruts').add({
    canal: p.canal,
    contenu: p.contenu,
    auteur: p.auteur || '',
    timestamp: FieldValue.serverTimestamp()
  });
}

// === Quota pompiste ===
// Atomique via FieldValue.increment() — résiste aux events parallèles.
async function majQuotaPompiste(idPerso, item, qte) {
  const usnap = await db.collection('users').where('idPerso', '==', idPerso).limit(1).get();
  if (usnap.empty) return;
  const employeId = usnap.docs[0].id;

  const wId = currentWeekId();
  const docId = `${wId}_${employeId}`;
  const ref = db.collection('quotasPompiste').doc(docId);
  const champ = slug(item) === 'bidon-essence' ? 'bidons' : 'caoutchoucs';

  await ref.set({
    semaine: wId,
    employeId,
    [champ]: FieldValue.increment(qte)
  }, { merge: true });
}

// === Helpers ===
function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Resolution employe par nom RP, case-insensitive et tolerant aux accents.
// Utilise quand idDiscord/idPerso ne sont pas presents dans l'embed (cas
// frequent : "Ilyes Chaifi a commence son service" / "Facture #X par Ilyes Chaifi").
// Necessaire car certains embeds FiveM ne portent pas de mention Discord.
async function resolveEmployeeIdByName(nomComplet) {
  if (!nomComplet) return null;
  const parts = String(nomComplet).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const norm = (s) => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const usersSnap = await db.collection('users').get();
  const candidats = [
    // Tentative 1 : prenom = 1er mot, nom = reste
    { prenom: parts[0], nom: parts.slice(1).join(' ') },
    // Tentative 2 : prenom = tous sauf dernier, nom = dernier
    // Utile pour "Prenom Nom" -> prenom="Luciana Angel", nom="MARS"
    ...(parts.length >= 3 ? [{ prenom: parts.slice(0, -1).join(' '), nom: parts.at(-1) }] : []),
    // Tentative 3 (2026-06-19) : ORDRE INVERSE prenom<->nom. Certains comptes
    // ont ete crees avec prenom/nom permutes (ex: compte prenom="Roux"
    // nom="THOBIAS" alors que le nom affiche est "Thobias Roux"). Sans ce
    // fallback la vente reste orpheline (vendeurId=null) et le vendeur ne la
    // voit jamais dans son bloc "factures a declarer". Place en DERNIER pour
    // que l'ordre naturel l'emporte en cas d'ambiguite.
    { prenom: parts.at(-1), nom: parts.slice(0, -1).join(' ') }
  ];
  for (const c of candidats) {
    const match = usersSnap.docs.find(d => {
      const u = d.data();
      return norm(u.prenom) === norm(c.prenom) && norm(u.nom) === norm(c.nom);
    });
    if (match) return match.id;
  }
  return null;
}
// Renvoie le weekKey YYYY-MM-DD du lundi de la semaine RP pour un timestamp
// donne, en horloge Europe/Paris. Cloud Functions tournent en UTC : un
// timestamp slice naivement en ISO range les actions de lundi 00h-02h Paris
// (= dim 22h-00h UTC CEST) dans la semaine PRECEDENTE. Meme pattern que
// cloturerSemaine (commit a259805).
function weekIdFromTimestamp(d) {
  const parisStr = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false });
  const parisWall = new Date(parisStr.replace(' ', 'T') + 'Z');
  const day = parisWall.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  parisWall.setUTCDate(parisWall.getUTCDate() + diff);
  parisWall.setUTCHours(0, 0, 0, 0);
  return parisWall.toISOString().slice(0, 10);
}
function currentWeekId() { return weekIdFromTimestamp(new Date()); }

// Applique une difference au quota pompiste de la semaine d'un timestamp
// donne. Utilise par les 4 Cloud Functions modifier/supprimer
// ravitaillement/caoutchoucs pour synchroniser quota et declarations.
async function applyQuotaPompisteDelta(pompisteId, ts, deltas) {
  if (!pompisteId) return;
  const wId = weekIdFromTimestamp(ts || new Date());
  const patch = { semaine: wId, employeId: pompisteId };
  if (deltas.bidons != null)      patch.bidons      = FieldValue.increment(deltas.bidons);
  if (deltas.caoutchoucs != null) patch.caoutchoucs = FieldValue.increment(deltas.caoutchoucs);
  await db.collection('quotasPompiste').doc(`${wId}_${pompisteId}`).set(patch, { merge: true });
}

// ----------------------------------------------------------------
// 4. Export comptabilité CSV pour Google Sheets (IMPORTDATA)
// ----------------------------------------------------------------
// Endpoint HTTP public, protégé par token query param (?token=xxx).
// Retourne du CSV utilisable directement par =IMPORTDATA(URL) dans Sheets.
// 4 types : ?type=resume | depenses | ventes | paies
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// migrateUsername — Change l'email Firebase Auth vers le synthetique
// {username}@ltd-little-seoul.local pour les utilisateurs existants.
// ----------------------------------------------------------------
// Contourne la restriction "Please verify the new email before changing"
// imposee aux clients par Firebase Auth (protection recente). L'Admin SDK
// bypass cette verification.
// Le caller doit etre authentifie et n'agit que sur SON propre compte.
// ----------------------------------------------------------------
export const migrateUsername = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const { username } = req.body || {};
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username invalide : 3-30 caracteres, lettres/chiffres/. _ -' });
    }

    // Verification unicite
    const existing = await db.collection('users').where('username', '==', cleanUsername).limit(1).get();
    if (!existing.empty && existing.docs[0].id !== uid) {
      return res.status(409).json({ error: `Username "${cleanUsername}" deja pris` });
    }

    const newEmail = `${cleanUsername}@ltd-little-seoul.local`;

    // Admin SDK : updateUser bypass le requirement de verification email
    await adminAuth.updateUser(uid, { email: newEmail, emailVerified: true });
    await db.collection('users').doc(uid).set({
      username: cleanUsername,
      email: newEmail,
      motDePasseProvisoire: true,
      usernameDefiniLe: FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({ ok: true, username: cleanUsername, email: newEmail });
  } catch (err) {
    console.error('[migrateUsername]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// adminResetPassword — Régénère le MDP d'un compte par un admin
// ----------------------------------------------------------------
// Sécurité : caller doit être Patron / Co-Patron / Admin Technique
// (vérifié via le ID token Firebase Auth fourni en header).
// Retourne le nouveau MDP en clair (one-shot) pour transmission RP.
// Met motDePasseProvisoire=true pour forcer un changement à la
// prochaine connexion.
// ----------------------------------------------------------------
export const adminResetPassword = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const callerRole = callerSnap.data().role;
    const ROLES_ADMIN = ['patron', 'co-patron', 'admin-technique'];
    if (!ROLES_ADMIN.includes(callerRole)) {
      return res.status(403).json({ error: 'Only patron/co-patron/admin-technique can reset passwords' });
    }

    const { targetUid } = req.body || {};
    if (!targetUid) return res.status(400).json({ error: 'Missing targetUid' });

    // Garde-fou : on ne reset pas le patron sauf si caller est patron ou super admin
    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) return res.status(404).json({ error: 'Target user not found' });
    const targetRole = targetSnap.data().role;
    if (targetRole === 'patron' && callerRole !== 'patron' && callerRole !== 'admin-technique') {
      return res.status(403).json({ error: 'Only patron or admin-technique can reset the patron password' });
    }

    // Génère un nouveau mot de passe aléatoire (12 chars, sans caractères ambigus)
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let newPassword = '';
    for (let i = 0; i < 12; i++) newPassword += chars[Math.floor(Math.random() * chars.length)];

    // Update Firebase Auth + flag motDePasseProvisoire
    await adminAuth.updateUser(targetUid, { password: newPassword });
    await db.collection('users').doc(targetUid).set({
      motDePasseProvisoire: true,
      mdpRegenereLe: FieldValue.serverTimestamp(),
      mdpRegenerePar: decoded.uid
    }, { merge: true });

    return res.status(200).json({ password: newPassword });
  } catch (err) {
    console.error('[adminResetPassword]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// supprimerEmploye — Supprime un compte employé (fiche Firestore + compte Auth)
// ----------------------------------------------------------------
// Sécurité : caller doit être Patron / Co-Patron / Admin Technique
// (vérifié via le ID token Firebase Auth fourni en header).
// Supprime À LA FOIS la fiche /users/{uid} ET le compte Firebase Auth, pour ne
// plus laisser de compte Auth orphelin — qui bloquait la recréation d'un même
// identifiant (erreur auth/email-already-in-use, le client SDK ne pouvant pas
// supprimer un autre compte Auth que le sien).
// Les données métier (ventes, paies, services) ne sont PAS touchées (audit TTE).
// ----------------------------------------------------------------
export const supprimerEmploye = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const callerRole = callerSnap.data().role;
    const ROLES_ADMIN = ['patron', 'co-patron', 'admin-technique'];
    if (!ROLES_ADMIN.includes(callerRole)) {
      return res.status(403).json({ error: 'Only patron/co-patron/admin-technique can delete accounts' });
    }

    const { targetUid } = req.body || {};
    if (!targetUid) return res.status(400).json({ error: 'Missing targetUid' });
    if (targetUid === decoded.uid) return res.status(403).json({ error: 'Cannot delete your own account' });

    // Garde-fou patron : seul un patron ou un admin-technique peut supprimer un patron.
    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (targetSnap.exists) {
      const targetRole = targetSnap.data().role;
      if (targetRole === 'patron' && callerRole !== 'patron' && callerRole !== 'admin-technique') {
        return res.status(403).json({ error: 'Only patron or admin-technique can delete the patron account' });
      }
    }

    // 1) Compte Firebase Auth (libère l'email/login). Ignore s'il est déjà absent.
    let authDeleted = false;
    try {
      await adminAuth.deleteUser(targetUid);
      authDeleted = true;
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // 2) Fiche Firestore (les ventes/paies/services restent pour l'audit TTE).
    await db.collection('users').doc(targetUid).delete();

    return res.status(200).json({ ok: true, authDeleted });
  } catch (err) {
    console.error('[supprimerEmploye]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// pompisteRavitaillerManuel — Le pompiste declare avoir mis N bidons.
// ----------------------------------------------------------------
// Le pompiste raisonne en bidons, pas en litres. Cette fonction :
//   1. stockActuel += N * 15 (cap a stockMax)
//   2. cree un doc /redistributions source='manuel-pompiste' (audit)
//   3. incremente /quotasPompiste/{semaine}_{uid}.bidons de N
// Le modal = source de verite quota (pas les logs FiveM inventory-add).
// Atomique via Cloud Function pour bypasser les rules Firestore
// restrictives (quotas/redistributions = canAdmin uniquement).
// ----------------------------------------------------------------
export const pompisteRavitaillerManuel = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    const allowed = isDir || role === 'responsable-pompiste' || /^pompiste-/.test(role);
    if (!allowed) return res.status(403).json({ error: 'Ce role ne peut pas ravitailler une station.' });
    // Blocage : direction exemptee (sinon deadlock si patron prend 3 averts)
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction pour qu\'elle en retire un.' });
    }

    const { stationId, bidons, litres } = req.body || {};
    if (!stationId) return res.status(400).json({ error: 'Missing stationId' });

    // Defense en profondeur : refus si la dimension est desactivee cette
    // semaine (quotaBidons = 0). Symetrique avec pompisteDeclarerCaoutchoucs.
    const cfgSnap = await db.collection('config').doc('global').get();
    const quotaB = Number((cfgSnap.exists ? cfgSnap.data() : {}).quotaBidons ?? 1700);
    if (quotaB === 0) {
      return res.status(403).json({ error: 'Ravitaillement non requis cette semaine (quota bidons desactive par la direction).' });
    }

    const BIDON_L = 15;
    let nbBidons, litresDemandes;
    // Mode "litres" (depuis Mon espace pompiste 2026-05-14) : prioritaire si fourni
    if (litres != null) {
      const nbLitres = Number(litres);
      if (!Number.isFinite(nbLitres) || nbLitres <= 0) {
        return res.status(400).json({ error: 'litres doit etre un nombre > 0' });
      }
      litresDemandes = nbLitres;
      nbBidons = nbLitres / BIDON_L; // peut etre decimal (ex: 47L = 3.13 bidons)
    } else {
      // Mode legacy "bidons" (depuis page Stations)
      nbBidons = Number(bidons);
      if (!Number.isFinite(nbBidons) || nbBidons <= 0 || !Number.isInteger(nbBidons)) {
        return res.status(400).json({ error: 'bidons doit etre un entier > 0' });
      }
      litresDemandes = nbBidons * BIDON_L;
    }

    const stRef = db.collection('stations').doc(stationId);
    const stSnap = await stRef.get();
    if (!stSnap.exists) return res.status(404).json({ error: 'Station introuvable' });
    const station = stSnap.data();
    const stockAvant = Number(station.stockActuel || 0);
    const stockMax = Number(station.stockMax || 0);
    const stockApres = stockAvant + litresDemandes;
    const pompisteNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();

    // Refuse hard si depasse la capacite max (anti-fraude / detection mensonge).
    // On cree aussi une alerte direction avec la tentative pour audit.
    if (stockMax > 0 && stockApres > stockMax) {
      const placeRestante = Math.max(0, stockMax - stockAvant);
      const bidonsMax = Math.floor(placeRestante / BIDON_L);
      await db.collection('alertes').add({
        type: 'pompiste-overflow-tentative',
        message: `🚨 ${pompisteNom} a tenté de ravitailler ${station.nom || stationId} de ${nbBidons} bidons (${litresDemandes} L) alors que la station n'accepte que ${bidonsMax} bidons max (${placeRestante} L libres).`,
        gravite: 'warn',
        metadata: { stationId, pompisteId: decoded.uid, pompisteNom, bidonsTentes: nbBidons, bidonsMax, stockAvant, stockMax },
        resolue: false,
        timestamp: FieldValue.serverTimestamp()
      });
      return res.status(400).json({
        error: `Impossible : la station n'a que ${placeRestante} L libres (${bidonsMax} bidons max). Tu as saisi ${litresDemandes} L.`,
        bidonsMax, placeRestante, stockAvant, stockMax
      });
    }
    const litresAjoutes = litresDemandes;

    // 1. Update station
    await stRef.set({
      stockActuel: stockApres,
      derniereModifPar: { uid: decoded.uid, nom: pompisteNom },
      sourceMajAuto: 'modal-bidons-pompiste',
      derniereRedistribution: FieldValue.serverTimestamp()
    }, { merge: true });

    // 2. Audit /redistributions
    await db.collection('redistributions').add({
      station: station.nom || stationId,
      stationId,
      litres: litresAjoutes,
      bidons: nbBidons,
      prixLitre: Number(station.prixLitre || 0),
      montant: 0,                   // pas de vente, juste ravitaillement
      stockAvant,
      stockApres,
      source: 'manuel-pompiste',
      pompisteId: decoded.uid,
      pompisteNom,
      timestamp: FieldValue.serverTimestamp()
    });

    // 3. Incremente quota pompiste
    const wId = currentWeekId();
    const docId = `${wId}_${decoded.uid}`;
    await db.collection('quotasPompiste').doc(docId).set({
      semaine: wId,
      employeId: decoded.uid,
      bidons: FieldValue.increment(nbBidons)
    }, { merge: true });

    return res.status(200).json({
      ok: true, bidons: nbBidons, litresAjoutes, stockApres, stockMax
    });
  } catch (err) {
    console.error('[pompisteRavitaillerManuel]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// pompisteDeclarerCaoutchoucs — Le pompiste declare N caoutchoucs fabriques.
// ----------------------------------------------------------------
// Le pompiste fabrique des caoutchoucs et les pose dans le coffre dedie.
// Cette fonction :
//   1. Cree un doc /declarationsCaoutchouc (audit : qui, combien, quand)
//   2. Incremente /quotasPompiste/{semaine}_{uid}.caoutchoucs de N
// Le decompte auto via #logs-ig (inventory-add caoutchouc) est neutralise
// depuis 2026-05-12 — le modal site est la source de verite unique.
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// pompisteCorrigerStock — Pompiste corrige le stock d'une station.
// ----------------------------------------------------------------
// Cas : incoherence entre le stock affiche sur le site et la valeur reelle in-game.
// Le pompiste choisit la station + saisit la VRAIE valeur en L + raison obligatoire.
// Une alerte direction est creee a chaque correction (audit + detection abus).
// N'incremente PAS le quota perso (c'est une correction, pas un ravitaillement).
// ----------------------------------------------------------------
export const pompisteCorrigerStock = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    const allowed = isDir || role === 'responsable-pompiste' || /^pompiste-/.test(role);
    if (!allowed) return res.status(403).json({ error: 'Ce role ne peut pas corriger un stock station.' });
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction.' });
    }

    const { stationId, nouveauStock, raison } = req.body || {};
    if (!stationId) return res.status(400).json({ error: 'Missing stationId' });
    const valeurCible = Number(nouveauStock);
    if (!Number.isFinite(valeurCible) || valeurCible < 0) {
      return res.status(400).json({ error: 'nouveauStock doit etre un nombre >= 0' });
    }
    const motif = String(raison || '').trim();
    if (motif.length < 5) {
      return res.status(400).json({ error: 'Une raison detaillee est obligatoire (au moins 5 caracteres).' });
    }

    const stRef = db.collection('stations').doc(stationId);
    const stSnap = await stRef.get();
    if (!stSnap.exists) return res.status(404).json({ error: 'Station introuvable' });
    const station = stSnap.data();
    const stockAvant = Number(station.stockActuel || 0);
    const stockMax = Number(station.stockMax || 0);
    if (stockMax > 0 && valeurCible > stockMax) {
      return res.status(400).json({ error: `La valeur saisie (${valeurCible} L) depasse la capacite max (${stockMax} L).` });
    }
    const ecart = valeurCible - stockAvant;
    const pompisteNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();

    // 1. Update station avec la nouvelle valeur
    await stRef.set({
      stockActuel: valeurCible,
      derniereModifPar: { uid: decoded.uid, nom: pompisteNom },
      sourceMajAuto: 'modal-correction-pompiste',
      derniereCorrection: FieldValue.serverTimestamp()
    }, { merge: true });

    // 2. Audit /redistributions (avec ecart pour detection)
    await db.collection('redistributions').add({
      station: station.nom || stationId,
      stationId,
      litres: ecart,
      bidons: 0,
      prixLitre: Number(station.prixLitre || 0),
      montant: 0,
      stockAvant,
      stockApres: valeurCible,
      source: 'correction-pompiste',
      pompisteId: decoded.uid,
      pompisteNom,
      raison: motif,
      timestamp: FieldValue.serverTimestamp()
    });

    // 3. Alerte direction (toujours creee — audit obligatoire des corrections)
    const gravite = Math.abs(ecart) > 5000 ? 'danger' : (Math.abs(ecart) > 1000 ? 'warn' : 'info');
    await db.collection('alertes').add({
      type: 'pompiste-correction-stock',
      message: `📐 ${pompisteNom} a corrige ${station.nom || stationId} : ${stockAvant} L → ${valeurCible} L (ecart ${ecart > 0 ? '+' : ''}${ecart} L). Raison : "${motif}"`,
      gravite,
      metadata: {
        stationId, pompisteId: decoded.uid, pompisteNom,
        stockAvant, stockApres: valeurCible, ecart, raison: motif
      },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });

    return res.status(200).json({ ok: true, stockAvant, stockApres: valeurCible, ecart });
  } catch (err) {
    console.error('[pompisteCorrigerStock]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
export const pompisteDeclarerCaoutchoucs = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    const allowed = isDir || role === 'responsable-pompiste' || /^pompiste-/.test(role);
    if (!allowed) return res.status(403).json({ error: 'Ce role ne peut pas declarer de caoutchoucs.' });
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction pour qu\'elle en retire un.' });
    }

    const { caoutchoucs } = req.body || {};
    const nb = Number(caoutchoucs);
    if (!Number.isFinite(nb) || nb <= 0 || !Number.isInteger(nb)) {
      return res.status(400).json({ error: 'caoutchoucs doit etre un entier > 0' });
    }
    if (nb > 500) {
      return res.status(400).json({ error: 'Maximum 500 caoutchoucs par declaration (anti-erreur de saisie).' });
    }

    // Defense en profondeur : refus si la dimension est desactivee cette
    // semaine (quotaCaoutchoucs = 0). Empeche toute declaration meme si le
    // frontend a ete bypasse.
    const cfgSnap = await db.collection('config').doc('global').get();
    const quotaC = Number((cfgSnap.exists ? cfgSnap.data() : {}).quotaCaoutchoucs ?? 800);
    if (quotaC === 0) {
      return res.status(403).json({ error: 'Caoutchoucs non requis cette semaine (quota desactive par la direction).' });
    }

    const pompisteNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();

    // 1. Audit /declarationsCaoutchouc
    await db.collection('declarationsCaoutchouc').add({
      caoutchoucs: nb,
      pompisteId: decoded.uid,
      pompisteNom,
      source: 'manuel-pompiste',
      timestamp: FieldValue.serverTimestamp()
    });

    // 2. Incremente quota pompiste
    const wId = currentWeekId();
    const docId = `${wId}_${decoded.uid}`;
    await db.collection('quotasPompiste').doc(docId).set({
      semaine: wId,
      employeId: decoded.uid,
      caoutchoucs: FieldValue.increment(nb)
    }, { merge: true });

    return res.status(200).json({ ok: true, caoutchoucs: nb });
  } catch (err) {
    console.error('[pompisteDeclarerCaoutchoucs]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// vendeurDeclarerFabrication — Le vendeur declare N unites craftees
// d'un produit du quota fabrication hebdo.
// ----------------------------------------------------------------
// Symetrique de pompisteDeclarerCaoutchoucs : modal cote vendeur.
// 4 ecritures dans 1 batch atomique :
//   1. Audit /fabrications (qui, quoi, combien, quand)
//   2. Incremente /quotasVendeur/{semaine}_{uid}.{produitId} de N
//   3. Incremente /stocks/{produitId}.quantite de N (ajout 2026-05-25)
//   4. Audit /mouvementsStock (type=fabrication-vendeur)
// Si quota du produit = 0 cette semaine : declaration acceptee mais
// le bonus quota n'est pas impacte (utile pour le futur classement
// hebdo craft).
// NB : seul l'OUTPUT du craft est incremente. Les intrants (acier,
// charbon, corde, etc.) ne sont pas decrementes automatiquement —
// le patron suit son stock intrant manuellement.
// ----------------------------------------------------------------
export const vendeurDeclarerFabrication = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    // Quotas fabrication = vendeurs uniquement. Direction garde l'acces pour debug.
    const allowed = isDir || /^vendeur-/.test(role);
    if (!allowed) return res.status(403).json({ error: 'Seuls les vendeurs peuvent declarer une fabrication.' });
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction pour qu\'elle en retire un.' });
    }

    const { produitId, quantite } = req.body || {};
    const pid = String(produitId || '').trim();
    if (!PRODUITS_QUOTA_FAB.includes(pid)) {
      return res.status(400).json({ error: `produitId invalide. Attendu : ${PRODUITS_QUOTA_FAB.join(', ')}.` });
    }
    const nb = Number(quantite);
    if (!Number.isFinite(nb) || nb <= 0 || !Number.isInteger(nb)) {
      return res.status(400).json({ error: 'quantite doit etre un entier > 0' });
    }
    if (nb > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 unites par declaration (anti-erreur de saisie).' });
    }

    const vendeurNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    const wId = currentWeekId();
    const quotaDocId = `${wId}_${decoded.uid}`;

    // Batch atomique : audit fab + quota vendeur + stock + audit mouvement.
    const batch = db.batch();

    const fabRef = db.collection('fabrications').doc();
    batch.set(fabRef, {
      produitId: pid,
      quantite: nb,
      vendeurId: decoded.uid,
      vendeurNom,
      source: 'manuel-vendeur',
      timestamp: FieldValue.serverTimestamp()
    });

    const quotaRef = db.collection('quotasVendeur').doc(quotaDocId);
    batch.set(quotaRef, {
      semaine: wId,
      employeId: decoded.uid,
      [pid]: FieldValue.increment(nb)
    }, { merge: true });

    const stockRef = db.collection('stocks').doc(pid);
    batch.set(stockRef, {
      quantite: FieldValue.increment(nb),
      derniereMaj: FieldValue.serverTimestamp(),
      par: decoded.uid
    }, { merge: true });

    const movRef = db.collection('mouvementsStock').doc();
    batch.set(movRef, {
      type: 'fabrication-vendeur',
      item: pid,
      quantite: nb,
      par: decoded.uid,
      raison: `Fabrication declaree par ${vendeurNom}`,
      timestamp: FieldValue.serverTimestamp()
    });

    await batch.commit();

    return res.status(200).json({ ok: true, produitId: pid, quantite: nb });
  } catch (err) {
    console.error('[vendeurDeclarerFabrication]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ============================================================
// NOTES DE FRAIS (essence vehicule LTD avance par le pompiste)
// ============================================================
// Le pompiste avance l'essence des vehicules LTD avec son propre argent IG.
// Il prend un screenshot de la confirmation IG, declare le montant + colle
// le lien du screenshot. Le patron approuve/rejette/rembourse en fin de
// semaine.
// ============================================================

// creerNoteFrais — pompiste/resp-pompiste declare une avance d'essence.
export const creerNoteFrais = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    const allowed = isDir || role === 'drh' || role === 'responsable-pompiste' || /^pompiste-/.test(role);
    if (!allowed) return res.status(403).json({ error: 'Ce role ne peut pas declarer une note de frais.' });
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction.' });
    }

    const { montant, screenshotUrl, description } = req.body || {};
    const m = Number(montant);
    if (!Number.isFinite(m) || m <= 0) {
      return res.status(400).json({ error: 'Montant doit etre un nombre > 0' });
    }
    if (m > 100000) {
      return res.status(400).json({ error: 'Montant excessif (> 100 000 $) — verifie ta saisie.' });
    }
    const url = String(screenshotUrl || '').trim();
    if (!url) return res.status(400).json({ error: 'Le screenshot est obligatoire.' });
    // 2 formats acceptes :
    //   - https:// (heberge externe : Discord, Imgur, etc.)
    //   - data:image/... (colle Ctrl+V, encode base64 par le frontend)
    // Pour data:, on verifie aussi la taille (max 950 KB pour rester sous la
    // limite Firestore de 1 MB par doc).
    if (/^https?:\/\//.test(url)) {
      // OK URL externe
    } else if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(url)) {
      if (url.length > 950 * 1024) {
        return res.status(400).json({ error: 'Screenshot trop lourd (> 950 KB). Le frontend devrait avoir compresse — retente.' });
      }
    } else {
      return res.status(400).json({ error: 'Format screenshot invalide (attendu : URL http(s):// ou image collee data:image/...).' });
    }
    const desc = String(description || '').trim().slice(0, 500);

    const employeNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    const docRef = await db.collection('notesFrais').add({
      employeId: decoded.uid,
      employeNom,
      employeRole: role,
      montant: Math.round(m * 100) / 100,
      screenshotUrl: url,
      description: desc,
      timestamp: FieldValue.serverTimestamp(),
      statut: 'en-attente',
      traiteePar: null,
      traiteeParNom: null,
      traiteeAt: null,
      motifRejet: null,
      dateRemboursement: null
    });

    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error('[creerNoteFrais]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// traiterNoteFrais — direction approuve / rejette / marque remboursee.
// Si 'rembourser' : cree aussi un doc /depenses pour l'audit comptable.
export const traiterNoteFrais = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const allowed = role === 'patron' || role === 'co-patron' || role === 'admin-technique' || role === 'drh';
    if (!allowed) return res.status(403).json({ error: 'Direction / DRH uniquement.' });

    const { noteId, action, motifRejet } = req.body || {};
    if (!noteId) return res.status(400).json({ error: 'Missing noteId' });
    if (!['approuver', 'rejeter', 'rembourser'].includes(action)) {
      return res.status(400).json({ error: 'action doit etre "approuver", "rejeter" ou "rembourser".' });
    }

    const noteRef = db.collection('notesFrais').doc(noteId);
    const noteSnap = await noteRef.get();
    if (!noteSnap.exists) return res.status(404).json({ error: 'Note de frais introuvable.' });
    const note = noteSnap.data();

    const traiteeParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    const patch = {
      traiteePar: decoded.uid,
      traiteeParNom,
      traiteeAt: FieldValue.serverTimestamp()
    };

    if (action === 'approuver') {
      if (note.statut !== 'en-attente') {
        return res.status(400).json({ error: `Statut actuel "${note.statut}" — seules les notes en-attente peuvent etre approuvees.` });
      }
      patch.statut = 'approuvee';
    } else if (action === 'rejeter') {
      const motif = String(motifRejet || '').trim();
      if (motif.length < 3) return res.status(400).json({ error: 'Motif de rejet obligatoire (≥ 3 caracteres).' });
      patch.statut = 'rejetee';
      patch.motifRejet = motif.slice(0, 500);
    } else if (action === 'rembourser') {
      if (!['en-attente', 'approuvee'].includes(note.statut)) {
        return res.status(400).json({ error: `Statut actuel "${note.statut}" — deja remboursee/rejetee.` });
      }
      patch.statut = 'remboursee';
      patch.dateRemboursement = FieldValue.serverTimestamp();

      // Audit comptable : creer une entree dans /depenses (deductible IRS).
      await db.collection('depenses').add({
        type: 'note-frais-essence',
        categorie: 'Carburant vehicule LTD',
        montant: Number(note.montant || 0),
        beneficiaire: note.employeNom || '',
        beneficiaireId: note.employeId || '',
        description: `Remboursement note de frais essence vehicule LTD${note.description ? ' — ' + note.description : ''}`,
        screenshotUrl: note.screenshotUrl || '',
        noteFraisId: noteId,
        par: traiteeParNom,
        parUid: decoded.uid,
        deductible: true,
        timestamp: FieldValue.serverTimestamp()
      });
    }

    await noteRef.set(patch, { merge: true });
    return res.status(200).json({ ok: true, statut: patch.statut });
  } catch (err) {
    console.error('[traiterNoteFrais]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ============================================================
// MODIFICATION / SUPPRESSION DECLARATIONS POMPISTE
// ============================================================
// Le responsable-pompiste (+ direction + DRH) peut corriger ou supprimer
// une declaration de ravitaillement / caoutchoucs. La fonction recalcule
// les impacts : stock station, quota pompiste de la semaine. Audit : la
// declaration n'est jamais hard-deletee, juste marquee supprimee=true.
// ============================================================

function assertRespPompisteOrDir(role) {
  const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
  return isDir || role === 'drh' || role === 'responsable-pompiste';
}

// modifierRavitaillement — change le nb de bidons d'une /redistributions
// existante. Recalcule stockAvant/Apres + diff de quota.
export const modifierRavitaillement = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const { redistributionId, nouveauxBidons } = req.body || {};
    if (!redistributionId) return res.status(400).json({ error: 'Missing redistributionId' });
    const nb = Number(nouveauxBidons);
    if (!Number.isFinite(nb) || nb <= 0) {
      return res.status(400).json({ error: 'nouveauxBidons doit etre un nombre > 0' });
    }

    const ref = db.collection('redistributions').doc(redistributionId);
    const [callerSnap, snap] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      ref.get()
    ]);
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    if (!assertRespPompisteOrDir(caller.role)) {
      return res.status(403).json({ error: 'Direction / DRH / Responsable pompiste uniquement.' });
    }
    if (!snap.exists) return res.status(404).json({ error: 'Redistribution introuvable.' });
    const r = snap.data();
    if (r.supprimee) return res.status(400).json({ error: 'Declaration deja supprimee.' });
    if (r.source !== 'manuel-pompiste') {
      return res.status(400).json({ error: 'Seules les declarations manuelles peuvent etre modifiees ici.' });
    }

    const BIDON_L = 15;
    const bidonsAvant = Number(r.bidons || 0);
    const litresAvant = Number(r.litres || 0);
    const litresApres = nb * BIDON_L;
    const diffLitres = litresApres - litresAvant;
    const diffBidons = nb - bidonsAvant;

    const stRef = db.collection('stations').doc(r.stationId);
    const stSnap = await stRef.get();
    if (stSnap.exists) {
      const station = stSnap.data();
      const stockActuel = Number(station.stockActuel || 0);
      const stockMax = Number(station.stockMax || 0);
      const nouveauStock = stockActuel + diffLitres;
      if (stockMax > 0 && nouveauStock > stockMax) {
        return res.status(400).json({ error: `Correction impossible : la station deborderait (${nouveauStock} L > capacite ${stockMax} L).` });
      }
      if (nouveauStock < 0) {
        return res.status(400).json({ error: `Correction impossible : stockActuel deviendrait negatif (${nouveauStock} L).` });
      }
      await stRef.set({ stockActuel: nouveauStock }, { merge: true });
    }

    await applyQuotaPompisteDelta(r.pompisteId, r.timestamp?.toDate?.(), { bidons: diffBidons });

    const modifParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    await ref.set({
      bidons: nb,
      litres: litresApres,
      modifiePar: decoded.uid,
      modifieParNom: modifParNom,
      modifieAt: FieldValue.serverTimestamp(),
      bidonsAvantModif: bidonsAvant,
      litresAvantModif: litresAvant
    }, { merge: true });

    return res.status(200).json({ ok: true, bidonsAvant, bidonsApres: nb, diffBidons, diffLitres });
  } catch (err) {
    console.error('[modifierRavitaillement]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// supprimerRavitaillement — soft delete. Reverse stock + quota.
export const supprimerRavitaillement = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const { redistributionId, raison } = req.body || {};
    if (!redistributionId) return res.status(400).json({ error: 'Missing redistributionId' });
    const motif = String(raison || '').trim();
    if (motif.length < 3) return res.status(400).json({ error: 'Raison obligatoire (≥ 3 caracteres).' });

    const ref = db.collection('redistributions').doc(redistributionId);
    const [callerSnap, snap] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      ref.get()
    ]);
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    if (!assertRespPompisteOrDir(caller.role)) {
      return res.status(403).json({ error: 'Direction / DRH / Responsable pompiste uniquement.' });
    }
    if (!snap.exists) return res.status(404).json({ error: 'Redistribution introuvable.' });
    const r = snap.data();
    if (r.supprimee) return res.status(400).json({ error: 'Deja supprimee.' });
    if (r.source !== 'manuel-pompiste') {
      return res.status(400).json({ error: 'Seules les declarations manuelles peuvent etre supprimees ici.' });
    }

    const bidons = Number(r.bidons || 0);
    const litres = Number(r.litres || 0);

    const stRef = db.collection('stations').doc(r.stationId);
    const stSnap = await stRef.get();
    if (stSnap.exists) {
      const stockActuel = Number(stSnap.data().stockActuel || 0);
      await stRef.set({ stockActuel: Math.max(0, stockActuel - litres) }, { merge: true });
    }

    await applyQuotaPompisteDelta(r.pompisteId, r.timestamp?.toDate?.(), { bidons: -bidons });

    const supprParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    await ref.set({
      supprimee: true,
      supprimeePar: decoded.uid,
      supprimeeParNom: supprParNom,
      supprimeeAt: FieldValue.serverTimestamp(),
      raisonSuppression: motif.slice(0, 500)
    }, { merge: true });

    return res.status(200).json({ ok: true, bidonsRetires: bidons, litresRetires: litres });
  } catch (err) {
    console.error('[supprimerRavitaillement]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// modifierDeclarationCaoutchoucs — change le nb de caoutchoucs d'un doc.
export const modifierDeclarationCaoutchoucs = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const { declarationId, nouveauxCaoutchoucs } = req.body || {};
    if (!declarationId) return res.status(400).json({ error: 'Missing declarationId' });
    const nb = parseInt(nouveauxCaoutchoucs, 10);
    if (!Number.isFinite(nb) || nb <= 0) {
      return res.status(400).json({ error: 'nouveauxCaoutchoucs doit etre un entier > 0' });
    }

    const ref = db.collection('declarationsCaoutchouc').doc(declarationId);
    const [callerSnap, snap] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      ref.get()
    ]);
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    if (!assertRespPompisteOrDir(caller.role)) {
      return res.status(403).json({ error: 'Direction / DRH / Responsable pompiste uniquement.' });
    }
    if (!snap.exists) return res.status(404).json({ error: 'Declaration introuvable.' });
    const d = snap.data();
    if (d.supprimee) return res.status(400).json({ error: 'Deja supprimee.' });

    const avant = Number(d.caoutchoucs || 0);
    const diff = nb - avant;

    await applyQuotaPompisteDelta(d.pompisteId, d.timestamp?.toDate?.(), { caoutchoucs: diff });

    const modifParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    await ref.set({
      caoutchoucs: nb,
      modifiePar: decoded.uid,
      modifieParNom: modifParNom,
      modifieAt: FieldValue.serverTimestamp(),
      caoutchoucsAvantModif: avant
    }, { merge: true });

    return res.status(200).json({ ok: true, avant, apres: nb, diff });
  } catch (err) {
    console.error('[modifierDeclarationCaoutchoucs]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// supprimerDeclarationCaoutchoucs — soft delete + reverse quota.
export const supprimerDeclarationCaoutchoucs = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const { declarationId, raison } = req.body || {};
    if (!declarationId) return res.status(400).json({ error: 'Missing declarationId' });
    const motif = String(raison || '').trim();
    if (motif.length < 3) return res.status(400).json({ error: 'Raison obligatoire (≥ 3 caracteres).' });

    const ref = db.collection('declarationsCaoutchouc').doc(declarationId);
    const [callerSnap, snap] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      ref.get()
    ]);
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    if (!assertRespPompisteOrDir(caller.role)) {
      return res.status(403).json({ error: 'Direction / DRH / Responsable pompiste uniquement.' });
    }
    if (!snap.exists) return res.status(404).json({ error: 'Declaration introuvable.' });
    const d = snap.data();
    if (d.supprimee) return res.status(400).json({ error: 'Deja supprimee.' });

    const nb = Number(d.caoutchoucs || 0);
    await applyQuotaPompisteDelta(d.pompisteId, d.timestamp?.toDate?.(), { caoutchoucs: -nb });

    const supprParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    await ref.set({
      supprimee: true,
      supprimeePar: decoded.uid,
      supprimeeParNom: supprParNom,
      supprimeeAt: FieldValue.serverTimestamp(),
      raisonSuppression: motif.slice(0, 500)
    }, { merge: true });

    return res.status(200).json({ ok: true, caoutchoucsRetires: nb });
  } catch (err) {
    console.error('[supprimerDeclarationCaoutchoucs]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// declarerVente — Employe declare une vente manuelle sur le site.
// ----------------------------------------------------------------
// Source de verite cote serveur :
//   - prixAchat resolu depuis /produits/{id} (l'employe ne peut pas le faker)
//   - benefice = montantEncaisse - coutTotal (calcul serveur)
//   - factureId genere serveur (format "M{YYYYMMDD}-{NNNN}")
//   - Decrement /stocks/{produitId} en transaction atomique
//   - Reconcile /sorties_en_cours en_attente (anti-vol 30min)
// La vente est verrouillee cote employe (verrouille=true). Modification
// reservee aux roles canAdmin/respVente/DRH via modifierVente.
// ----------------------------------------------------------------
export const declarerVente = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    if ((caller.statut || 'actif') !== 'actif') {
      return res.status(403).json({ error: 'Compte non actif.' });
    }
    const role = caller.role || '';
    const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
    if (!isDir && (caller.avertsActifs || 0) >= 3) {
      return res.status(403).json({ error: 'Compte bloque (3 avertissements actifs). Contacte la direction.' });
    }

    const { clientNom, moyenPaiement, montantEncaisse, lignes, factureBotId } = req.body || {};
    if (!Array.isArray(lignes) || lignes.length === 0) {
      return res.status(400).json({ error: 'Ajoute au moins une ligne de produit' });
    }
    if (lignes.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 lignes par vente' });
    }

    // === Anti-fraude : la declaration manuelle DOIT correspondre a une vente
    // bot Discord existante (la facture in-game qui prouve la realite de la
    // transaction). Sans cela, un vendeur pourrait inventer des factures.
    // Exception : direction/admin-technique/responsable-vente peuvent declarer
    // sans reference (pour saisie de regularisation/correction).
    const peutDeclarerSansBot = isDir || role === 'drh' || role === 'responsable-vente';
    let venteBotData = null;
    let venteBotRef = null;
    if (!peutDeclarerSansBot) {
      if (!factureBotId) {
        return res.status(400).json({
          error: 'Pour declarer une vente, tu dois selectionner la facture in-game correspondante. Si tu n\'as pas encore fait la facture en jeu, fais-la d\'abord puis reviens ici.'
        });
      }
      venteBotRef = db.collection('ventes').doc(String(factureBotId));
      const botSnap = await venteBotRef.get();
      if (!botSnap.exists) {
        return res.status(400).json({ error: 'Facture in-game introuvable. Verifie qu\'elle est bien remontee.' });
      }
      venteBotData = botSnap.data();
      if (venteBotData.source === 'manuelle') {
        return res.status(400).json({ error: 'Cette facture est deja une declaration manuelle.' });
      }
      if (venteBotData.vendeurId && venteBotData.vendeurId !== decoded.uid) {
        return res.status(403).json({ error: 'Cette facture n\'est pas la tienne.' });
      }
      if (venteBotData.cachee) {
        return res.status(400).json({ error: 'Cette facture a deja ete declaree.' });
      }
      // Fenetre temporelle : facture in-game doit dater de moins de 24h
      const botTs = venteBotData.timestamp?.toDate?.() || new Date(0);
      const ageHeures = (Date.now() - botTs.getTime()) / 3600000;
      if (ageHeures > 24) {
        return res.status(400).json({ error: `Cette facture in-game a plus de 24h (${Math.round(ageHeures)}h). Trop ancien pour la declarer maintenant — contacte la direction.` });
      }
    }

    // Resolution des produits + calcul serveur (anti-fraude).
    // Le montant peut etre fourni (admin) ou calcule auto depuis prixVente
    // du catalogue (cas declaration employe : tout vient du serveur).
    // pourPro est snapshote sur la ligne pour figer le statut au moment de la vente
    // (si le patron rebascule le produit en particulier plus tard, ca ne reecrit pas
    // l'historique).
    const lignesResolues = [];
    let coutTotal = 0;
    let prixVenteTotal = 0;
    let prixVenteTotalParticulier = 0;
    for (const l of lignes) {
      const pid = String(l.produitId || '').trim();
      const qte = Number(l.quantite);
      if (!pid) return res.status(400).json({ error: 'produitId manquant dans une ligne' });
      if (!Number.isFinite(qte) || qte <= 0 || !Number.isInteger(qte)) {
        return res.status(400).json({ error: `Quantite invalide pour ${pid}` });
      }
      const prodSnap = await db.collection('produits').doc(pid).get();
      if (!prodSnap.exists) return res.status(400).json({ error: `Produit inconnu : ${pid}` });
      const prod = prodSnap.data();
      const prixAchat = Number(prod.prixAchat || 0);
      const prixVente = Number(prod.prixVente || 0);
      const pourPro   = !!prod.pourPro;
      lignesResolues.push({
        produitId: pid,
        produitNom: prod.nom || pid,
        quantite: qte,
        prixAchat,
        prixVente,
        pourPro
      });
      coutTotal += qte * prixAchat;
      prixVenteTotal += qte * prixVente;
      if (!pourPro) prixVenteTotalParticulier += qte * prixVente;
    }
    // Si montantEncaisse non fourni, on prend le total prix de vente catalogue.
    const montantFourni = Number(montantEncaisse);
    const montant = Number.isFinite(montantFourni) && montantFourni > 0
      ? montantFourni
      : prixVenteTotal;
    if (montant <= 0) {
      return res.status(400).json({ error: 'Montant total nul (verifie les prix de vente du catalogue).' });
    }
    const benefice = montant - coutTotal;

    // Anti-fraude : si on est lie a une vente bot, le montant declare DOIT
    // matcher exactement le montant facture in-game (tolerance 0.01 \$ pour
    // arrondis flottants).
    if (venteBotData) {
      const montantBot = Number(venteBotData.montant || 0);
      if (Math.abs(montant - montantBot) > 0.01) {
        return res.status(400).json({
          error: `Le montant declare (${montant} \$) ne correspond pas au montant de la facture in-game (${montantBot} \$). Verifie tes produits/quantites.`
        });
      }
    }
    // Part particulier (commissionnable) : pro-rata si l'admin a saisi un montant
    // total different du prix catalogue (rabais, remise, etc.).
    const montantParticulier = prixVenteTotal > 0
      ? Math.round((prixVenteTotalParticulier / prixVenteTotal) * montant * 100) / 100
      : 0;

    // factureId genere serveur : M{YYYYMMDD}-{NNNN} (4 chiffres seq jour)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const cntRef = db.collection('counters').doc(`ventes-manuelles-${dateStr}`);
    let factureId;
    await db.runTransaction(async (tx) => {
      const cnt = await tx.get(cntRef);
      const next = (cnt.exists ? (cnt.data().value || 0) : 0) + 1;
      tx.set(cntRef, { value: next }, { merge: true });
      factureId = `M${dateStr}-${String(next).padStart(4, '0')}`;
    });

    const vendeurNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();
    const docId = `man-${factureId}`;

    // Transaction atomique : creation /ventes + decrement /stocks pour chaque ligne
    // + cachage de la vente bot liee (si applicable). Tout en une fois pour
    // garantir la coherence.
    await db.runTransaction(async (tx) => {
      const stockRefs = lignesResolues.map(l => db.collection('stocks').doc(l.produitId));
      const stockSnaps = await Promise.all(stockRefs.map(r => tx.get(r)));
      const venteRef = db.collection('ventes').doc(docId);

      stockSnaps.forEach((s, i) => {
        const l = lignesResolues[i];
        const cur = s.exists ? Number(s.data().quantite || 0) : 0;
        tx.set(stockRefs[i], {
          quantite: cur - l.quantite,
          nom: s.exists ? (s.data().nom || l.produitNom) : l.produitNom,
          derniereMaj: FieldValue.serverTimestamp(),
          par: vendeurNom + ' (vente)'
        }, { merge: true });
      });

      tx.set(venteRef, {
        factureId,
        source: 'manuelle',
        vendeurId: decoded.uid,
        vendeurNom,
        client: String(clientNom || 'Client comptoir').trim(),
        paiement: String(moyenPaiement || 'especes').trim(),
        montant,
        montantParticulier,
        coutTotal,
        benefice,
        lignes: lignesResolues,
        items: lignesResolues.map(l => ({ id: l.produitId, nom: l.produitNom, quantite: l.quantite })),
        verrouille: true,
        modifiePar: null,
        modifieParNom: null,
        motifModification: null,
        dateModification: null,
        factureBotId: factureBotId || null,
        factureBotRef: venteBotData?.factureId || null,
        timestamp: FieldValue.serverTimestamp()
      });

      // Marque la vente bot comme cachee (atomique : pas de doublon visible)
      if (venteBotRef) {
        tx.update(venteBotRef, {
          cachee: true,
          remplaceeParId: docId,
          remplaceeParFactureId: factureId,
          dateCachage: FieldValue.serverTimestamp()
        });
      }
    });

    // Audit /mouvementsStock (hors transaction, append-only)
    for (const l of lignesResolues) {
      await db.collection('mouvementsStock').add({
        type: 'vente-manuelle',
        item: l.produitId,
        itemNom: l.produitNom,
        quantite: -l.quantite,
        par: vendeurNom,
        parUid: decoded.uid,
        source: `vente:${factureId}`,
        timestamp: FieldValue.serverTimestamp()
      });
    }

    // Reconcile /sorties_en_cours : marque vendu les sorties recentes de cet
    // employe sur ces produits (anti-vol 30min). Best effort, non bloquant.
    try {
      await reconcileSortiesAvecVente(decoded.uid, lignesResolues, factureId);
    } catch (e) {
      console.error('[declarerVente] reconcile error', e);
    }

    // Note : la vente bot liee est marquee `cachee=true` atomiquement dans la
    // transaction ci-dessus (plus de "best-effort post-creation").

    return res.status(200).json({ ok: true, factureId, coutTotal, benefice, montant, montantParticulier });
  } catch (err) {
    console.error('[declarerVente]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// Marque comme "vendu" les sorties_en_cours en_attente de cet employe qui
// correspondent aux lignes vendues (meme produitId, dans la limite des
// quantites). Best-effort : on ne refuse pas la vente si reconcile foire.
async function reconcileSortiesAvecVente(employeId, lignes, factureId) {
  const qParProduit = {};
  for (const l of lignes) qParProduit[l.produitId] = (qParProduit[l.produitId] || 0) + l.quantite;

  for (const [pid, qteRestante] of Object.entries(qParProduit)) {
    let q = qteRestante;
    const snap = await db.collection('sorties_en_cours')
      .where('employeId', '==', employeId)
      .where('produitId', '==', pid)
      .where('statut', '==', 'en_attente')
      .orderBy('dateSortie', 'asc')
      .get();
    for (const d of snap.docs) {
      if (q <= 0) break;
      const data = d.data();
      const qSortie = Number(data.quantite || 0);
      if (q >= qSortie) {
        await d.ref.update({
          statut: 'vendu',
          factureId,
          dateReconcile: FieldValue.serverTimestamp()
        });
        q -= qSortie;
      } else {
        // Vente partielle : on splitte logiquement (decrement quantite, garde le doc)
        await d.ref.update({ quantite: qSortie - q });
        q = 0;
      }
    }
  }
}

// ----------------------------------------------------------------
// modifierVente — Admin (canAdmin/respVente/DRH) modifie une vente.
// ----------------------------------------------------------------
// L'employe ne peut PAS modifier ses propres ventes (verrouille=true).
// Recalcul serveur du benefice. Trace modifiePar + motifModification.
// Si lignes changent, reajuste /stocks (delta entre ancien et nouveau).
// ----------------------------------------------------------------
export const modifierVente = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    const allowed = role === 'patron' || role === 'co-patron' || role === 'admin-technique'
                 || role === 'drh' || role === 'responsable-vente';
    if (!allowed) return res.status(403).json({ error: 'Seuls la direction, le DRH et le responsable vente peuvent modifier une vente.' });

    const { venteId, clientNom, moyenPaiement, montantEncaisse, lignes, motifModification } = req.body || {};
    if (!venteId) return res.status(400).json({ error: 'venteId manquant' });
    if (!motifModification || !String(motifModification).trim()) {
      return res.status(400).json({ error: 'Motif de modification obligatoire' });
    }
    const montant = Number(montantEncaisse);
    if (!Number.isFinite(montant) || montant <= 0) return res.status(400).json({ error: 'montantEncaisse invalide' });
    if (!Array.isArray(lignes) || lignes.length === 0) return res.status(400).json({ error: 'lignes manquantes' });

    const venteRef = db.collection('ventes').doc(venteId);
    const venteSnap = await venteRef.get();
    if (!venteSnap.exists) return res.status(404).json({ error: 'Vente introuvable' });
    const ancienne = venteSnap.data();

    // Resolution + recalcul serveur
    const lignesResolues = [];
    let coutTotal = 0;
    let prixVenteTotal = 0;
    let prixVenteTotalParticulier = 0;
    for (const l of lignes) {
      const pid = String(l.produitId || '').trim();
      const qte = Number(l.quantite);
      if (!pid) return res.status(400).json({ error: 'produitId manquant dans une ligne' });
      if (!Number.isFinite(qte) || qte <= 0 || !Number.isInteger(qte)) {
        return res.status(400).json({ error: `Quantite invalide pour ${pid}` });
      }
      const prodSnap = await db.collection('produits').doc(pid).get();
      if (!prodSnap.exists) return res.status(400).json({ error: `Produit inconnu : ${pid}` });
      const prod = prodSnap.data();
      const prixAchat = Number(prod.prixAchat || 0);
      const prixVente = Number(prod.prixVente || 0);
      const pourPro   = !!prod.pourPro;
      lignesResolues.push({ produitId: pid, produitNom: prod.nom || pid, quantite: qte, prixAchat, prixVente, pourPro });
      coutTotal += qte * prixAchat;
      prixVenteTotal += qte * prixVente;
      if (!pourPro) prixVenteTotalParticulier += qte * prixVente;
    }
    const benefice = montant - coutTotal;
    const montantParticulier = prixVenteTotal > 0
      ? Math.round((prixVenteTotalParticulier / prixVenteTotal) * montant * 100) / 100
      : 0;

    // Delta stock = ancien - nouveau (positif si on annule du stock sorti)
    const deltaParProduit = {};
    for (const l of (ancienne.lignes || [])) deltaParProduit[l.produitId] = (deltaParProduit[l.produitId] || 0) + Number(l.quantite || 0);
    for (const l of lignesResolues) deltaParProduit[l.produitId] = (deltaParProduit[l.produitId] || 0) - l.quantite;

    const modifieParNom = `${caller.prenom || ''} ${caller.nom || ''}`.trim();

    await db.runTransaction(async (tx) => {
      // 1) PHASE LECTURES : on lit tous les stocks d'abord (Firestore exige
      //    toutes les reads avant toutes les writes dans une transaction).
      const deltaEntries = Object.entries(deltaParProduit).filter(([, d]) => d !== 0);
      const stockRefs = deltaEntries.map(([pid]) => db.collection('stocks').doc(pid));
      const stockSnaps = await Promise.all(stockRefs.map(r => tx.get(r)));

      // 2) PHASE ECRITURES : on update tous les stocks puis la vente.
      deltaEntries.forEach(([pid, delta], i) => {
        const sSnap = stockSnaps[i];
        const cur = sSnap.exists ? Number(sSnap.data().quantite || 0) : 0;
        tx.set(stockRefs[i], {
          quantite: cur + delta,
          derniereMaj: FieldValue.serverTimestamp(),
          par: `${modifieParNom} (modif vente ${ancienne.factureId || venteId})`
        }, { merge: true });
      });
      tx.set(venteRef, {
        client: String(clientNom || ancienne.client || '').trim(),
        paiement: String(moyenPaiement || ancienne.paiement || '').trim(),
        montant,
        montantParticulier,
        coutTotal,
        benefice,
        lignes: lignesResolues,
        items: lignesResolues.map(l => ({ id: l.produitId, nom: l.produitNom, quantite: l.quantite })),
        modifiePar: decoded.uid,
        modifieParNom,
        motifModification: String(motifModification).trim(),
        dateModification: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // Audit append-only
    await db.collection('mouvementsStock').add({
      type: 'modification-vente',
      par: modifieParNom,
      parUid: decoded.uid,
      source: `modif:${ancienne.factureId || venteId}`,
      motif: String(motifModification).trim(),
      ancienMontant: ancienne.montant || 0,
      nouveauMontant: montant,
      timestamp: FieldValue.serverTimestamp()
    });

    return res.status(200).json({ ok: true, coutTotal, benefice, montant });
  } catch (err) {
    console.error('[modifierVente]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});

// ----------------------------------------------------------------
// onMouvementStockCreated — Tracker sorties pour anti-vol 30min.
// ----------------------------------------------------------------
// Quand un employe sort un item d'un coffre LTD (type=inventory-remove +
// source=action-XXXXX matching SOURCES_LTD_PREFIXES), on cree un doc
// /sorties_en_cours/{auto}. 3 issues :
//   A) L'employe declare une vente avec ce produit  -> statut=vendu
//   B) Il redepose le produit dans le coffre        -> statut=depose
//   C) Au bout de 30min                              -> statut=alerte + notif
//
// Branche aussi sur inventory-add (cas B) : si l'employe redepose, marque
// les sorties en_attente correspondantes comme "depose".
// ----------------------------------------------------------------
const SOURCES_LTD_PREFIXES_FN = ['action-27310', 'action-27166', 'action-30439'];
function isLTDCoffreSource(source) {
  if (!source) return false;
  return SOURCES_LTD_PREFIXES_FN.some(p => String(source).startsWith(p));
}

export const onMouvementStockCreated = onDocumentCreated({
  document: 'mouvementsStock/{id}',
  region: 'europe-west1'
}, async (event) => {
  const m = event.data?.data();
  if (!m) return;
  const type = m.type;
  if (type !== 'inventory-remove' && type !== 'inventory-add') return;
  // Identifie coffre LTD via source ou owner
  if (!isLTDCoffreSource(m.source) && !isLTDCoffreSource(m.owner)) return;

  // Resoud l'employe : par parUid si fourni, sinon resolveEmployeeIdByName(par)
  let employeId = m.parUid || null;
  if (!employeId && m.par) employeId = await resolveEmployeeIdByName(m.par);
  if (!employeId) return;

  const uSnap = await db.collection('users').doc(employeId).get();
  if (!uSnap.exists) return;
  const u = uSnap.data();
  const role = u.role || '';
  const isDir = role === 'patron' || role === 'co-patron' || role === 'admin-technique';
  if (isDir) return; // direction non surveillee

  const employeNom = `${u.prenom || ''} ${u.nom || ''}`.trim();
  const produitId = m.item;
  const produitNom = m.itemNom || produitId;
  const quantite = Math.abs(Number(m.quantite || 0));
  if (!produitId || quantite <= 0) return;

  if (type === 'inventory-remove') {
    // Cree une sortie en_attente
    await db.collection('sorties_en_cours').add({
      employeId,
      employeNom,
      produitId,
      produitNom,
      quantite,
      dateSortie: FieldValue.serverTimestamp(),
      statut: 'en_attente',
      source: m.source || ''
    });
  } else if (type === 'inventory-add') {
    // Reconcile : marque "depose" les sorties en_attente correspondantes
    let qRestant = quantite;
    const snap = await db.collection('sorties_en_cours')
      .where('employeId', '==', employeId)
      .where('produitId', '==', produitId)
      .where('statut', '==', 'en_attente')
      .orderBy('dateSortie', 'asc')
      .get();
    for (const d of snap.docs) {
      if (qRestant <= 0) break;
      const data = d.data();
      const qSortie = Number(data.quantite || 0);
      if (qRestant >= qSortie) {
        await d.ref.update({ statut: 'depose', dateReconcile: FieldValue.serverTimestamp() });
        qRestant -= qSortie;
      } else {
        await d.ref.update({ quantite: qSortie - qRestant });
        qRestant = 0;
      }
    }
  }
});

// ----------------------------------------------------------------
// verifierSortiesExpirees — Cron toutes les 5 min : detecte > 30min en_attente
// ----------------------------------------------------------------
// Cree 1 alerte /alertes par sortie expiree + envoie webhook Discord vers
// la direction si configure (config.global.webhookAntiVol).
// Marque la sortie statut='alerte' pour eviter de re-alerter.
// ----------------------------------------------------------------
export const verifierSortiesExpirees = onSchedule({
  schedule: '*/5 * * * *',
  timeZone: 'Europe/Paris',
  region: 'europe-west1'
}, async () => {
  const limit = new Date(Date.now() - 30 * 60 * 1000);
  const snap = await db.collection('sorties_en_cours')
    .where('statut', '==', 'en_attente')
    .where('dateSortie', '<=', Timestamp.fromDate(limit))
    .get();
  if (snap.empty) return;

  const cfg = (await db.collection('config').doc('global').get()).data() || {};
  const webhook = cfg.webhookAntiVol || cfg.webhookAlertes || '';

  for (const d of snap.docs) {
    const s = d.data();
    const ds = s.dateSortie?.toDate ? s.dateSortie.toDate() : new Date();
    const minutes = Math.round((Date.now() - ds.getTime()) / 60000);
    const msg = `🚨 ${s.employeNom} a sorti ${s.produitNom} x${s.quantite} il y a ${minutes} min sans declaration de vente ni depot en coffre.`;

    await db.collection('alertes').add({
      type: 'sortie-non-regularisee',
      message: msg,
      gravite: 'danger',
      metadata: {
        sortieId: d.id,
        employeId: s.employeId,
        employeNom: s.employeNom,
        produitId: s.produitId,
        produitNom: s.produitNom,
        quantite: s.quantite,
        dateSortie: s.dateSortie
      },
      resolue: false,
      timestamp: FieldValue.serverTimestamp()
    });
    await d.ref.update({ statut: 'alerte', dateAlerte: FieldValue.serverTimestamp() });

    if (webhook) {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: msg,
            username: 'LTD Anti-vol',
            allowed_mentions: { parse: ['users', 'roles'] }
          })
        });
      } catch (e) {
        console.error('[verifierSortiesExpirees] webhook err', e);
      }
    }
  }
  console.log(`[anti-vol] ${snap.size} sortie(s) expirees -> alertes crees`);
});

// ----------------------------------------------------------------
// archiveAncienMouvementsBanque (cron hebdo dim 03:00 Europe/Paris)
//
// Reduit la taille des collections actives /banqueLtd et /depenses en
// deplacant vers /banqueLtdArchive et /depensesArchive tous les docs
// dont le timestamp est > 6 semaines. Permet aux queries /banque.html
// de rester legeres (et au limit(10000) cote front d'avoir une marge
// confortable) sans perte de donnees : les archives restent queryables
// par scripts admin pour audit IRS.
//
// Strategie :
//   1. Calcul cutoff = now - 6 semaines (timestamp Firestore)
//   2. Pour chaque collection (banqueLtd, depenses) :
//      - Query batch de 400 docs ou timestamp < cutoff
//      - Pour chaque batch : copie vers <coll>Archive (meme id) + delete
//        de la collection source, le tout en un writeBatch atomique
//      - Repete jusqu'a epuisement (la fonction est bornee a 9 min)
//   3. Log stats
//
// Edge case : si une exception interrompt entre copie et delete, le doc
// est dupplique (visible dans les 2 collections). On accepte ce risque
// (faible) car les 2 collections ont meme schema et la prochaine
// execution corrigera (delete idempotent).
// ----------------------------------------------------------------
export const archiveAncienMouvementsBanque = onSchedule({
  schedule: '0 3 * * 0',         // dimanche 03:00 Europe/Paris
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
  timeoutSeconds: 540,           // 9 min, max pour scheduled functions
  memory: '512MiB'
}, async () => {
  const SEMAINES_RETENTION = 6;
  const cutoffMs = Date.now() - SEMAINES_RETENTION * 7 * 24 * 60 * 60 * 1000;
  const cutoff = Timestamp.fromMillis(cutoffMs);
  const BATCH_SIZE = 400;        // marge sous la limite Firestore (500 ops)

  async function archiverCollection(source, dest) {
    let totalArchive = 0;
    let totalScanne = 0;
    // Boucle jusqu'a ne plus trouver de doc < cutoff
    while (true) {
      const snap = await db.collection(source)
        .where('timestamp', '<', cutoff)
        .orderBy('timestamp', 'asc')
        .limit(BATCH_SIZE)
        .get();
      if (snap.empty) break;
      totalScanne += snap.size;

      const batch = db.batch();
      for (const d of snap.docs) {
        const data = d.data();
        // Copie vers archive avec metadata d'archivage (audit)
        batch.set(db.collection(dest).doc(d.id), {
          ...data,
          archivedAt: FieldValue.serverTimestamp(),
          archivedFromCollection: source
        });
        batch.delete(d.ref);
      }
      await batch.commit();
      totalArchive += snap.size;

      // Si le batch n'etait pas plein, on a tout traite
      if (snap.size < BATCH_SIZE) break;
    }
    return { totalArchive, totalScanne };
  }

  try {
    const t0 = Date.now();
    const [bq, dp] = await Promise.all([
      archiverCollection('banqueLtd', 'banqueLtdArchive'),
      archiverCollection('depenses', 'depensesArchive')
    ]);
    const dureeS = Math.round((Date.now() - t0) / 1000);
    console.log(`[archive] cutoff=${cutoff.toDate().toISOString()} (${SEMAINES_RETENTION} sem) — ` +
      `banqueLtd : ${bq.totalArchive} archives — ` +
      `depenses : ${dp.totalArchive} archives — duree ${dureeS}s`);
  } catch (e) {
    console.error('[archive] error', e);
    throw e; // re-throw pour que Cloud Scheduler retente
  }
});

export const comptaExport = onRequest({
  region: 'europe-west1',
  cors: true,                  // Sheets fait des requêtes cross-origin
  invoker: 'public',           // accès public, sécurité par token
  secrets: [COMPTA_TOKEN]
}, async (req, res) => {
  // Auth via query param
  const token = req.query.token;
  if (!token || token !== COMPTA_TOKEN.value()) {
    return res.status(401).type('text/plain').send('Unauthorized');
  }

  const type = (req.query.type || 'resume').toString();

  // v1.7.8 (2026-05-24) — Param optionnel `?semaine=YYYY-Wnn` (alias `?week=`).
  // Si fourni, les endpoints filtrent sur cette semaine ISO (lun→dim Paris)
  // au lieu de la semaine RP courante. Necessaire pour les snapshots BLA
  // d'audit historique (sinon les sections ventes/dep/paies du PDF S20
  // generent vides car le filtre weekRangeRPParis pointe sur S21).
  const semaineArg = req.query.semaine || req.query.week || null;
  const bounds = semaineArg ? weekRangeFromIso(semaineArg) : null;
  if (semaineArg && !bounds) {
    return res.status(400).type('text/plain').send(
      'Param semaine invalide. Format attendu : YYYY-Wnn (ex: 2026-W20).');
  }

  // Headers utiles pour Sheets
  res.set('Cache-Control', 'no-cache, max-age=0');
  res.type('text/csv; charset=utf-8');

  try {
    // Précharge le map idDiscord -> nom (utilisé pour résoudre les <@xxx>)
    // Sauf pour "resume" qui n'en a pas besoin (perf).
    const usersByDiscord = (type === 'resume') ? {} : await loadUsersByDiscordMap();

    let csv;
    switch (type) {
      // 'resume' retire en v1.7.0 : les semaines closes ont leur onglet
      // snapshot dedie (recap + section paies avec ID Discord). On garde
      // l'endpoint commente au cas ou besoin de re-export ad-hoc.
      // case 'resume':   csv = await csvResume();   break;
      case 'depenses':  csv = await csvDepenses(usersByDiscord, bounds); break;
      case 'ventes':    csv = await csvVentes(usersByDiscord, bounds);   break;
      case 'banque':    csv = await csvBanque(bounds);   break;
      case 'carburant': csv = await csvCarburant(bounds); break;
      // 'paies' reintroduit en v1.7.2 : BLA Corporate a besoin de la masse
      // salariale reelle pour le JSON IRS (les paies ne sont PAS dupliquees
      // dans /depenses : clotureHebdo filtre type='paie' explicitement).
      case 'paies':     csv = await csvPaies(usersByDiscord, bounds); break;
      // v1.7.5 (2026-05-24) : nouveau endpoint demande par BLA Corporate.
      // Expose la MASSE SALARIALE ESTIMEE pour la semaine RP en cours, par
      // employe, en repliquant `calculerPaieEstimee` cote backend. Utile pour
      // le portail client AVANT que le patron fasse les paies lundi 00h-02h :
      // permet de calculer le JSON IRS et le bilan avec la masse salariale
      // PREVISIONNELLE (et non pas "0" parce que aucune ligne /paies n'existe
      // encore). Alias accepte : 'paies-estimees'.
      case 'masse-salariale-estimee':
      case 'paies-estimees':
        csv = await csvMasseSalarialeEstimee(usersByDiscord, bounds);
        break;
      // v1.7.7 (2026-05-24) : endpoint demande par BLA Corporate pour la
      // section "Archives" du portail client. Liste les 20 dernieres semaines
      // cloturees (docs /semaines), avec leurs KPI resumes : CA produits +
      // carburant, depenses, masse salariale, benefice net, statut. Permet
      // au patron d'auditer les semaines passees en 1 click + telecharger un
      // snapshot PDF par semaine via la Cloud Function generateSnapshotPdf
      // (qui accepte deja ?semaine=YYYY-Wnn). Tri par dateDebut desc.
      case 'semaines-fermees':
      case 'semaines':
        csv = await csvSemainesFermees();
        break;
      default:
        return res.status(400).type('text/plain').send(
          'Type inconnu. Utilise ?type=depenses | ventes | banque | carburant | paies | masse-salariale-estimee | semaines-fermees (resume retire en v1.7.0)');
    }
    // BOM UTF-8 pour qu'Excel/Sheets gèrent les accents
    res.send('﻿' + csv);
  } catch (err) {
    console.error('comptaExport error', type, err);
    res.status(500).type('text/plain').send('Erreur : ' + err.message);
  }
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(...cells) {
  return cells.map(csvEscape).join(',');
}
// Format ISO `yyyy-MM-dd HH:mm:ss` (Europe/Paris) : reconnu par Google Sheets
// comme un VRAI datetime, ce qui permet d'appliquer numberFormat date côté
// Sheet (script format-sheet.js) → affichage `dd/MM/yyyy HH:mm:ss` + tri/filtres
// date intelligents.
function pad(n) { return String(n).padStart(2, '0'); }
function tsToDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return isNaN(d.getTime()) ? null : d;
}
function dateIso(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  const fr = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (t) => fr.find(p => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
function dateOnly(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  const fr = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const get = (t) => fr.find(p => p.type === t)?.value || '00';
  // Format yyyy-MM-dd reste trié alphabétiquement et est lisible
  return `${get('year')}-${get('month')}-${get('day')}`;
}
// Helpers timezone Paris (extraits du handler cloturerSemaine pour reuse global).
// toParisWall : prend un Date UTC, retourne un Date dont les composantes UTC
// representent l'horloge Paris ("YYYY-MM-DDThh:mm:ssZ" mais lu comme Paris).
function toParisWall(d) {
  const s = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false });
  return new Date(s.replace(' ', 'T') + 'Z');
}
function parisWallToUtcGlobal(parisWall) {
  let utc = new Date(parisWall.getTime() - 60 * 60 * 1000);
  for (let i = 0; i < 3; i++) {
    const wall = toParisWall(utc);
    const drift = parisWall.getTime() - wall.getTime();
    if (Math.abs(drift) < 1000) break;
    utc = new Date(utc.getTime() + drift);
  }
  return utc;
}
// Retourne { debut, fin } UTC pour la semaine RP courante (lun 00:00 Paris -> dim 23:59:59.999 Paris).
function weekRangeRPParis(ref) {
  const nowParis = toParisWall(ref || new Date());
  const dayParis = nowParis.getUTCDay(); // 0=dim, 1=lun
  const diff = dayParis === 0 ? 6 : dayParis - 1;
  const lundiWall = new Date(nowParis);
  lundiWall.setUTCDate(lundiWall.getUTCDate() - diff);
  lundiWall.setUTCHours(0, 0, 0, 0);
  const dimancheWall = new Date(lundiWall);
  dimancheWall.setUTCDate(dimancheWall.getUTCDate() + 6);
  dimancheWall.setUTCHours(23, 59, 59, 999);
  // weekKey = lundi en horloge Paris. IMPORTANT : on lit les champs UTC du
  // *wall* (lundiWall), JAMAIS getFullYear/getMonth/getDate sur le Date global
  // retourne : sur serveur UTC en CEST, lundi 00h Paris = dim 22h UTC, donc les
  // getters locaux retombent sur le dimanche -> weekKey decale d'un jour (bug
  // onglets live numerotes S-1 + plage demarrant le dimanche). Cf weekRangeFromIso.
  const weekKey = `${lundiWall.getUTCFullYear()}-${pad(lundiWall.getUTCMonth() + 1)}-${pad(lundiWall.getUTCDate())}`;
  return { debut: parisWallToUtcGlobal(lundiWall), fin: parisWallToUtcGlobal(dimancheWall), weekKey };
}

// v1.7.8 (2026-05-24) — Helper "ISO week → bornes UTC en Europe/Paris".
// Accepte `YYYY-Wnn` (ex: '2026-W20'). Retourne { debut, fin } UTC equivalents
// au lundi 00h00 Paris et dimanche 23h59:59.999 Paris.
//
// Utilise par comptaExport pour permettre aux portails clients (BLA Corporate)
// de demander un snapshot d'une semaine RP passee. Sans ce param, les endpoints
// csv* filtrent sur la semaine RP COURANTE (weekRangeRPParis) ce qui rend les
// snapshots historiques (S20, S19...) vides.
function weekRangeFromIso(yearWeek) {
  if (!yearWeek) return null;
  const match = /^(\d{4})-W(\d{1,2})$/i.exec(String(yearWeek).trim());
  if (!match) return null;
  const year = +match[1];
  const week = +match[2];
  if (!year || !week || week < 1 || week > 53) return null;

  // ISO 8601 : la semaine 1 est celle qui contient le 4 janvier.
  // On calcule le lundi de la semaine 1, puis on ajoute (week - 1) * 7 jours.
  // IMPORTANT : on raisonne en horloge Paris (toParisWall) pour que le lundi
  // 00h00 soit le bon, peu importe le DST. Symetrique a weekRangeRPParis.
  const jan4Utc = new Date(Date.UTC(year, 0, 4, 12, 0, 0)); // midi UTC pour eviter pb DST
  const jan4Paris = toParisWall(jan4Utc);
  const jan4Day = jan4Paris.getUTCDay() || 7; // 1=lun..7=dim
  const week1MondayParis = new Date(jan4Paris);
  week1MondayParis.setUTCDate(week1MondayParis.getUTCDate() - (jan4Day - 1));
  week1MondayParis.setUTCHours(0, 0, 0, 0);

  const lundiWall = new Date(week1MondayParis);
  lundiWall.setUTCDate(lundiWall.getUTCDate() + (week - 1) * 7);
  lundiWall.setUTCHours(0, 0, 0, 0);

  const dimancheWall = new Date(lundiWall);
  dimancheWall.setUTCDate(dimancheWall.getUTCDate() + 6);
  dimancheWall.setUTCHours(23, 59, 59, 999);

  return {
    debut: parisWallToUtcGlobal(lundiWall),
    fin: parisWallToUtcGlobal(dimancheWall),
    weekKey: `${lundiWall.getUTCFullYear()}-${pad(lundiWall.getUTCMonth() + 1)}-${pad(lundiWall.getUTCDate())}`
  };
}

// Numéro ISO 8601 de semaine (1-53) + label "S20 2026". weekKey = YYYY-MM-DD du lundi.
// Dupliqué côté frontend dans public/js/utils/formatters.js (any change must mirror).
function weekIsoNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
function weekIsoLabel(weekKey) {
  if (!weekKey) return '';
  const lundi = new Date(String(weekKey) + 'T00:00:00');
  if (isNaN(lundi.getTime())) return String(weekKey);
  return `S${weekIsoNumber(lundi)} ${lundi.getFullYear()}`;
}

// Résolution d'un libellé utilisateur depuis ce qui peut être :
//  - une mention Discord '<@123456789>' ou '<@undefined>'
//  - un ID Discord brut '123456789'
//  - directement un nom 'Andrew BEAUCHAMP'
// usersByDiscord : map { discordId -> 'Prénom NOM' }
function resolveUserLabel(raw, usersByDiscord) {
  if (!raw) return '';
  const s = String(raw).trim();
  // <@undefined> ou <@!undefined> : le bot n'a pas pu résoudre côté Discord
  if (/^<@!?undefined>$/i.test(s)) return '— (non résolu)';
  // <@123> ou <@!123> : extraire l'ID et chercher dans users
  const m = s.match(/^<@!?(\d+)>$/);
  if (m) {
    const did = m[1];
    return usersByDiscord[did] || `Discord #${did}`;
  }
  // ID Discord brut (15-21 chiffres)
  if (/^\d{15,21}$/.test(s)) {
    return usersByDiscord[s] || `Discord #${s}`;
  }
  // Sinon : nom déjà en clair
  return s;
}

async function loadUsersByDiscordMap() {
  const snap = await db.collection('users').limit(500).get();
  const map = {};
  for (const d of snap.docs) {
    const u = d.data();
    if (u.idDiscord) {
      const label = `${u.prenom || ''} ${u.nom || ''}`.trim() || u.email || d.id;
      map[String(u.idDiscord)] = label;
    }
  }
  return map;
}

// Primes TTE — calculées à partir du CA et du bénéfice net (mêmes tranches que paie.js)
function primeHebdoFromCa(ca) {
  if (ca >= 600000) return 15000;
  if (ca >= 400000) return 10000;
  if (ca >= 200000) return 5000;
  return 0;
}
function primeMensuelleFromBenefice(b) {
  if (b >= 2000000) return 60000;
  if (b >= 1000000) return 40000;
  if (b >=  500000) return 20000;
  return 0;
}

async function csvResume() {
  const snap = await db.collection('semaines').orderBy('numero', 'desc').limit(52).get();
  const lines = [csvRow(
    'Semaine', 'Date début', 'Date fin',
    'CA', 'Bénéfice brut', 'Dépenses totales', 'Charges déductibles',
    'Masse salariale', 'Prime hebdo (Art. 4-1.10, potentielle)', 'Prime mensuelle (Art. 4-1.11, potentielle)',
    'Bénéfice net', 'Nb ventes', 'Nb dépenses', 'Statut'
  )];
  for (const d of snap.docs) {
    const s = d.data();
    const ca = s.ca || 0;
    const beneficeNet = s.benefice || 0;
    // weekIsoLabel(s.numero) renvoie "S20 2026" : empêche Sheets de parser
    // le weekKey "2026-05-11" en serial date + lisible directement.
    lines.push(csvRow(
      weekIsoLabel(s.numero),
      dateOnly(s.dateDebut),
      dateOnly(s.dateFin),
      ca,
      s.beneficeBrut || 0,
      s.depenses || 0,
      s.chargesDeductibles || 0,
      s.masseSalariale || 0,
      primeHebdoFromCa(ca),
      primeMensuelleFromBenefice(beneficeNet),
      beneficeNet,
      s.nbVentes || 0,
      s.nbDepenses || 0,
      s.statut || ''
    ));
  }
  return lines.join('\n');
}

async function csvDepenses(usersByDiscord, bounds = null) {
  // 2026-05-18 (v1.7.0) : filtre semaine RP courante uniquement.
  // Les semaines clôturées ont leur propre onglet snapshot fige (cf
  // snapshot-sheet-semaine.mjs). Plus besoin de scroll infini ici.
  // v1.7.8 (2026-05-24) : `bounds` optionnel pour cibler une semaine ISO
  // passee (snapshot historique BLA via ?semaine=YYYY-Wnn).
  const { debut, fin } = bounds || weekRangeRPParis();
  const snap = await db.collection('depenses')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  const lines = [csvRow(
    'Date', 'Raison', 'Montant', 'Type', 'Déductible',
    'Fournisseur', 'Validé par patron', 'Justification', 'Utilisateur'
  )];
  for (const d of snap.docs) {
    const x = d.data();
    // v1.14.1 : exclure les lignes type=paie. Les paies sont ecrites en double
    // dans /depenses (artefact legacy) ET dans /paies. Elles ont leur propre
    // onglet "Paies" + sont captees dans la masse salariale du snapshot a la
    // cloture. Les paies versees lundi 00h+ (creneau cloture S-1) avaient un
    // timestamp lundi -> elles polluaient l'onglet "Depenses" de la semaine en
    // cours. Le site filtrait deja (depensesHorsPaie) ; on aligne l'endpoint.
    const t = String(x.type || '').toLowerCase();
    if (t === 'paie' || t === 'paies' || t === 'salaire' || t === 'salaires' || t === 'impot-paye') continue;
    lines.push(csvRow(
      dateIso(x.timestamp),
      x.raison || '',
      x.montant || 0,
      x.type || '',
      x.deductible !== false ? 'oui' : 'non',
      x.fournisseurLabel || '',
      x.valideParPatron ? 'oui' : 'non',
      x.raisonClassification || '',
      resolveUserLabel(x.utilisateur, usersByDiscord)
    ));
  }
  return lines.join('\n');
}

async function csvVentes(usersByDiscord, bounds = null) {
  // 2026-05-18 (v1.7.0) : filtre semaine RP courante uniquement.
  // Les semaines clôturées ont leur propre onglet snapshot fige.
  // v1.7.8 (2026-05-24) : `bounds` optionnel pour snapshot historique.
  const { debut, fin } = bounds || weekRangeRPParis();
  const snap = await db.collection('ventes')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  // Nouveau format CSV :
  //   - Filtre les ventes cachees (doublons bot remplaces par manuelle)
  //     pour eviter d'afficher 2 lignes pour la meme vente.
  //   - Ajoute une colonne "N° Facture IG" : permet de relier chaque ligne
  //     du Sheet a la facture in-game pour audit IRS. Pour les ventes
  //     manuelles (declaration site), on affiche factureBotRef = N° IG
  //     d'origine. Pour les ventes bot non doublees (direction), c'est
  //     directement factureId.
  // 2026-05-14 (demande patron) : l'export Ventes affiche UNIQUEMENT les
  // factures IG (source=discord), avec leur N° de facture IG comme seul
  // identifiant. Les déclarations manuelles (source=manuelle) sont exclues
  // — leur info est interne au site et redondante pour l'auditeur.
  //
  // On exclut aussi les factures annulées IG (annulee=true, supprimées par
  // l'employé via menu F1).
  //
  // Les ventes bot dédupliquées (cachee=true) RESTENT affichées : c'est
  // justement la facture IG d'origine que l'auditeur veut voir.
  const lines = [csvRow('Date', 'N° Facture IG', 'Vendeur', 'Client', 'Montant', 'Paiement', 'Raison', 'Catégorie fiscale')];
  for (const d of snap.docs) {
    const v = d.data();
    if (v.source !== 'discord') continue; // skip déclarations manuelles
    if (v.annulee) continue;               // skip factures supprimées IG
    const vendeur = v.vendeurNom || resolveUserLabel(v.vendeurDiscord, usersByDiscord);
    lines.push(csvRow(
      dateIso(v.timestamp),
      v.factureId || '',
      vendeur,
      v.clientNom || v.client || '',
      v.montant || 0,
      v.paiement || '',
      v.raison || '',
      v.categorieFiscale || 'vente'   // 'vente' = CA ; don-recu/don-verse/subvention/autre-entree = hors CA (BLA classe dans le JSON IRS)
    ));
  }
  return lines.join('\n');
}

// === Mouvements bancaires LTD (entrées + sorties combinées) ===
// Combine /banqueLtd (entrées xbankaccount) + /depenses (sorties #depenses)
// Triées par timestamp décroissant. Permet à l'audit IRS de voir TOUS les
// mouvements du compte LTD chronologiquement avec le solde après chaque op.
async function csvBanque(bounds = null) {
  const lines = [csvRow(
    'Date', 'Type', 'Montant', 'Solde avant', 'Solde après', 'Raison', 'Utilisateur', 'Source'
  )];

  // v1.7.8 (2026-05-24) : si bounds fourni, filtre sur la semaine ISO ciblee
  // (snapshot BLA). Sinon, comportement actuel : 1500 derniers mvts + 500
  // depenses, audit IRS sur historique complet.
  let banquePromise, depensesPromise;
  if (bounds) {
    banquePromise = db.collection('banqueLtd')
      .where('timestamp', '>=', Timestamp.fromDate(bounds.debut))
      .where('timestamp', '<=', Timestamp.fromDate(bounds.fin))
      .orderBy('timestamp', 'desc').get();
    depensesPromise = db.collection('depenses')
      .where('timestamp', '>=', Timestamp.fromDate(bounds.debut))
      .where('timestamp', '<=', Timestamp.fromDate(bounds.fin))
      .orderBy('timestamp', 'desc').get();
  } else {
    banquePromise = db.collection('banqueLtd').orderBy('timestamp', 'desc').limit(1500).get();
    depensesPromise = db.collection('depenses').orderBy('timestamp', 'desc').limit(500).get();
  }
  const [banqueSnap, depensesSnap] = await Promise.all([banquePromise, depensesPromise]);

  // Combine en un tableau unifié
  // Note : FiveM log CHAQUE paiement sur 2 canaux (xbankaccount removemoney
  // → /banqueLtd ET #depenses → /depenses). Sans dédup, chaque sortie est
  // comptée 2 fois. On dédoublonne par (montant, type=remove, timestamp ±120s)
  // — même clé que crossRefBanqueDepense() — et on privilégie /depenses car
  // plus riche en métadonnées.
  const banqueOps = [];
  for (const d of banqueSnap.docs) {
    const x = d.data();
    if (!x.timestamp) continue;
    banqueOps.push({
      _id: d.id,
      timestamp: x.timestamp,
      type: x.type === 'remove' ? 'Sortie' : 'Entrée',
      _rawType: x.type === 'remove' ? 'remove' : 'add',
      montant: Number(x.montant) || 0,
      soldeAvant: Number(x.soldeAvant) || 0,
      soldeApres: Number(x.soldeApres) || 0,
      raison: x.raison || '',
      utilisateur: '',
      source: 'xbankaccount'
    });
  }
  const depOps = [];
  for (const d of depensesSnap.docs) {
    const x = d.data();
    if (!x.timestamp) continue;
    depOps.push({
      _id: d.id,
      timestamp: x.timestamp,
      type: 'Sortie',
      _rawType: 'remove',
      montant: Number(x.montant) || 0,
      soldeAvant: Number(x.soldeAvant) || 0,
      soldeApres: Number(x.soldeApres) || 0,
      raison: x.raison || '',
      utilisateur: x.utilisateur || '',
      source: 'depense'
    });
  }

  // Déduplication banque ↔ dépenses
  const DEDUP_WINDOW_MS = 120 * 1000;
  const banqueRemovesByMontant = new Map();
  for (const op of banqueOps) {
    if (op._rawType !== 'remove') continue;
    const ms = op.timestamp.toMillis ? op.timestamp.toMillis() : 0;
    if (!ms) continue;
    if (!banqueRemovesByMontant.has(op.montant)) banqueRemovesByMontant.set(op.montant, []);
    banqueRemovesByMontant.get(op.montant).push({ ms, op, used: false });
  }
  const idsBanqueDoublons = new Set();
  let nbDoublons = 0;
  for (const dep of depOps) {
    const ms = dep.timestamp.toMillis ? dep.timestamp.toMillis() : 0;
    if (!ms) continue;
    const candidats = banqueRemovesByMontant.get(dep.montant) || [];
    let best = null;
    let bestDelta = Infinity;
    for (const c of candidats) {
      if (c.used) continue;
      const delta = Math.abs(c.ms - ms);
      if (delta <= DEDUP_WINDOW_MS && delta < bestDelta) {
        best = c;
        bestDelta = delta;
      }
    }
    if (best) {
      best.used = true;
      idsBanqueDoublons.add(best.op._id);
      nbDoublons++;
    }
  }
  const banqueOpsDedupes = banqueOps.filter(op => !idsBanqueDoublons.has(op._id));
  if (nbDoublons > 0) {
    console.log(`[csvBanque] dédup : ${nbDoublons} doublon(s) banqueLtd↔depenses supprimé(s)`);
  }
  const ops = [...banqueOpsDedupes, ...depOps];

  // Tri chronologique décroissant
  ops.sort((a, b) => {
    const ta = a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
    const tb = b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
    return tb - ta;
  });

  // Génère le CSV (limite à 2000 pour la perf)
  for (const op of ops.slice(0, 2000)) {
    lines.push(csvRow(
      dateIso(op.timestamp),
      op.type,
      op.montant,
      op.soldeAvant,
      op.soldeApres,
      op.raison,
      op.utilisateur,
      op.source
    ));
  }
  return lines.join('\n');
}

// === CA carburant — collection /redistributions COMPLETE ===
// Pourquoi : le CSV banque n'expose que les redistributions qui transitent
// par xbankaccount (`source=banqueLtd-redistribution`). Les autres ecritures
// /redistributions (ravitaillement manuel pompiste, correction stock) ont
// montant=0 mais font partie de l'audit. Surtout, certaines ventes carburant
// reelles peuvent etre dans /redistributions sans correspondance banque
// (selon source). Ce CSV expose donc TOUTE la collection pour permettre aux
// portails clients (BLA Corporate) de sommer le vrai CA carburant.
// 2026-05-24 (v1.7.1) : nouvel endpoint demande par BLA Corporate pour
// corriger un ecart de ~46% sur le CA carburant affiche.
async function csvCarburant(bounds = null) {
  // Filtre semaine RP courante (coherent avec ventes/depenses).
  // v1.7.8 (2026-05-24) : `bounds` optionnel pour snapshot historique.
  const { debut, fin } = bounds || weekRangeRPParis();
  const snap = await db.collection('redistributions')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  const lines = [csvRow(
    'Date', 'N°', 'Station', 'StationId', 'Montant', 'Litres', 'Prix/L',
    'Stock avant', 'Stock après', 'Source', 'Pompiste', 'Raison'
  )];
  for (const d of snap.docs) {
    const r = d.data();
    // N° = redistributionId (N° pompe FiveM) si present, sinon fivemPompeId
    const numero = r.redistributionId || r.fivemPompeId || '';
    lines.push(csvRow(
      dateIso(r.timestamp),
      numero,
      r.station || '',
      r.stationId || '',
      Number(r.montant) || 0,
      Number(r.litres) || 0,
      Number(r.prixLitre) || 0,
      Number(r.stockAvant) || 0,
      Number(r.stockApres) || 0,
      r.source || '',
      r.pompisteNom || '',
      r.raison || ''
    ));
  }
  return lines.join('\n');
}

// Nettoie un nom qui peut venir pollué du bot Discord (ex: "Morgan Harper\n<@999...>")
// Garde la première occurrence "Prénom NOM" si trouvable, sinon retourne la chaîne trim.
function cleanNomBot(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/([A-ZÀ-Ÿ][a-zà-ÿ\-']+(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ\-']+)+)/);
  return m ? m[1] : s;
}

async function csvPaies(usersByDiscord, bounds = null) {
  // 2026-05-24 (v1.7.2) : reintroduit a la demande de BLA Corporate pour
  // permettre au portail client de calculer la masse salariale reelle dans
  // le JSON IRS (les paies sont volontairement exclues de /depenses par
  // clotureHebdo, sinon doublon avec /paies attribuees).
  // 2026-05-18 (v1.7.0) : filtre semaine RP courante + fenetre paie post-dim
  // de la semaine precedente (lun N+1 → mar N+1 21h). Capture les paies
  // versees lundi matin pour S-1 tant qu'elles restent pertinentes.
  // Les semaines plus anciennes sont figees dans leurs onglets snapshot.
  // v1.7.8 (2026-05-24) : `bounds` optionnel pour snapshot historique.
  // On etend la fenetre cote droit de +2 jours (jusqu'a mardi 23h59) pour
  // capturer les paies versees lundi/mardi N+1 attribuees a la semaine N.
  const range = bounds || weekRangeRPParis();
  const debut = range.debut;
  const fin = range.fin;
  // Recule au dimanche 23h59 S-1 pour englober la fenetre paie post-dim courante.
  const debutAvecFenetre = new Date(debut.getTime() - 1000);
  let snapQuery = db.collection('paies')
    .where('timestamp', '>=', Timestamp.fromDate(debutAvecFenetre));
  if (bounds) {
    // Fenetre paie post-dim : etend jusqu'a mardi 23h59 N+1 pour capturer
    // les versements faits lundi/mardi pour la semaine N.
    const finAvecFenetrePaie = new Date(fin.getTime() + 2 * 24 * 3600 * 1000);
    snapQuery = snapQuery.where('timestamp', '<=', Timestamp.fromDate(finAvecFenetrePaie));
  }
  const snap = await snapQuery.orderBy('timestamp', 'desc').get();
  // Charge le map users complet pour enrichir poste/role (le map
  // usersByDiscord ne donne que le nom). Necessaire pour la colonne Poste.
  const usersFullSnap = await db.collection('users').limit(500).get();
  const usersByUid = {};
  const usersByDiscordFull = {};
  for (const d of usersFullSnap.docs) {
    const u = d.data();
    const profile = { role: u.role || '', prenom: u.prenom || '', nom: u.nom || '' };
    usersByUid[d.id] = profile;
    if (u.idDiscord) usersByDiscordFull[String(u.idDiscord)] = profile;
  }
  const lines = [csvRow(
    'Date', 'Employé', 'Discord', 'Poste', 'Type', 'Montant',
    'Mode', 'Source', 'Période', 'Payé par', 'Validé par'
  )];
  for (const d of snap.docs) {
    const p = d.data();
    const payeur       = (p.payeurDiscord       && usersByDiscord[String(p.payeurDiscord)])       || cleanNomBot(p.payeurNom)       || resolveUserLabel(p.payeurDiscord,       usersByDiscord);
    const beneficiaire = (p.beneficiaireDiscord && usersByDiscord[String(p.beneficiaireDiscord)]) || cleanNomBot(p.beneficiaireNom) || resolveUserLabel(p.beneficiaireDiscord, usersByDiscord);
    // Poste : on regarde le profil du beneficiaire (par uid, puis discord).
    const profilBen = (p.beneficiaireId && usersByUid[p.beneficiaireId])
      || (p.beneficiaireDiscord && usersByDiscordFull[String(p.beneficiaireDiscord)])
      || null;
    const poste = profilBen ? (profilBen.role || '') : '';
    // Type : salaire par defaut (le bot ne distingue pas prime/salaire au
    // niveau de /paies, c'est gere en aval par le snapshot).
    const typePaie = p.type || 'salaire';
    // Mode : espece / virement (le bot Discord ne le passe pas, mais on
    // expose le champ s'il existe — sinon "non-renseigne").
    const mode = p.mode || p.modePaiement || '';
    // Source : log Discord => espece IG. Permet de croiser avec banqueLtd.
    const source = p.source || 'discord-bot';
    const periode = p.periode || weekIsoLabel(p.weekKeyAttribuee);
    const valideePar = p.valideeParNom || p.snapshotMatchePar || '';
    lines.push(csvRow(
      dateIso(p.timestamp),
      beneficiaire,
      p.beneficiaireDiscord || '',
      poste,
      typePaie,
      p.montant || 0,
      mode,
      source,
      periode,
      payeur,
      valideePar
    ));
  }
  return lines.join('\n');
}

// === Masse salariale ESTIMEE — replique calculerPaieEstimee cote backend ===
// 2026-05-24 (v1.7.5) : nouvel endpoint demande par BLA Corporate.
//
// Probleme : l'endpoint /paies ne lit que les paies REELLEMENT VERSEES via
// le bot Discord. Avant lundi 00h-02h (creneau ou le patron Morgan HARPER fait
// les paies), aucune ligne /paies n'existe pour la semaine S en cours, donc
// le portail BLA voyait masseSalariale=0 et le bilan client etait fantaisiste.
//
// Solution : repliquer la logique frontend salaireEstime / calculerPaieEstimee
// (cf. /lib/paie-calc.mjs miroir de /public/js/utils/paie.js) sur les donnees
// reelles de la semaine RP courante (ventes, quotas pompiste, quotas vendeur,
// config quotas/CA). Resultat = ce que LE LTD AFFICHE actuellement sur /rh
// (KPI "Salaires estimes"), ligne par ligne.
//
// Resolution "Statut versé / non versé" : on tente un match par
// beneficiaireId ET (a defaut) idDiscord avec la collection /paies sur la
// meme fenetre que csvPaies (lun N+1 00h -> mar N+1 21h, capture des paies
// versees apres-coup), tolerance 5% du montant cible (mini 500$).
//
// IMPORTANT : on EXCLUT les admin-technique (compteEnFinance=false) pour
// matcher exactement la KPI cote LTD ("Salaires estimes" sur /rh).
async function csvMasseSalarialeEstimee(usersByDiscord, bounds = null) {
  // v1.7.8 (2026-05-24) : `bounds` optionnel pour snapshot historique.
  // Si bounds fourni, on derive weekKey depuis bounds.weekKey (lundi de la
  // semaine ciblee). Sinon comportement actuel (semaine RP courante).
  const range = bounds || weekRangeRPParis();
  const debut = range.debut;
  const fin = range.fin;
  // BUG FIX (2026-05-24) : `debut` est un Date UTC (parisWallToUtcGlobal),
  // donc `toISOString().slice(0, 10)` renvoie la veille (dim 22h UTC = lun 00h
  // Paris CEST). On utilisait alors weekKey='2026-05-17' alors que les docs
  // /quotasPompiste/{semaine}_{uid} sont ecrits par majQuotaPompiste avec
  // semaine='2026-05-18' via currentWeekId() (= lundi Paris). Resultat : les
  // quotas etaient introuvables et tous les pompistes apparaissaient a 0$.
  // Symetrie /rh : le frontend utilise weekId() (heure locale) -> '2026-05-18'.
  // Fix : on utilise currentWeekId() qui calcule le lundi en heure Paris, idem
  // au pattern qui ecrit les docs (cf majQuotaPompiste ligne 2033).
  const weekKey = bounds ? bounds.weekKey : currentWeekId();

  // Charger en parallele tout ce dont calculerPaieEstimee a besoin + paies
  // pour la resolution "versé / non versé".
  const debutAvecFenetre = new Date(debut.getTime() - 1000);
  const [usersSnap, ventesSnap, quotasSnap, quotasVSnap, cfgSnap, paiesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('ventes')
      .where('timestamp', '>=', Timestamp.fromDate(debut))
      .where('timestamp', '<=', Timestamp.fromDate(fin)).get(),
    db.collection('quotasPompiste').where('semaine', '==', weekKey).get(),
    db.collection('quotasVendeur').where('semaine', '==', weekKey).get(),
    db.collection('config').doc('global').get(),
    db.collection('paies')
      .where('timestamp', '>=', Timestamp.fromDate(debutAvecFenetre))
      .orderBy('timestamp', 'desc').get()
  ]);

  // Filtre ventes cachees (doublons bot/manuelle) — cohérent rh.js + snapshotPaiesEstimees.
  const ventes = ventesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.cachee);

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

  // Index paies pour la resolution "verse / non verse". On indexe par
  // beneficiaireId + (fallback) beneficiaireDiscord.
  const paiesByUid = {};
  const paiesByDiscord = {};
  paiesSnap.docs.forEach(d => {
    const p = d.data();
    const m = Number(p.montant) || 0;
    if (p.beneficiaireId) {
      if (!paiesByUid[p.beneficiaireId]) paiesByUid[p.beneficiaireId] = [];
      paiesByUid[p.beneficiaireId].push({ montant: m, ref: d.id });
    }
    if (p.beneficiaireDiscord) {
      const did = String(p.beneficiaireDiscord);
      if (!paiesByDiscord[did]) paiesByDiscord[did] = [];
      paiesByDiscord[did].push({ montant: m, ref: d.id });
    }
  });

  // On inclut TOUS les users (actifs ou non) qui ont compteEnFinance=true,
  // pour eviter d'oublier quelqu'un dont le statut a été manipule. Le client
  // pourra filtrer par statut s'il le souhaite.
  const isAdminTech = (r) => r === 'admin-technique';
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => !isAdminTech(u.role || ''));

  const lines = [csvRow(
    'Employé', 'Discord', 'Rôle', 'Statut compte',
    'Salaire décidé', 'Salaire estimé', 'Plafond',
    'Détail (CA / Quota / Fixe)', 'Formule',
    'Statut paie', 'Montant versé'
  )];

  // Tri : direction d'abord, puis responsables, puis vendeurs, puis pompistes,
  // puis DRH/autres. (Heuristique pour lisibilite humaine du CSV.)
  const ROLE_ORDER = {
    'patron': 0, 'co-patron': 1, 'drh': 2,
    'responsable-vente': 3, 'chef-equipe': 4, 'responsable-pompiste': 5,
    'vendeur-experimente': 6, 'vendeur-intermediaire': 7, 'vendeur-novice': 8,
    'pompiste-experimente': 9, 'pompiste-intermediaire': 10, 'pompiste-novice': 11
  };
  users.sort((a, b) => {
    const oa = ROLE_ORDER[a.role] ?? 99;
    const ob = ROLE_ORDER[b.role] ?? 99;
    if (oa !== ob) return oa - ob;
    const na = `${a.nom || ''} ${a.prenom || ''}`.trim().toLowerCase();
    const nb = `${b.nom || ''} ${b.prenom || ''}`.trim().toLowerCase();
    return na.localeCompare(nb);
  });

  // Plafonds (recopies de paie-calc.mjs — mineure repete car non exporte
  // sous forme utilisable directement ici)
  const PLAFONDS = {
    'patron': 20000, 'co-patron': 20000, 'drh': 18000,
    'responsable-vente': 17000, 'chef-equipe': 16000, 'responsable-pompiste': 17000,
    'vendeur-novice': 13000, 'vendeur-intermediaire': 14000, 'vendeur-experimente': 15000,
    'pompiste-novice': 13000, 'pompiste-intermediaire': 14000, 'pompiste-experimente': 15000
  };

  for (const user of users) {
    const calc = calculerPaieEstimee({
      user,
      ventes,
      quota: quotaByUser[user.id] || null,
      quotaV: quotaVByUser[user.id] || null,
      cfg,
      weekKey   // date la formule (resp-vente hybride a partir du 22/06)
    });

    const role = user.role || '';
    const plafond = PLAFONDS[role] || 0;
    const salaireDecide = Number(user.salaireDecide) || 0;

    // Detail lisible humain
    let detail = '';
    if (role === 'patron' || role === 'co-patron' || role === 'drh'
        || role === 'responsable-pompiste') {
      detail = `Fixe : ${salaireDecide > 0 ? salaireDecide : plafond} $`;
    } else if (role === 'responsable-vente' || role === 'chef-equipe') {
      detail = `Fixe + CA particulier : ${Math.round(calc.caParticulier)} $`;
    } else if (role.startsWith('vendeur')) {
      detail = `CA particulier : ${Math.round(calc.caParticulier)} $`;
    } else if (role.startsWith('pompiste')) {
      detail = `Bidons : ${calc.bidons} / ${cfg.quotaBidons ?? 1700} · Caoutchoucs : ${calc.caoutchoucs} / ${cfg.quotaCaoutchoucs ?? 800}`;
    } else {
      detail = '-';
    }

    // Match versé / non versé
    let statutPaie = 'non versé';
    let montantVerse = 0;
    if (calc.montantEstime > 0) {
      const tol = Math.max(500, calc.montantEstime * 0.05);
      const cand = (paiesByUid[user.id] || []).concat(
        user.idDiscord ? (paiesByDiscord[String(user.idDiscord)] || []) : []
      );
      // Le meilleur match = montant le plus proche dans la fenetre de tolerance
      let best = null;
      let bestDelta = Infinity;
      for (const p of cand) {
        const delta = Math.abs(p.montant - calc.montantEstime);
        if (delta <= tol && delta < bestDelta) { best = p; bestDelta = delta; }
      }
      if (best) {
        statutPaie = 'versé';
        montantVerse = best.montant;
      }
    } else {
      // Salaire estime = 0 (admin-tech filtre, role inconnu, ou pas d'activite)
      statutPaie = 'estimation nulle';
    }

    const nom = `${user.prenom || ''} ${user.nom || ''}`.trim()
      || user.email || user.id;
    lines.push(csvRow(
      nom,
      user.idDiscord || '',
      role,
      user.statut || 'actif',
      salaireDecide,
      calc.montantEstime,
      plafond,
      detail,
      calc.formule || '',
      statutPaie,
      montantVerse
    ));
  }

  return lines.join('\n');
}

// v1.7.7 (2026-05-24) : liste les semaines cloturees pour la section
// "Archives" du portail BLA Corporate. Lit /semaines orderBy dateDebut desc
// limit 20. Format CSV stable consomme par portal.js (la cle de chaque ligne
// est "Semaine ISO" au format YYYY-Wnn, utilisable directement comme arg
// `?semaine=` de la Cloud Function generateSnapshotPdf cote BLA).
async function csvSemainesFermees() {
  const snap = await db.collection('semaines')
    .orderBy('dateDebut', 'desc')
    .limit(20)
    .get();
  const lines = [csvRow(
    'Semaine ISO', 'Numero', 'Date debut', 'Date fin',
    'CA produits', 'CA carburant', 'CA total',
    'Depenses', 'Masse salariale',
    'Benefice', 'Impot', 'Net',
    'Nb ventes', 'Nb depenses', 'Statut'
  )];
  for (const d of snap.docs) {
    const s = d.data();
    const debutDate = tsToDate(s.dateDebut);
    // Convertir en horloge Paris pour calculer le numero ISO : sinon, un
    // dateDebut "lundi 2026-05-11 00:00 Paris" stocke en UTC = "2026-05-10
    // 22:00 UTC" (DST). En UTC weekIsoNumber retourne 19 (semaine -1),
    // alors qu'on attend 20. toParisWall reconstruit un Date dont les
    // composantes UTC representent l'horloge Paris.
    const debutParis = debutDate ? toParisWall(debutDate) : null;
    const isoNum = debutParis ? weekIsoNumber(debutParis) : 0;
    const isoYear = debutParis ? debutParis.getUTCFullYear() : '';
    // Cle ISO standardisee pour la Cloud Function snapshot : YYYY-Wnn (zero-pad).
    const semaineIso = isoNum && isoYear
      ? `${isoYear}-W${String(isoNum).padStart(2, '0')}`
      : '';
    const caTotal = Number(s.ca || 0);
    const caCarburant = Number(s.caCarburant || 0);
    const caProduits = Number(s.caProduits || (caTotal - caCarburant));
    const depenses = Number(s.depenses || 0);
    const masse = Number(s.masseSalariale || 0);
    const benefice = Number(s.benefice != null ? s.benefice : (caTotal - depenses - masse));
    // Impot estime (tranches TTE Art. 4-3.2) — informationnel seul, le doc
    // /semaines n'archive pas l'impot reellement paye.
    let impot = 0;
    if (benefice > 10000) {
      if (benefice <= 50000) impot = benefice * 0.10;
      else if (benefice <= 100000) impot = benefice * 0.19;
      else if (benefice <= 250000) impot = benefice * 0.28;
      else if (benefice <= 500000) impot = benefice * 0.36;
      else impot = benefice * 0.46;
    }
    const net = benefice - impot;
    lines.push(csvRow(
      semaineIso,
      s.numero || d.id || '',
      dateOnly(s.dateDebut),
      dateOnly(s.dateFin),
      Math.round(caProduits),
      Math.round(caCarburant),
      Math.round(caTotal),
      Math.round(depenses),
      Math.round(masse),
      Math.round(benefice),
      Math.round(impot),
      Math.round(net),
      Number(s.nbVentes || 0),
      Number(s.nbDepenses || 0),
      s.statut || ''
    ));
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------
// reclasserDepense — Patron valide ou change la classification d'une dépense
// ----------------------------------------------------------------
// Auth : direction (patron, co-patron, admin-technique) uniquement.
// Le patron peut :
//   - Valider la suggestion automatique → met `valideParPatron: true`
//   - Override : changer `deductible` et/ou `type` (categorie)
//   - Mémoriser le pattern : ajoute un nouveau fournisseur dans
//     /config/global.fournisseurs pour que toutes les futures dépenses
//     correspondantes héritent automatiquement de cette classification.
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// categoriserVente : classe fiscalement une entrée encaissée.
// Une "vente" peut en réalité être un don reçu/versé, une subvention ou
// une autre entrée (Code TTE Art. 3-1.5 / 4-2). Classée hors 'vente', elle
// SORT du CA produits (clôture + compta) et est exportée avec sa catégorie
// pour que le cabinet (BLA) la place dans la bonne case du JSON IRS
// (ex. « Montant Dons Reçu », imposable 10%/30%).
// Direction uniquement. Cloud Function = admin SDK (bypass règles Firestore).
// ----------------------------------------------------------------
const CATEGORIES_FISCALES = ['vente', 'don-recu', 'don-verse', 'subvention', 'autre-entree'];
export const categoriserVente = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    if (role !== 'patron' && role !== 'co-patron' && role !== 'admin-technique') {
      return res.status(403).json({ error: 'Seule la direction peut classer fiscalement une entrée.' });
    }

    const { venteId, categorieFiscale, noteAudit } = req.body || {};
    if (!venteId) return res.status(400).json({ error: 'venteId manquant' });
    if (!CATEGORIES_FISCALES.includes(categorieFiscale)) {
      return res.status(400).json({ error: 'categorieFiscale invalide' });
    }

    const venteRef = db.collection('ventes').doc(venteId);
    const venteSnap = await venteRef.get();
    if (!venteSnap.exists) return res.status(404).json({ error: 'Entrée introuvable' });

    await venteRef.set({
      categorieFiscale,
      categoriseParPatron: true,
      categorisePar: decoded.uid,
      categoriseParNom: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
      dateCategorisation: FieldValue.serverTimestamp(),
      noteCategorisation: noteAudit || null
    }, { merge: true });

    return res.json({ ok: true, venteId, categorieFiscale });
  } catch (e) {
    console.error('[categoriserVente]', e);
    return res.status(500).json({ error: e.message || 'Erreur interne' });
  }
});

export const reclasserDepense = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);

    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    if (role !== 'patron' && role !== 'co-patron' && role !== 'admin-technique') {
      return res.status(403).json({ error: 'Seule la direction peut reclassifier une dépense.' });
    }

    const {
      depenseId,
      deductible,
      categorie,
      raisonClassification,
      memoriserPattern,    // { id, label, matchType, matchValue } optionnel
      noteAudit            // commentaire libre patron (optionnel)
    } = req.body || {};

    if (!depenseId) return res.status(400).json({ error: 'depenseId manquant' });
    if (typeof deductible !== 'boolean') return res.status(400).json({ error: 'deductible doit être booléen' });
    if (!categorie || typeof categorie !== 'string') return res.status(400).json({ error: 'categorie manquante' });

    const depRef = db.collection('depenses').doc(depenseId);
    const depSnap = await depRef.get();
    if (!depSnap.exists) return res.status(404).json({ error: 'Dépense introuvable' });

    await depRef.set({
      type: categorie,
      deductible,
      raisonClassification: raisonClassification || depSnap.data().raisonClassification || '',
      valideParPatron: true,
      validePar: decoded.uid,
      validateurNom: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
      dateValidation: FieldValue.serverTimestamp(),
      noteAudit: noteAudit || null
    }, { merge: true });

    // Mémorisation : soit ajout à un pattern existant, soit création d'un nouveau
    if (memoriserPattern) {
      const cfgRef = db.collection('config').doc('global');
      const cfgSnap = await cfgRef.get();
      const existing = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];

      if (memoriserPattern.action === 'ajouter-au-pattern' && memoriserPattern.patternIdExistant && memoriserPattern.matchValue) {
        // Mode "ajouter au pattern existant" : on enrichit le matchValue (CSV)
        const patIdx = existing.findIndex(p => p.id === memoriserPattern.patternIdExistant);
        if (patIdx >= 0) {
          const pat = existing[patIdx];
          const valeurs = String(pat.matchValue || '').split(',').map(v => v.trim()).filter(Boolean);
          const nouvelleValeur = String(memoriserPattern.matchValue).trim();
          if (!valeurs.includes(nouvelleValeur)) {
            valeurs.push(nouvelleValeur);
            existing[patIdx] = {
              ...pat,
              matchValue: valeurs.join(','),
              dateAjout: new Date().toISOString()
            };
            await cfgRef.set({ fournisseurs: existing }, { merge: true });
          }
        }
      } else if (memoriserPattern.id && memoriserPattern.matchType && memoriserPattern.matchValue) {
        // Mode "créer un nouveau pattern"
        const existingIdx = existing.findIndex(p => p.id === memoriserPattern.id);
        const nouveauPattern = {
          id: memoriserPattern.id,
          label: memoriserPattern.label || memoriserPattern.id,
          matchType: memoriserPattern.matchType,
          matchValue: String(memoriserPattern.matchValue),
          categorie,
          deductible,
          raisonClassification: raisonClassification || '',
          ajoutePar: decoded.uid,
          dateAjout: new Date().toISOString()
        };
        let merged;
        if (existingIdx >= 0) {
          merged = [...existing];
          merged[existingIdx] = nouveauPattern;
        } else {
          merged = [...existing, nouveauPattern];
        }
        await cfgRef.set({ fournisseurs: merged }, { merge: true });
      }
    }

    // Re-match du fournisseur APRÈS save + éventuelle mémorisation : pose
    // fournisseurLabel + fournisseurPatternId sur la dépense pour que l'UI
    // Compta affiche le badge fournisseur (sinon la colonne reste "—" alors
    // que le pattern matche bien).
    // (comptaExport refait déjà ce match en lecture pour le CSV / Sheet, mais
    //  l'UI Compta lit directement le champ stocké sur la dépense.)
    try {
      const depAfter = (await depRef.get()).data() || {};
      const cfgSnapNow = await db.collection('config').doc('global').get();
      const patternsNow = cfgSnapNow.exists ? (cfgSnapNow.data().fournisseurs || []) : [];
      let matched = null;
      for (const pat of patternsNow) {
        if (matchesFournisseurPattern(pat, depAfter, depAfter.raison || '')) {
          matched = pat;
          break;
        }
      }
      if (matched) {
        await depRef.set({
          fournisseurLabel: matched.label,
          fournisseurPatternId: matched.id
        }, { merge: true });
      } else {
        // Pas de match → nettoie les anciennes valeurs si présentes (cas où
        // le patron change la classification d'une dépense précédemment auto-classée).
        await depRef.set({
          fournisseurLabel: FieldValue.delete(),
          fournisseurPatternId: FieldValue.delete()
        }, { merge: true });
      }
    } catch (e) {
      console.error('[reclasserDepense] re-match fournisseur error:', e.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[reclasserDepense]', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
});


// ============================================================
// Dashboard Sheet : 2 endpoints HTTP (refresh manuel + clôture semaine)
// ============================================================
// 2026-05-14 : suppression du cron 'every 1 minutes' qui était trop
// invasif visuellement. Le patron déclenche maintenant le refresh à la
// demande via un bouton sur la page Comptabilité du site.
//
// Auth admin (direction) via Bearer token Firebase Auth.
// ============================================================
import { google as googleapis } from 'googleapis';
import { regenererDashboard } from './lib/dashboard-core.mjs';
import { forceRefreshImportData } from './lib/refresh-importdata.mjs';

// Helper : crée un client Sheets API avec le service account stocké en secret
function getSheetsClient() {
  const saKey = JSON.parse(DASHBOARD_SA_KEY.value());
  const auth = new googleapis.auth.GoogleAuth({
    credentials: saKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return googleapis.sheets({ version: 'v4', auth });
}

// Helper : vérifie le token Bearer et que l'appelant est direction
async function requireDirection(req) {
  const authHeader = req.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) throw { status: 401, error: 'Missing Authorization Bearer token' };
  const decoded = await adminAuth.verifyIdToken(idToken);
  const callerSnap = await db.collection('users').doc(decoded.uid).get();
  if (!callerSnap.exists) throw { status: 403, error: 'Caller profile not found' };
  const caller = callerSnap.data();
  const role = caller.role || '';
  if (!['patron', 'co-patron', 'admin-technique'].includes(role)) {
    throw { status: 403, error: 'Direction uniquement' };
  }
  return { uid: decoded.uid, caller };
}

// Refresh Dashboard à la demande (bouton site)
export const refreshDashboardNow = onRequest({
  region: 'europe-west1',
  cors: true,
  secrets: [DASHBOARD_SA_KEY],
  timeoutSeconds: 120,
  memory: '512MiB'
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    await requireDirection(req);
    const sheets = getSheetsClient();
    const result = await regenererDashboard({ db, sheets });
    // Casse le cache IMPORTDATA des feuilles Depenses/Ventes/Paies pour
    // que les modifs (reclassement, etc.) faites côté site remontent
    // immédiatement dans le doc compta.
    const importdataResult = await forceRefreshImportData({ sheets });
    return res.status(200).json({ ok: true, ...result, importdata: importdataResult });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.error });
    console.error('[refreshDashboardNow] error:', e.message);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// ============================================================
// Engagements de remboursement — CRUD via Cloud Function (auth direction)
// ============================================================
export const gererEngagement = onRequest({
  region: 'europe-west1',
  cors: true
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const { uid, caller } = await requireDirection(req);
    const { action, id, beneficiaire, signataire, objet, type, montantInitial,
            dateReception, dateEcheance, notes, montantRembourse, statut,
            montant, raison } = req.body || {};

    const coll = db.collection('engagements');

    if (action === 'list') {
      const snap = await coll.orderBy('dateReception', 'desc').get();
      const engagements = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          dateReception: data.dateReception?.toDate?.()?.toISOString() || data.dateReception,
          dateEcheance: data.dateEcheance?.toDate?.()?.toISOString() || data.dateEcheance,
          dateMaj: data.dateMaj?.toDate?.()?.toISOString() || data.dateMaj
        };
      });
      return res.status(200).json({ ok: true, engagements });
    }

    if (action === 'create') {
      if (!beneficiaire || !objet || !montantInitial || !dateReception || !dateEcheance) {
        return res.status(400).json({ error: 'Champs requis manquants' });
      }
      const docId = id || `${type || 'engagement'}-${Date.now()}`;
      await coll.doc(docId).set({
        id: docId,
        type: type || 'subvention-rembours',
        beneficiaire,
        signataire: signataire || '',
        objet,
        montantInitial: Number(montantInitial),
        montantRembourse: 0,
        montantRestant: Number(montantInitial),
        devise: 'USD',
        dateReception: Timestamp.fromDate(new Date(dateReception)),
        dateEcheance: Timestamp.fromDate(new Date(dateEcheance)),
        statut: 'actif',
        notes: notes || '',
        createdBy: uid,
        createdParNom: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
        dateCreation: new Date().toISOString(),
        dateMaj: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ ok: true, id: docId });
    }

    if (action === 'update') {
      if (!id) return res.status(400).json({ error: 'id manquant' });
      const update = {
        beneficiaire, signataire, objet, type,
        montantInitial: Number(montantInitial),
        montantRembourse: Number(montantRembourse) || 0,
        montantRestant: Number(montantInitial) - (Number(montantRembourse) || 0),
        dateReception: Timestamp.fromDate(new Date(dateReception)),
        dateEcheance: Timestamp.fromDate(new Date(dateEcheance)),
        notes: notes || '',
        statut: statut || 'actif',
        majPar: uid,
        dateMaj: FieldValue.serverTimestamp()
      };
      await coll.doc(id).set(update, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id manquant' });
      await coll.doc(id).delete();
      return res.status(200).json({ ok: true });
    }

    if (action === 'rembourser') {
      if (!id || !montant) return res.status(400).json({ error: 'id ou montant manquant' });
      const ref = coll.doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Engagement introuvable' });
      const e = snap.data();
      const ancienRembourse = Number(e.montantRembourse) || 0;
      const ancienRestant = Number(e.montantRestant) || 0;
      const m = Number(montant);
      const nouveauRembourse = ancienRembourse + m;
      const nouveauRestant = Math.max(0, ancienRestant - m);
      const nouveauStatut = nouveauRestant <= 0 ? 'rembourse' : 'actif';
      await ref.set({
        montantRembourse: nouveauRembourse,
        montantRestant: nouveauRestant,
        statut: nouveauStatut,
        dateMaj: FieldValue.serverTimestamp(),
        historiqueRemboursements: FieldValue.arrayUnion({
          montant: m,
          raison: raison || 'Remboursement manuel',
          utilisateur: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
          uid,
          source: 'manuel',
          timestamp: new Date().toISOString()
        })
      }, { merge: true });
      return res.status(200).json({ ok: true, nouveauRestant, nouveauStatut });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.error });
    console.error('[gererEngagement]', e);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// ============================================================
// Cron quotidien : alertes engagements proches échéance
// ============================================================
// Tourne chaque jour à 9h Paris. Pour chaque engagement actif :
//   - Jours restants ≤ 7 : crée alerte direction (gravité warn)
//   - Jours restants < 0 : crée alerte direction (gravité critical) + statut='defaillant'
// Idempotent : id alerte déterministe par engagement+date pour éviter doublons quotidiens.
export const cronAlertesEngagements = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
  timeoutSeconds: 60
}, async () => {
  const snap = await db.collection('engagements').where('statut', '==', 'actif').get();
  console.log(`[cronAlertesEngagements] ${snap.size} engagements actifs`);

  const aujourdhui = new Date().toISOString().slice(0, 10);
  for (const d of snap.docs) {
    const e = d.data();
    const ech = e.dateEcheance?.toDate?.();
    if (!ech) continue;
    const joursRest = Math.ceil((ech.getTime() - Date.now()) / (24 * 3600 * 1000));

    let gravite = null;
    let message = null;
    if (joursRest < 0) {
      gravite = 'critical';
      message = `🔴 EN RETARD : engagement "${e.objet}" (${e.montantRestant}$ restant) — échéance dépassée de ${Math.abs(joursRest)} jour(s).`;
      // Bascule en défaillant
      await d.ref.set({ statut: 'defaillant' }, { merge: true });
    } else if (joursRest <= 7) {
      gravite = 'warn';
      message = `🟠 ÉCHÉANCE PROCHE : engagement "${e.objet}" (${e.montantRestant}$ à rembourser) — ${joursRest} jour(s) restant(s).`;
    }

    if (gravite) {
      const alerteId = `eng-${d.id}-${aujourdhui}`;
      await db.collection('alertes').doc(alerteId).set({
        type: 'engagement-echeance',
        message, gravite,
        metadata: {
          engagementId: d.id,
          beneficiaire: e.beneficiaire,
          objet: e.objet,
          montantRestant: e.montantRestant,
          dateEcheance: ech.toISOString(),
          joursRestants: joursRest
        },
        resolue: false,
        timestamp: FieldValue.serverTimestamp()
      });
      console.log(`  [${gravite}] ${e.beneficiaire} ${e.objet} : ${joursRest}j`);
    }
  }
});

// Cron horaire : check intégrité Dashboard, restaure si écrasé par Apps Script
//
// Le Sheet user a un trigger Apps Script qui appelle creerDashboard() toutes
// les heures et écrase le visuel pro. Plutôt que demander au patron de
// désactiver son trigger manuellement, on met en place une garde côté serveur :
//   - Cron à H:02 chaque heure (laisse 2 min à l'Apps Script de finir)
//   - Lit la cellule A1 du Dashboard
//   - Si elle ne contient PAS notre titre signature → on régénère
//   - Sinon → skip (aucun refresh, pas de gêne visuelle pour le patron)
//
// Bénéfice : le patron voit l'ancien Dashboard max 2 min/heure si l'Apps
// Script tourne, sinon zéro refresh.
const SIGNATURE_DASHBOARD = '🤠 LTD LITTLE SEOUL';

export const dashboardKeepAlive = onSchedule({
  // Check toutes les minutes mais ne RÉGÉNÈRE QUE si l'Apps Script a écrasé
  // (= si la cellule A1 ne contient plus notre signature). En pratique : la
  // lecture A1 est instantanée et gratuite, donc 60 reads/heure c'est rien.
  // Si écrasement → restauration dans la minute. Si tout est bon → zéro action.
  schedule: 'every 1 minutes',
  timeZone: 'Europe/Paris',
  region: 'europe-west1',
  secrets: [DASHBOARD_SA_KEY],
  timeoutSeconds: 120,
  memory: '512MiB'
}, async () => {
  try {
    const sheets = getSheetsClient();
    // Lit la cellule A1 du Dashboard
    const SHEET_ID = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';
    const DASHBOARD_NAME = '📊 Dashboard';
    let cellA1 = '';
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${DASHBOARD_NAME}!A1`
      });
      cellA1 = (resp.data.values?.[0]?.[0] || '').toString();
    } catch (e) {
      console.error('[dashboardKeepAlive] read A1 error:', e.message);
      return;
    }
    if (cellA1.includes(SIGNATURE_DASHBOARD)) {
      console.log(`[dashboardKeepAlive] Dashboard intact (A1="${cellA1.slice(0, 40)}…") — skip`);
      return;
    }
    // Écrasé par Apps Script → régénère
    console.log(`[dashboardKeepAlive] Dashboard ÉCRASÉ (A1="${cellA1.slice(0, 40)}…") — régénération`);
    const result = await regenererDashboard({ db, sheets });
    console.log(`[dashboardKeepAlive] Restauré : ${result.rowCount} lignes`);
  } catch (e) {
    console.error('[dashboardKeepAlive] error:', e.message);
    throw e;
  }
});

// Clôture manuelle de la semaine (après dimanche 23h59 + confirm IRS)
//
// Workflow patron :
//   1. Patron fait sa déclaration fiscale sur le site IRS (externe)
//   2. Revient sur le site LTD → page Compta → bouton "🔒 Clôturer la semaine"
//   3. Modal confirmation : checkbox "J'ai bien soumis ma déclaration IRS"
//   4. Si checkbox cochée + on est après dimanche 23h59 → semaine clôturée
//   5. Dashboard se met à jour (chiffres figés dans /semaines)
//
// Restrictions :
//   - Direction uniquement
//   - Ne peut clôturer que la semaine PRÉCÉDENTE (= déjà finie)
//   - Doit avoir confirmationIRS=true dans le payload
export const cloturerSemaine = onRequest({
  region: 'europe-west1',
  cors: true,
  secrets: [DASHBOARD_SA_KEY],
  timeoutSeconds: 60
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    const { uid, caller } = await requireDirection(req);
    const { confirmationIRS, noteCloture } = req.body || {};
    if (confirmationIRS !== true) {
      return res.status(400).json({ error: 'Tu dois confirmer que ta déclaration IRS a été faite avant de clôturer.' });
    }

    // Calcule la semaine à clôturer = la semaine qui vient de finir
    // (lundi → dimanche, fin = dimanche 23:59:59.999 le plus récent passé)
    // TIMEZONE: Cloud Functions tournent en UTC mais la semaine RP est en heure
    // Paris (Europe/Paris, UTC+1 hiver, UTC+2 ete). Sans correction, un click
    // a 01h Paris (= 23h UTC dimanche en ete) ferait croire qu'on est encore
    // dimanche avant 23h59 et rejetterait la cloture du lundi matin.
    const now = new Date();

    // 1. Convertit "now UTC" en "horloge Paris exprimee comme UTC" pour pouvoir
    //    utiliser getUTC*() afin de lire les valeurs Paris.
    function toParisWall(d) {
      const s = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false });
      return new Date(s.replace(' ', 'T') + 'Z'); // ex: "2026-05-18T01:19:06Z"
    }
    // 2. Inverse : prend une "horloge Paris en UTC" et renvoie le vrai instant UTC.
    //    Itere une fois pour gerer le DST autour du moment cible.
    function parisWallToUtc(parisWall) {
      let utc = new Date(parisWall.getTime() - 60 * 60 * 1000);
      for (let i = 0; i < 3; i++) {
        const wall = toParisWall(utc);
        const drift = parisWall.getTime() - wall.getTime();
        if (Math.abs(drift) < 1000) break;
        utc = new Date(utc.getTime() + drift);
      }
      return utc;
    }

    const nowParis = toParisWall(now);
    const dayParis = nowParis.getUTCDay();
    const hourParis = nowParis.getUTCHours();
    const minuteParis = nowParis.getUTCMinutes();

    // Check : si on est dimanche Paris avant 23h59 -> rejet
    if (dayParis === 0 && (hourParis < 23 || (hourParis === 23 && minuteParis < 59))) {
      return res.status(400).json({
        error: 'Tu ne peux pas clôturer une semaine avant dimanche 23h59 (heure Paris). La semaine en cours se termine à la fin du dimanche.'
      });
    }

    // Recule jusqu'au dernier dimanche 23:59:59.999 PARIS
    const finParisWall = new Date(nowParis);
    const diffJours = dayParis === 0 ? 0 : dayParis; // lundi (1) -> -1j etc.
    finParisWall.setUTCDate(finParisWall.getUTCDate() - diffJours);
    finParisWall.setUTCHours(23, 59, 59, 999);
    // Et le lundi correspondant a 00:00:00.000 PARIS
    const debutParisWall = new Date(finParisWall);
    debutParisWall.setUTCDate(debutParisWall.getUTCDate() - 6);
    debutParisWall.setUTCHours(0, 0, 0, 0);

    // weekKey base sur la date Paris du lundi (YYYY-MM-DD)
    const weekKey = debutParisWall.toISOString().slice(0, 10);

    // Reconvertit en vraies dates UTC pour requeter Firestore
    const debutSemainePassee = parisWallToUtc(debutParisWall);
    const finSemainePassee   = parisWallToUtc(finParisWall);

    // Fenetre PAIE : lundi-S 02h00 -> lundi-S+1 02h00 Paris (decalee de 2h).
    // Couvre les 2 cas :
    //  - Paies versees dans la semaine S apres 02h (dim soir ~23h pre-cloture) — nouveau process.
    //  - Paies versees dans le creneau accelere post-S (lun-S+1 00h-02h) — legacy.
    // EXCLUT explicitement les paies lun-S 00h-02h car celles-ci sont des paies
    // S-1 versees en creneau accelere (cf. clarification user 25/05 : "les paies
    // 18/05 00h-02h c'est mon ancien fonctionnement, elles vont en S20").
    // Toute paie versee apres lun-S+1 02h appartient a S+1 (cap dur).
    // Patch 2026-05-25 v3 : fenetre decalee de +2h pour exclure creneau S-1.
    const debutFenetrePaie = new Date(debutSemainePassee.getTime() + 2 * 3600 * 1000);
    const finCreneauAccelere = new Date(finSemainePassee.getTime() + 1 + 2 * 3600 * 1000);
    const finFenetrePaie = now < finCreneauAccelere ? now : finCreneauAccelere;

    // Agrège les chiffres de la semaine
    const [ventesSnap, redistSnap, depensesSnap, paiesSnap] = await Promise.all([
      db.collection('ventes')
        .where('timestamp', '>=', Timestamp.fromDate(debutSemainePassee))
        .where('timestamp', '<=', Timestamp.fromDate(finSemainePassee)).get(),
      db.collection('redistributions')
        .where('timestamp', '>=', Timestamp.fromDate(debutSemainePassee))
        .where('timestamp', '<=', Timestamp.fromDate(finSemainePassee)).get(),
      db.collection('depenses')
        .where('timestamp', '>=', Timestamp.fromDate(debutSemainePassee))
        .where('timestamp', '<=', Timestamp.fromDate(finSemainePassee)).get(),
      db.collection('paies')
        .where('timestamp', '>=', Timestamp.fromDate(debutFenetrePaie))
        .where('timestamp', '<=', Timestamp.fromDate(finFenetrePaie)).get()
    ]);

    // Filtre = source='discord' (bot Faab'Hook) + !annulee.
    // STRICTEMENT identique a snapshotSheetSemaine ligne 543-545. Sans ce filtre,
    // les declarations manuelles du site doublonnent le CA (cf. bug S21 : Sheet
    // 309631 vs reel 154601). NE PAS ajouter !v.cachee : les ventes "cachees"
    // sont en fait des ventes du bot matchees avec une declaration manuelle, et
    // restent valides pour l'audit IRS.
    const ventes = ventesSnap.docs.map(d => d.data())
      .filter(v => v.source === 'discord' && !v.annulee);
    // Exclut du CA les entrées classées hors 'vente' (dons/subventions/autres).
    const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente';
    const caProduits = ventes.reduce((s, v) => s + (estVenteCA(v) ? (v.montant || 0) : 0), 0);
    const caCarburant = redistSnap.docs.reduce((s, d) => s + (Number(d.data().montant) || 0), 0);
    const ca = caProduits + caCarburant;
    const beneficeBrut = ventes.reduce((s, v) => s + (estVenteCA(v) ? (v.benefice || 0) : 0), 0);
    // Entrées classées hors 'vente' (don reçu, subvention, autre) — hors CA, à part.
    const entreesFiscales = {};
    ventes.forEach(v => { const c = v.categorieFiscale; if (c && c !== 'vente') entreesFiscales[c] = (entreesFiscales[c] || 0) + (Number(v.montant) || 0); });
    const donsRecus = entreesFiscales['don-recu'] || 0;
    const depReelles = depensesSnap.docs.map(d => d.data()).filter(d => d.type !== 'paie' && d.type !== 'impot-paye'); // exclut paies + paiement d'impot (hors assiette)
    const depTotal = depReelles.reduce((s, d) => s + (d.montant || 0), 0);
    const dedu = deductiblesAvecPlafondHonoraires(depReelles);
    const masseSalariale = paiesSnap.docs.reduce((s, d) => s + (d.data().montant || 0), 0);
    const beneficeNet = ca - depTotal - masseSalariale;

    // Tag les paies ramassees avec weekKeyAttribuee pour qu'elles soient
    // exclues des KPI "cette semaine" (W19) sur dashboard/rh/compta/banque.
    // Sans ce tag, les paies versees lundi 00h-01h pour W18 polluent W19.
    // GARDE : on ne re-tag QUE les paies sans rattachement existant. Une paie deja
    // rattachee manuellement a une autre semaine (ex. paie versee en retard et
    // rattachee a S-1) NE doit PAS etre volee par la cloture de la semaine en cours.
    if (paiesSnap.size > 0) {
      const batchTag = db.batch();
      let nTag = 0;
      paiesSnap.docs.forEach(d => { if (!d.data().weekKeyAttribuee) { batchTag.update(d.ref, { weekKeyAttribuee: weekKey }); nTag++; } });
      if (nTag > 0) await batchTag.commit();
    }

    await db.collection('semaines').doc(weekKey).set({
      numero: weekKey,
      dateDebut: Timestamp.fromDate(debutSemainePassee),
      dateFin:   Timestamp.fromDate(finSemainePassee),
      ca, caProduits, caCarburant,
      donsRecus, entreesFiscales,
      beneficeBrut,
      depenses: depTotal,
      depensesTotales: depTotal,
      chargesDeductibles: dedu,
      masseSalariale,
      beneficeNet,
      nbVentes: ventes.length + redistSnap.size,
      nbDepenses: depReelles.length,
      statut: 'cloturee-manuelle',
      clotureManuelle: true,
      confirmationIRS: true,
      cloturePar: uid,
      cloturParNom: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
      dateClotureManuelle: FieldValue.serverTimestamp(),
      noteCloture: noteCloture || '',
      fenetrePaieDebut: Timestamp.fromDate(debutFenetrePaie),
      fenetrePaieFin: Timestamp.fromDate(finFenetrePaie)
    }, { merge: true });

    // === Snapshot estimations paies (Option B 2026-05-18) ===
    // Mirror du cron clotureHebdo : fige les estimations par employe au
    // moment de la cloture manuelle. Idempotent. Try/catch englobant.
    try {
      const snapRes = await snapshotPaiesEstimees({
        db, FieldValue, Timestamp,
        weekKey,
        debut: debutSemainePassee,
        fin: finSemainePassee
      });
      console.log('[cloturerSemaine] snapshot paies estimees:', snapRes);
    } catch (e) {
      console.error('[cloturerSemaine] snapshotPaiesEstimees error:', e?.message || e);
    }

    // === Snapshot onglet Sheet semaine (audit IRS, fige) ===
    // Cree l'onglet dedie "Semaine N (jj-jj mois aaaa)" avec recap KPI +
    // tables ventes/depenses/paies. Idempotent. Try/catch englobant.
    try {
      const sheets = getSheetsClient();
      const snapSheetRes = await snapshotSheetSemaine({
        db, sheets, weekKey,
        weekDebut: debutSemainePassee,
        weekFin: finSemainePassee,
        semaineData: {
          ca, caProduits, caCarburant,
          beneficeBrut,
          depenses: depTotal,
          depensesTotales: depTotal,
          chargesDeductibles: dedu,
          masseSalariale,
          beneficeNet,
          nbVentes: ventes.length + redistSnap.size,
          nbDepenses: depReelles.length,
          statut: 'cloturee-manuelle'
        }
      });
      console.log('[cloturerSemaine] snapshot sheet semaine:', snapSheetRes);
    } catch (e) {
      console.error('[cloturerSemaine] snapshotSheetSemaine error:', e?.message || e);
    }

    // Refresh Dashboard tant qu'on y est
    try {
      const sheets = getSheetsClient();
      await regenererDashboard({ db, sheets });
      await forceRefreshImportData({ sheets });
    } catch (e) {
      console.error('[cloturerSemaine] refresh Dashboard error:', e.message);
    }

    return res.status(200).json({
      ok: true,
      weekKey,
      ca, beneficeNet, masseSalariale,
      message: `Semaine ${weekKey} clôturée manuellement par ${caller.prenom || ''} ${caller.nom || ''}.`
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.error });
    console.error('[cloturerSemaine] error:', e.message);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// ============================================================
// marquerPaieVersee — coche/decoche la case "Verse" sur /rh
// ============================================================
// Body : { snapshotId, paye: boolean, paieMatcheeId?: string|null }
// - snapshotId : id du doc /paiesEstimees/{weekKey}_{userId}
// - paye       : true (coche) ou false (decoche, reset)
// - paieMatcheeId : optionnel, id du doc /paies a lier (montant reel verse)
//
// Direction + DRH uniquement (la coche "Verse" est un acte de direction).
// Idempotent : ecrire paye:true 2x ne pose pas de probleme.
export const marquerPaieVersee = onRequest({
  region: 'europe-west1',
  cors: true,
  timeoutSeconds: 30
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  try {
    // requireDirection est strict (patron/co-patron/admin-tech) — on autorise
    // aussi le DRH ici puisqu'il pilote la RH (lecture /paies deja autorisee
    // par les rules pour lui).
    const authHeader = req.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    const decoded = await adminAuth.verifyIdToken(idToken);
    const callerSnap = await db.collection('users').doc(decoded.uid).get();
    if (!callerSnap.exists) return res.status(403).json({ error: 'Caller profile not found' });
    const caller = callerSnap.data();
    const role = caller.role || '';
    if (!['patron', 'co-patron', 'drh', 'admin-technique'].includes(role)) {
      return res.status(403).json({ error: 'Direction ou DRH uniquement' });
    }

    const { snapshotId, paye, paieMatcheeId } = req.body || {};
    if (!snapshotId || typeof snapshotId !== 'string') {
      return res.status(400).json({ error: 'snapshotId requis' });
    }
    if (typeof paye !== 'boolean') {
      return res.status(400).json({ error: 'paye (boolean) requis' });
    }

    const ref = db.collection('paiesEstimees').doc(snapshotId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Snapshot introuvable' });

    const update = {
      paye,
      majPar: decoded.uid,
      majParNom: `${caller.prenom || ''} ${caller.nom || ''}`.trim(),
      dateMaj: FieldValue.serverTimestamp()
    };

    if (paye) {
      update.datePaiement = FieldValue.serverTimestamp();
      // Si une paie est liee, on enregistre son id + son montant pour audit.
      if (paieMatcheeId && typeof paieMatcheeId === 'string') {
        const paieSnap = await db.collection('paies').doc(paieMatcheeId).get();
        if (!paieSnap.exists) {
          return res.status(400).json({ error: 'paieMatcheeId introuvable dans /paies' });
        }
        update.paieMatcheeId = paieMatcheeId;
        update.paieMatcheeMontant = Number(paieSnap.data().montant) || 0;
      } else {
        // paye=true sans paie liee : ok (le patron a verse en cash IG sans
        // que le bot ait remonte le log).
        update.paieMatcheeId = null;
        update.paieMatcheeMontant = null;
      }
    } else {
      // decoche : reset des champs paiement
      update.datePaiement = null;
      update.paieMatcheeId = null;
      update.paieMatcheeMontant = null;
    }

    await ref.set(update, { merge: true });
    return res.status(200).json({ ok: true, snapshotId, paye });
  } catch (e) {
    console.error('[marquerPaieVersee] error:', e?.message || e);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});

