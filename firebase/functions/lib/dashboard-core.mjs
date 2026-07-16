// ============================================================
// Module : Dashboard Compta — visuel pro (réutilisable)
// ============================================================
// Importé depuis :
//   - Script CLI scripts/refaire-dashboard-pro.js (auth via keyFile)
//   - Cloud Function refreshDashboardCron (auth via secret Firebase)
//
// Exporte : regenererDashboard({ db, sheets }) — recalcule depuis
// Firestore et applique au Google Sheet.
// ============================================================

import { Timestamp } from 'firebase-admin/firestore';

export const SHEET_ID = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';
export const DASHBOARD_NAME = '📊 Dashboard';

// ============================================================
// Couleurs LTD (palette western/saloon)
// ============================================================
const C = {
  blood:  { red: 0.545, green: 0,     blue: 0     }, // #8B0000 sang
  blood2: { red: 0.70,  green: 0.10,  blue: 0.10  }, // rouge plus clair
  bone:   { red: 0.961, green: 0.941, blue: 0.91  }, // #F5F0E8 ivoire
  bone2:  { red: 0.98,  green: 0.97,  blue: 0.95  }, // ivoire clair
  gold:   { red: 0.788, green: 0.663, blue: 0.380 }, // #c9a961 doré
  gold2:  { red: 0.92,  green: 0.85,  blue: 0.60  }, // doré clair
  green:  { red: 0.29,  green: 0.49,  blue: 0.18  }, // #4a7c2e
  greenL: { red: 0.85,  green: 0.95,  blue: 0.80  }, // vert clair
  orange: { red: 0.79,  green: 0.50,  blue: 0.10  }, // #c97f1a
  orangeL:{ red: 1.00,  green: 0.93,  blue: 0.78  }, // orange pâle
  blue:   { red: 0.29,  green: 0.42,  blue: 0.54  }, // #4a6b8a
  blueL:  { red: 0.85,  green: 0.90,  blue: 0.96  }, // bleu pâle
  red:    { red: 0.79,  green: 0.20,  blue: 0.20  },
  redL:   { red: 1.00,  green: 0.85,  blue: 0.82  },
  white:  { red: 1, green: 1, blue: 1 },
  black:  { red: 0, green: 0, blue: 0 },
  gray:   { red: 0.45, green: 0.45, blue: 0.45 },
  grayL:  { red: 0.92, green: 0.92, blue: 0.92 }
};

// ============================================================
// Helpers data
// ============================================================
function money(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('fr-FR') + ' $';
}
function pct(num, den, fixed = 1) {
  if (!den) return '—';
  return ((num / den) * 100).toFixed(fixed) + ' %';
}

function startOfWeekRP() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
// Numéro ISO 8601 + label semaine (utilisé pour afficher "S20 2026" plutôt
// que le weekKey brut "2026-05-11").
function weekIsoNumber(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
function weekIsoLabel(weekKey, { full = false } = {}) {
  if (!weekKey) return '';
  const lundi = new Date(String(weekKey) + 'T00:00:00');
  if (isNaN(lundi.getTime())) return String(weekKey);
  const num = weekIsoNumber(lundi);
  const annee = lundi.getFullYear();
  if (!full) return `S${num} ${annee}`;
  const dim = new Date(lundi);
  dim.setDate(dim.getDate() + 6);
  const fmt = (dt) => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
  return `S${num} ${annee} (${fmt(lundi)} → ${fmt(dim)})`;
}
function endOfWeekRP() {
  const d = startOfWeekRP();
  d.setDate(d.getDate() + 7);
  d.setMilliseconds(-1);
  return d;
}

// Tranches d'imposition TTE Art. 4-3.2 (sur bénéfice)
function tranchesImpot(benefice) {
  if (benefice <= 10000)  return { tranche: 0, taux: 0,    montant: 0 };
  if (benefice <= 50000)  return { tranche: 1, taux: 0.10, montant: Math.round(benefice * 0.10) };
  if (benefice <= 100000) return { tranche: 2, taux: 0.19, montant: Math.round(benefice * 0.19) };
  if (benefice <= 250000) return { tranche: 3, taux: 0.28, montant: Math.round(benefice * 0.28) };
  if (benefice <= 500000) return { tranche: 4, taux: 0.36, montant: Math.round(benefice * 0.36) };
  return { tranche: 5, taux: 0.46, montant: Math.round(benefice * 0.46) };
}

// ============================================================
// Construction des données Dashboard
// ============================================================
async function chargerDonnees(db) {
  const debut = startOfWeekRP();
  const fin   = endOfWeekRP();

  // Ventes semaine
  const ventesSnap = await db.collection('ventes')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  const ventes = ventesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.cachee);

  // Dépenses semaine (hors paies)
  const depSnap = await db.collection('depenses')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  const depensesAll = depSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const depenses = depensesAll.filter(d => d.type !== 'paie');

  // Paies semaine.
  // Exclut les paies tagguées weekKeyAttribuee != weekKey courant (versées
  // lundi matin pour la semaine précédente clôturée). Sinon on pollue le
  // bénéfice net de la semaine en cours avec les paies de la précédente.
  const weekKeyCourant = `${debut.getFullYear()}-${String(debut.getMonth()+1).padStart(2,'0')}-${String(debut.getDate()).padStart(2,'0')}`;
  const paiesSnap = await db.collection('paies')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .orderBy('timestamp', 'desc')
    .get();
  const paies = paiesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => !p.weekKeyAttribuee || p.weekKeyAttribuee === weekKeyCourant);

  // Redistributions essence (CA carburant)
  const redisSnap = await db.collection('redistributions')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .get();
  const redis = redisSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Semaines clôturées (historique)
  const semSnap = await db.collection('semaines')
    .orderBy('numero', 'desc')
    .limit(10)
    .get();
  const semaines = semSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Cumul historique (toutes semaines clôturées présentes en base)
  // — utilisé pour le KPI "Bénéfice net cumulé depuis reprise".
  const semClosedSnap = await db.collection('semaines')
    .where('statut', 'in', ['cloturee', 'cloturee-partielle', 'cloturee-manuelle'])
    .get();
  let cumulBeneficeNet = 0;
  let cumulCa = 0;
  let nbSemainesCloturees = 0;
  for (const d of semClosedSnap.docs) {
    const s = d.data();
    cumulBeneficeNet += Number(s.beneficeNet) || Number(s.benefice) || 0;
    cumulCa += Number(s.ca) || 0;
    nbSemainesCloturees += 1;
  }

  // Subventions reçues semaine (Art. 4-2.16 — non imposable, remboursable via contrat)
  // Captées via /banqueLtd où categorieEntree='subvention' (marqué manuellement
  // par le patron via le script marquer-subvention.js ou la modale admin).
  const subSnap = await db.collection('banqueLtd')
    .where('timestamp', '>=', Timestamp.fromDate(debut))
    .where('timestamp', '<=', Timestamp.fromDate(fin))
    .get();
  const subventions = subSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.categorieEntree === 'subvention');
  const totalSubventions = subventions.reduce((s, b) => s + (Number(b.montant) || 0), 0);

  // Solde banque LTD courant (le plus récent)
  let soldeBanque = 0;
  const dernierSnap = await db.collection('banqueLtd')
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();
  if (!dernierSnap.empty) {
    soldeBanque = Number(dernierSnap.docs[0].data().soldeApres) || 0;
  }

  // Engagements de remboursement actifs (subventions à rembourser, dettes…)
  const engSnap = await db.collection('engagements')
    .where('statut', '==', 'actif')
    .get();
  const engagements = engSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const totalDettesRestantes = engagements.reduce((s, e) => s + (Number(e.montantRestant) || 0), 0);

  // Calculs
  const caProduits  = ventes.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montant || 0) : 0), 0); // dons/subventions hors CA
  const caCarburant = redis.reduce((s, r) => s + (Number(r.montant) || 0), 0);
  const caTotal     = caProduits + caCarburant;
  const totalDep    = depenses.reduce((s, d) => s + (d.montant || 0), 0);
  const chargesDedu = depenses.filter(d => d.deductible !== false).reduce((s, d) => s + (d.montant || 0), 0);
  const chargesNonDedu = totalDep - chargesDedu;
  const masseSalariale = paies.reduce((s, p) => s + (p.montant || 0), 0);
  const resultatImposable = caTotal - chargesDedu;
  const beneficeNet = caTotal - totalDep - masseSalariale;
  const impot = tranchesImpot(beneficeNet > 0 ? beneficeNet : 0);
  const ratioMasseSal = caTotal > 0 ? (masseSalariale / caTotal) : 0;

  return {
    debut, fin,
    ventes, depenses, depensesAll, paies, redis, semaines,
    caProduits, caCarburant, caTotal,
    totalDep, chargesDedu, chargesNonDedu,
    masseSalariale, ratioMasseSal,
    resultatImposable, beneficeNet, impot,
    subventions, totalSubventions, soldeBanque,
    engagements, totalDettesRestantes,
    cumulBeneficeNet, cumulCa, nbSemainesCloturees
  };
}

// ============================================================
// Construction des lignes du Dashboard (values + formats)
// ============================================================
function buildDashboard(data) {
  const {
    debut, fin, ventes, depenses, semaines,
    caProduits, caCarburant, caTotal,
    totalDep, chargesDedu, chargesNonDedu,
    masseSalariale, ratioMasseSal,
    resultatImposable, beneficeNet, impot,
    subventions, totalSubventions, soldeBanque,
    engagements, totalDettesRestantes,
    cumulBeneficeNet, cumulCa, nbSemainesCloturees
  } = data;

  const maintenant = new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const weekKeyCourant = `${debut.getFullYear()}-${String(debut.getMonth()+1).padStart(2,'0')}-${String(debut.getDate()).padStart(2,'0')}`;
  const semainePeriode = `${weekIsoLabel(weekKeyCourant)} — du ${debut.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })} au ${fin.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`;

  // Layout 9 colonnes (A-I). Largeur Dashboard ~1200px.
  // Chaque "row" : tableau de 9 cellules (string OU null).
  // null = cellule vide (fusionnable).

  const rows = [];

  // === BANDEAU TITRE === (rows 1-3)
  rows.push(['🤠 LTD SANDY SHORES — TABLEAU DE BORD COMPTABLE', null, null, null, null, null, null, null, null]); // 1
  rows.push(['Conforme TTE Chapitre IV — Secteur 2 (Services et biens indispensables)', null, null, null, null, null, null, null, null]); // 2
  rows.push([semainePeriode + '  •  Généré le ' + maintenant, null, null, null, null, null, null, null, null]); // 3
  rows.push(['', '', '', '', '', '', '', '', '']); // 4 spacer

  // === KPIs LIGNE 1 === (rows 5-7) — 3 KPIs sur 3 colonnes chacun
  rows.push([
    '💚 CA SEMAINE', null, null,
    '❤ CHARGES DÉDUCTIBLES', null, null,
    '📋 RÉSULTAT IMPOSABLE', null, null
  ]); // 5 labels
  rows.push([
    money(caTotal), null, null,
    money(chargesDedu), null, null,
    money(resultatImposable), null, null
  ]); // 6 valeurs
  rows.push([
    `${ventes.length} factures · CA produits ${money(caProduits)} · ⛽ ${money(caCarburant)}`, null, null,
    `${depenses.filter(d => d.deductible !== false).length}/${depenses.length} dépenses dédu · non-dédu ${money(chargesNonDedu)}`, null, null,
    `Base = (CA + Autres) − Charges dédu (Art. 4-2.4)`, null, null
  ]); // 7 détails
  rows.push(['', '', '', '', '', '', '', '', '']); // 8 spacer

  // === KPIs LIGNE 2 === (rows 9-11)
  const masseLabel = ratioMasseSal <= 0.90 ? '🟢 OK' : '🔴 HORS TTE';
  rows.push([
    '💰 MASSE SALARIALE', null, null,
    '🎯 BÉNÉFICE NET', null, null,
    '🏛 IMPÔT ESTIMÉ', null, null
  ]); // 9
  rows.push([
    money(masseSalariale), null, null,
    money(beneficeNet), null, null,
    money(impot.montant), null, null
  ]); // 10
  rows.push([
    `${pct(masseSalariale, caTotal)} du CA · seuil TTE 90 % · ${masseLabel}`, null, null,
    `CA − dépenses − salaires versés · ${beneficeNet >= 0 ? 'positif' : '⚠ déficitaire'} (${pct(beneficeNet, caTotal)})`, null, null,
    `Tranche ${impot.tranche} · taux ${(impot.taux * 100).toFixed(0)} % (Art. 4-3.2)`, null, null
  ]); // 11
  rows.push(['', '', '', '', '', '', '', '', '']); // 12 spacer

  // === SUBVENTIONS & TRÉSORERIE === (rows 13-15) — toujours présent
  // Compense le bénéfice net négatif qui inquiète : la subvention couvre
  // les achats véhicules / matières premières liés à la reprise.
  rows.push([
    '🏛 SUBVENTIONS REÇUES', null, null,
    '💼 TRÉSORERIE BANQUE LTD', null, null,
    '📊 SOLDE OPÉRATIONNEL', null, null
  ]); // 13 labels
  rows.push([
    money(totalSubventions), null, null,
    money(soldeBanque), null, null,
    money(soldeBanque - totalSubventions), null, null
  ]); // 14 valeurs
  const subDetails = subventions.length > 0
    ? subventions.map(s => `+${money(s.montant)}`).join(' · ')
    : 'Aucune cette semaine';
  rows.push([
    `Non imposable (Art. 4-2.16) · ${subDetails}`, null, null,
    'Solde temps réel inclut subventions reçues', null, null,
    'Trésorerie hors subventions (activité pure)', null, null
  ]); // 15 détails
  rows.push(['', '', '', '', '', '', '', '', '']); // 16 spacer

  // === BÉNÉFICE NET CUMULÉ (depuis reprise) === (rows 17-19)
  // Bandeau full-width : ce que le LTD a réellement gagné/perdu net (toutes
  // semaines clôturées confondues, salaires compris).
  rows.push(['📈 BÉNÉFICE NET CUMULÉ — Ce que le LTD a réellement gagné depuis la reprise', null, null, null, null, null, null, null, null]); // 17 label
  rows.push([money(cumulBeneficeNet), null, null, null, null, null, null, null, null]); // 18 valeur
  const cumulDetail = nbSemainesCloturees > 0
    ? `${nbSemainesCloturees} semaine${nbSemainesCloturees > 1 ? 's' : ''} clôturée${nbSemainesCloturees > 1 ? 's' : ''} · CA cumulé ${money(cumulCa)} · Moyenne ${money(Math.round(cumulBeneficeNet / nbSemainesCloturees))} / semaine`
    : 'Aucune semaine clôturée pour le moment';
  rows.push([cumulDetail, null, null, null, null, null, null, null, null]); // 19 détail
  rows.push(['', '', '', '', '', '', '', '', '']); // 20 spacer

  // === ENGAGEMENTS DE REMBOURSEMENT (subventions, dettes…) ===
  rows.push(['📋 ENGAGEMENTS DE REMBOURSEMENT — Suivi des dettes', null, null, null, null, null, null, null, null]); // header
  rows.push(['Bénéficiaire', 'Objet', 'Montant initial', 'Remboursé', 'Restant', 'Échéance', 'Jours restants', 'Statut', null]); // sub-header

  if (engagements.length === 0) {
    rows.push(['—', 'Aucun engagement actif', null, null, null, null, null, null, null]);
  } else {
    for (const e of engagements) {
      const ech = e.dateEcheance?.toDate?.();
      const joursRest = ech ? Math.ceil((ech.getTime() - Date.now()) / (24 * 3600 * 1000)) : null;
      let statutLabel = '🟢 OK';
      if (joursRest != null) {
        if (joursRest < 0)       statutLabel = '🔴 EN RETARD';
        else if (joursRest <= 7) statutLabel = '🟠 ÉCHÉANCE PROCHE';
      }
      rows.push([
        e.beneficiaire || '—',
        e.objet || '—',
        money(e.montantInitial || 0),
        money(e.montantRembourse || 0),
        money(e.montantRestant || 0),
        ech ? ech.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '—',
        joursRest != null ? `${joursRest} j` : '—',
        statutLabel,
        null
      ]);
    }
  }
  rows.push(['', '', '', '', '', '', '', '', '']); // spacer

  // === CONFORMITÉ TTE — Échéances semaine ===
  // Refonte 2026-05-14 : on simplifie à 2 indicateurs vraiment lisibles
  // (masse salariale + échéances déclaration) au lieu de 4 lignes mélangées.
  rows.push(['📊 CONFORMITÉ TTE — Échéances de la semaine', null, null, null, null, null, null, null, null]);

  // Indicateur 1 : Masse salariale (le seul vraiment dynamique)
  const ratioMasseSalPct = caTotal > 0 ? Math.round((masseSalariale / caTotal) * 100) : 0;
  const masseStatut = ratioMasseSal <= 0.90
    ? `🟢 Conforme (${ratioMasseSalPct} % du CA, seuil ≤ 90 %)`
    : `🔴 DÉPASSEMENT TTE (${ratioMasseSalPct} % du CA, doit rester ≤ 90 %)`;
  rows.push(['Masse salariale', null, null, masseStatut, null, null, null, null, null]);

  // Indicateur 2 : Échéance déclaration fiscale (mardi 21h)
  const maintenantParis = new Date();
  const dayOfWeek = maintenantParis.getDay(); // 0=dim, 1=lun, 2=mar
  let statutDecla;
  if (dayOfWeek === 1) {
    statutDecla = '🟡 À soumettre AUJOURD\'HUI ou MARDI 21h max — site IRS';
  } else if (dayOfWeek === 2) {
    statutDecla = '🟠 ÉCHÉANCE AUJOURD\'HUI 21h — site IRS';
  } else if (dayOfWeek === 3) {
    statutDecla = '🔴 RETARD — soumettre IMMÉDIATEMENT (pénalité +10% par 24h)';
  } else if (dayOfWeek === 0) {
    statutDecla = '⏳ Semaine en cours, déclaration dès lundi';
  } else {
    statutDecla = '✓ Déclaration de la semaine N-1 normalement faite';
  }
  rows.push(['Déclaration fiscale (Art. 4-3.3)', null, null, statutDecla, null, null, null, null, null]);

  // Indicateur 3 : Paiement impôts (mercredi 21h)
  let statutPaiement;
  if (dayOfWeek === 3) {
    statutPaiement = '🟠 PAIEMENT IMPÔTS AUJOURD\'HUI 21h max';
  } else if (dayOfWeek >= 4 || dayOfWeek === 0) {
    statutPaiement = '✓ Délai impôts dépassé pour la semaine N-1';
  } else {
    statutPaiement = '✓ Délai paiement : mercredi 21h';
  }
  rows.push(['Paiement impôts (Art. 4-3.4)', null, null, statutPaiement, null, null, null, null, null]);

  rows.push(['', '', '', '', '', '', '', '', '']); // spacer

  // === 5 DERNIÈRES VENTES + 5 DERNIÈRES DÉPENSES === (côte à côte)
  rows.push(['💵 5 DERNIÈRES VENTES', null, null, null, '💸 5 DERNIÈRES DÉPENSES', null, null, null, null]); // header
  rows.push(['Date', 'Vendeur', 'Montant', null, 'Date', 'Raison', 'Montant', 'Type', null]); // sub-header

  const ventesSlice   = ventes.slice(0, 5);
  const depensesSlice = depenses.slice(0, 5);
  const maxRows = Math.max(ventesSlice.length, depensesSlice.length, 1);
  for (let i = 0; i < maxRows; i++) {
    const v = ventesSlice[i];
    const d = depensesSlice[i];
    // Pour les dépenses : afficher le FOURNISSEUR identifié plutôt que le N°
    // technique (ex: "HDM (Heavy Duty Motors)" au lieu de "Paiement facture N°1915056").
    // Fallback sur la raison brute si pas de fournisseur identifié.
    const depRaisonAffichee = d
      ? (d.fournisseurLabel
          ? `${d.fournisseurLabel}`
          : (d.raison || '—').slice(0, 35))
      : '';
    rows.push([
      v ? v.timestamp?.toDate?.()?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '' : '',
      v ? (v.vendeurNom || '—') : '',
      v ? money(v.montant) : '',
      null,
      d ? d.timestamp?.toDate?.()?.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '' : '',
      depRaisonAffichee,
      d ? money(d.montant) : '',
      d ? (d.type || '') : '',
      null
    ]);
  }
  rows.push(['', '', '', '', '', '', '', '', '']);

  // === HISTORIQUE SEMAINES ===
  rows.push(['📚 HISTORIQUE DES SEMAINES — Audit IRS', null, null, null, null, null, null, null, null]);
  rows.push(['Semaine', 'Date début', 'Date fin', 'CA', 'Dépenses', 'Masse salariale', 'Bénéfice net', 'Statut', null]);
  if (semaines.length === 0) {
    rows.push(['—', 'Aucune semaine clôturée pour le moment', null, null, null, null, null, null, null]);
  } else {
    for (const s of semaines) {
      // s.dateDebut/dateFin sont des Firestore Timestamp côté admin SDK :
      // toDate() d'abord, fallback parseable string en secours.
      const dDeb = s.dateDebut?.toDate?.() || (s.dateDebut ? new Date(s.dateDebut) : null);
      const dFin = s.dateFin?.toDate?.()   || (s.dateFin   ? new Date(s.dateFin)   : null);
      rows.push([
        weekIsoLabel(s.numero || s.id || ''),
        dDeb && !isNaN(dDeb.getTime()) ? dDeb.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '',
        dFin && !isNaN(dFin.getTime()) ? dFin.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : '',
        money(s.ca || 0),
        money(s.depensesTotales || s.depenses || 0),
        money(s.masseSalariale || 0),
        money(s.beneficeNet || 0),
        s.statut || 'cloturee',
        null
      ]);
    }
  }
  rows.push(['', '', '', '', '', '', '', '', '']);

  // === FOOTER AUDIT IRS (compact) ===
  rows.push(['🔎 Audit IRS — Détail dans onglets :  📁 Depenses  ·  📁 Ventes  ·  📁 Paies  ·  📁 resumé', null, null, null, null, null, null, null, null]);
  rows.push(['Dashboard généré depuis Firestore (source de vérité). Onglets sources : IMPORTDATA (refresh ~1h).', null, null, null, null, null, null, null, null]);

  return rows;
}

// ============================================================
// Construction des requêtes batchUpdate pour formatage
// ============================================================
function buildFormatRequests(sheetId, rows) {
  const reqs = [];
  const nbRows = rows.length;
  const nbCols = 9;

  // Reset général : tout en background blanc
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: nbRows, startColumnIndex: 0, endColumnIndex: nbCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.white,
          textFormat: { foregroundColor: C.black, fontSize: 10, bold: false },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP'
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)'
    }
  });

  // === BANDEAU TITRE (rows 0-2) ===
  // Ligne 0 : titre principal, fusion 9 cols, fond rouge sang + texte ivoire bold gros
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.blood,
          textFormat: { foregroundColor: C.bone, bold: true, fontSize: 18, fontFamily: 'Georgia' },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          padding: { top: 12, bottom: 12, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
    }
  });
  // Ligne 1 : sous-titre
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.blood2,
          textFormat: { foregroundColor: C.bone, italic: true, fontSize: 11 },
          horizontalAlignment: 'CENTER',
          padding: { top: 4, bottom: 4, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });
  // Ligne 2 : horodatage
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.gold,
          textFormat: { foregroundColor: C.black, fontSize: 10 },
          horizontalAlignment: 'CENTER',
          padding: { top: 3, bottom: 3, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });

  // === KPIs LIGNE 1 (rows 4-6) ===
  // Fusion 3 cols x 3 KPIs
  const kpiBlocks = [
    { col0: 0, color: C.greenL,  borderColor: C.green  }, // CA
    { col0: 3, color: C.redL,    borderColor: C.red    }, // Charges dédu
    { col0: 6, color: C.bone2,   borderColor: C.gold   }  // Résultat imposable
  ];
  for (const blk of kpiBlocks) {
    // Label (row 4)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.borderColor,
            textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            padding: { top: 6, bottom: 6 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Valeur (row 5)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.color,
            textFormat: { foregroundColor: C.black, bold: true, fontSize: 22, fontFamily: 'Georgia' },
            horizontalAlignment: 'CENTER',
            padding: { top: 14, bottom: 14 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Détail (row 6)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.color,
            textFormat: { foregroundColor: C.gray, fontSize: 9, italic: true },
            horizontalAlignment: 'CENTER',
            padding: { top: 3, bottom: 6 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
  }

  // === KPIs LIGNE 2 (rows 8-10) ===
  const kpiBlocks2 = [
    { col0: 0, color: C.orangeL, borderColor: C.orange }, // Masse salariale
    { col0: 3, color: C.blueL,   borderColor: C.blue   }, // Bénéfice net
    { col0: 6, color: C.gold2,   borderColor: C.gold   }  // Impôt estimé
  ];
  for (const blk of kpiBlocks2) {
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.borderColor,
            textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            padding: { top: 6, bottom: 6 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 9, endRowIndex: 10, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 9, endRowIndex: 10, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.color,
            textFormat: { foregroundColor: C.black, bold: true, fontSize: 22, fontFamily: 'Georgia' },
            horizontalAlignment: 'CENTER',
            padding: { top: 14, bottom: 14 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: blk.color,
            textFormat: { foregroundColor: C.gray, fontSize: 9, italic: true },
            horizontalAlignment: 'CENTER',
            padding: { top: 3, bottom: 6 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
  }

  // === SUBVENTIONS & TRÉSORERIE (rows 12-14) ===
  // 3 blocs côte à côte (subv / trésorerie / opérationnel)
  const subBlocks = [
    { col0: 0, color: C.gold2,  borderColor: C.gold }, // Subventions
    { col0: 3, color: C.blueL,  borderColor: C.blue }, // Trésorerie
    { col0: 6, color: C.greenL, borderColor: C.green } // Solde op
  ];
  for (const blk of subBlocks) {
    // Label (row 12)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.borderColor, textFormat: { foregroundColor: C.white, bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', padding: { top: 4, bottom: 4 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Valeur (row 13)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.color, textFormat: { foregroundColor: C.black, bold: true, fontSize: 16, fontFamily: 'Georgia' }, horizontalAlignment: 'CENTER', padding: { top: 8, bottom: 8 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Détail (row 14)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.color, textFormat: { foregroundColor: C.gray, fontSize: 9, italic: true }, horizontalAlignment: 'CENTER', padding: { top: 2, bottom: 4 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
  }

  // === BÉNÉFICE NET CUMULÉ (rows 16-18) === bandeau full-width 9 cols
  // Vert si positif, rouge si négatif (le LTD perd de l'argent net).
  // On infère le signe depuis la valeur déjà écrite en row 17 col 0 (string avec
  // espace insécable pour les milliers FR) plutôt que de re-passer data ici.
  const valeurCumul = String(rows[17]?.[0] || '');
  const cumulPositif = !valeurCumul.startsWith('-');
  const cumulBgValue   = cumulPositif ? C.greenL : C.redL;
  const cumulBgBorder  = cumulPositif ? C.green  : C.red;
  // Label (row 16)
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: cumulBgBorder, textFormat: { foregroundColor: C.white, bold: true, fontSize: 12 }, horizontalAlignment: 'CENTER', padding: { top: 6, bottom: 6 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });
  // Valeur (row 17) — gros chiffre
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: cumulBgValue, textFormat: { foregroundColor: C.black, bold: true, fontSize: 26, fontFamily: 'Georgia' }, horizontalAlignment: 'CENTER', padding: { top: 14, bottom: 14 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });
  // Détail (row 18)
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: cumulBgValue, textFormat: { foregroundColor: C.gray, fontSize: 10, italic: true }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 6 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });

  // === Section "CONFORMITÉ TTE" — header (row 20)
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 20, endRowIndex: 21, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 20, endRowIndex: 21, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.gold,
          textFormat: { foregroundColor: C.black, bold: true, fontSize: 12 },
          horizontalAlignment: 'LEFT',
          padding: { top: 6, bottom: 6, left: 10 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });

  // 3 lignes conformité (rows 21-23) : Label (cols A-C) | Statut texte (cols D-I)
  for (let r = 21; r <= 23; r++) {
    // Cols A-C : label (fusion)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', padding: { left: 12, top: 6, bottom: 6 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)'
      }
    });
    // Cols D-I : statut (fusion, texte large lisible)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 3, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 3, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { fontSize: 11 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', padding: { left: 8, top: 6, bottom: 6 } } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,padding)'
      }
    });
    // Bordure basse fine
    reqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 9 },
        bottom: { style: 'SOLID', width: 1, color: C.grayL }
      }
    });
  }

  // === 5 dernières ventes/dépenses === (indices dynamiques via findIndex)
  // Section "VENTES" : cols 0-3, section "DÉPENSES" : cols 4-8
  const idxVDheader = rows.findIndex(r => String(r[0]).includes('💵 5 DERNIÈRES VENTES'));
  if (idxVDheader >= 0) {
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxVDheader, endRowIndex: idxVDheader + 1, startColumnIndex: 0, endColumnIndex: 4 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxVDheader, endRowIndex: idxVDheader + 1, startColumnIndex: 0, endColumnIndex: 4 },
        cell: { userEnteredFormat: { backgroundColor: C.green, textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 }, horizontalAlignment: 'CENTER', padding: { top: 6, bottom: 6 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxVDheader, endRowIndex: idxVDheader + 1, startColumnIndex: 4, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxVDheader, endRowIndex: idxVDheader + 1, startColumnIndex: 4, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.red, textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 }, horizontalAlignment: 'CENTER', padding: { top: 6, bottom: 6 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Sub-header (ligne suivante)
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxVDheader + 1, endRowIndex: idxVDheader + 2, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 3 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Données ventes/dépenses : centrage horizontal
    const idxEngagementsData = rows.findIndex(r => String(r[0]).includes('📋 ENGAGEMENTS'));
    const idxHistoriqueData = rows.findIndex(r => String(r[0]).includes('📚 HISTORIQUE'));
    const finData = idxEngagementsData > idxVDheader ? idxEngagementsData : idxHistoriqueData;
    if (finData > idxVDheader + 2) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: idxVDheader + 2, endRowIndex: finData - 1, startColumnIndex: 0, endColumnIndex: 9 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { fontSize: 10 } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat)'
        }
      });
    }
  }

  // === Section "ENGAGEMENTS DE REMBOURSEMENT" ===
  const idxEngagements = rows.findIndex(r => String(r[0]).includes('📋 ENGAGEMENTS'));
  if (idxEngagements >= 0) {
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxEngagements, endRowIndex: idxEngagements + 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxEngagements, endRowIndex: idxEngagements + 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.red, textFormat: { foregroundColor: C.white, bold: true, fontSize: 12 }, horizontalAlignment: 'LEFT', padding: { top: 6, bottom: 6, left: 10 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Sub-header (colonnes)
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxEngagements + 1, endRowIndex: idxEngagements + 2, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 3 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Lignes data centrées (jusqu'à idxConformite-1)
    const idxConformite = rows.findIndex(r => String(r[0]).includes('📊 CONFORMITÉ TTE'));
    if (idxConformite > idxEngagements + 2) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: idxEngagements + 2, endRowIndex: idxConformite - 1, startColumnIndex: 0, endColumnIndex: 9 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { fontSize: 10 }, backgroundColor: C.redL } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat,backgroundColor)'
        }
      });
    }
  }

  // Header section historique
  const lastRow = rows.length;
  // Trouve la ligne de "📚 HISTORIQUE..."
  const idxHistorique = rows.findIndex(r => String(r[0]).includes('📚 HISTORIQUE'));
  if (idxHistorique >= 0) {
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxHistorique, endRowIndex: idxHistorique + 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxHistorique, endRowIndex: idxHistorique + 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.gold, textFormat: { foregroundColor: C.black, bold: true, fontSize: 12 }, horizontalAlignment: 'LEFT', padding: { top: 6, bottom: 6, left: 10 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Sub-header historique
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxHistorique + 1, endRowIndex: idxHistorique + 2, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 3 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });

    // Données historique (rows idxHistorique+2 jusqu'à audit) : centrage
    const idxAuditTmp = rows.findIndex(r => String(r[0]).includes('🔎 Audit IRS'));
    if (idxAuditTmp > idxHistorique + 2) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: idxHistorique + 2, endRowIndex: idxAuditTmp - 1, startColumnIndex: 0, endColumnIndex: 9 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { fontSize: 10 } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat)'
        }
      });
    }
  }

  // Footer AUDIT IRS (compact, 2 lignes discrètes)
  const idxAudit = rows.findIndex(r => String(r[0]).includes('🔎 Audit IRS'));
  if (idxAudit >= 0) {
    // Ligne 1 : liste des onglets — fond gris clair, texte gris foncé, petite police
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxAudit, endRowIndex: idxAudit + 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxAudit, endRowIndex: idxAudit + 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: C.grayL,
            textFormat: { foregroundColor: C.gray, bold: false, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            padding: { top: 3, bottom: 3 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Ligne 2 : note technique — encore plus discret
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: idxAudit + 1, endRowIndex: idxAudit + 2, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: idxAudit + 1, endRowIndex: idxAudit + 2, startColumnIndex: 0, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: C.white,
            textFormat: { foregroundColor: C.gray, fontSize: 8, italic: true },
            horizontalAlignment: 'CENTER',
            padding: { top: 2, bottom: 2 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
  }

  // Hauteurs de lignes
  // Titre principal grand
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 50 }, fields: 'pixelSize' } });
  // KPI valeurs grandes (rows 5, 9)
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } });
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } });
  // Subventions valeurs (row 13) - un peu plus petit que les KPIs principaux
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 13, endIndex: 14 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } });
  // Bénéfice net cumulé (row 17) — gros chiffre full-width
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 17, endIndex: 18 }, properties: { pixelSize: 70 }, fields: 'pixelSize' } });

  // Largeurs de colonnes
  for (let c = 0; c < nbCols; c++) {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: 130 },
        fields: 'pixelSize'
      }
    });
  }

  // Pas de quadrillage Google par défaut
  reqs.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { hideGridlines: true } },
      fields: 'gridProperties.hideGridlines'
    }
  });

  return reqs;
}

// ============================================================
// Fonction exportée : regenererDashboard({ db, sheets, verbose })
// ============================================================
// Lit les données Firestore, construit les lignes + formats, applique
// au Google Sheet. Retourne un résumé { rowCount, requestsCount, data }.
export async function regenererDashboard({ db, sheets, verbose = false }) {
  if (verbose) console.log('1. Chargement des données Firestore...');
  const data = await chargerDonnees(db);
  if (verbose) {
    console.log(`   ${data.ventes.length} ventes, ${data.depenses.length} dépenses, ${data.paies.length} paies, ${data.semaines.length} semaines clôturées`);
    console.log(`   CA ${money(data.caTotal)} · Charges dédu ${money(data.chargesDedu)} · Bénéfice ${money(data.beneficeNet)} · Impôt ${money(data.impot.montant)}`);
  }

  const rows = buildDashboard(data);
  if (verbose) console.log(`2. Construction du Dashboard : ${rows.length} lignes`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, includeGridData: false });
  const ong = (meta.data.sheets || []).find(s => s.properties.title === DASHBOARD_NAME);
  if (!ong) throw new Error(`Onglet "${DASHBOARD_NAME}" introuvable`);
  const sheetId = ong.properties.sheetId;

  if (verbose) console.log('3. Effacement contenu et fusions existantes...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 26 } } },
        { updateCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 26 },
            fields: 'userEnteredValue,userEnteredFormat'
        } }
      ]
    }
  });

  if (verbose) console.log('4. Écriture des valeurs...');
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${DASHBOARD_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows.map(r => r.map(c => c == null ? '' : c)) }
  });

  if (verbose) console.log('5. Application des formats...');
  const formatReqs = buildFormatRequests(sheetId, rows);
  const BATCH = 30;
  for (let i = 0; i < formatReqs.length; i += BATCH) {
    const slice = formatReqs.slice(i, i + BATCH);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: slice }
    });
    if (verbose) process.stdout.write(`   ${Math.min(i + BATCH, formatReqs.length)}/${formatReqs.length}\r`);
  }
  if (verbose) console.log(`\n✓ Dashboard refait : ${rows.length} lignes, ${formatReqs.length} requests appliquées`);

  return { rowCount: rows.length, requestsCount: formatReqs.length, data };
}
