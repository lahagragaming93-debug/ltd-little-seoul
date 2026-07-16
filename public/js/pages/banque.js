// ============================================================
// Page : Banque LTD — historique chronologique des mouvements
// (entrées xbankaccount + sorties #depenses combinées)
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listMouvementsBanqueRecents, listDepensesSemaine, listVentesSemaine, listRedistributionsSemaine } from '../api.js';
import { db } from '../firebase-config.js';
import { collection, query, orderBy, limit, getDocs, where, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { money, moneyPrecis, num, datetime, escapeHtml, dateKeyLocal } from '../utils/formatters.js';
import { isDirection, isSuperAdmin } from '../utils/permissions.js';
import { toastError } from '../utils/toast.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { renderPeriodFilter, getPeriode, getPeriodeLabel, attachPeriodFilter } from '../utils/period-filter.js';

const { profile } = await requireAuth('banque');

const html = `
  <div class="kpi-grid" id="kpis-banque">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="page-toolbar" style="flex-wrap:wrap;gap:8px;">
    ${renderPeriodFilter('semaine')}
    <select id="filtre-type" title="Filtrer par type de mouvement">
      <option value="">Tous types</option>
      <option value="add">Entrées</option>
      <option value="remove">Sorties</option>
    </select>
    <input type="text" id="filtre-recherche" placeholder="Filtrer par raison…" style="flex:1;min-width:160px;" />
    <button class="btn" id="btn-recharger" title="Recharger les données" data-tooltip="Recharger">Recharger</button>
    <button class="btn" id="btn-export" title="Exporter en CSV" data-tooltip="Export CSV">Exporter CSV</button>
    <span class="spacer"></span>
    <span class="muted mono" id="stats-mvts">—</span>
  </div>

  <div class="panel framed">
    <div class="panel-title">
      <span>Mouvements bancaires LTD</span>
      <span class="muted" style="font-size:0.75rem;">— combinés : xbankaccount + #depenses, ordre chronologique décroissant</span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-mvts">
        <thead>
          <tr>
            <th data-sort="date">Date</th>
            <th class="center" data-sort="type">Type</th>
            <th class="right" data-sort="montant">Montant</th>
            <th class="right" data-sort="soldeAvant">Solde avant</th>
            <th class="right" data-sort="soldeApres">Solde après</th>
            <th data-sort="raison">Raison</th>
            <th data-sort="source">Source</th>
          </tr>
        </thead>
        <tbody id="tbody-mvts"><tr><td colspan="7" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>
`;
renderShell(profile, 'banque', html);

makeSortable(document.getElementById('table-mvts'));

let mouvements = []; // [{ timestamp, type, montant, soldeAvant, soldeApres, raison, source, utilisateur }, …]
let soldeLive = { montant: 0, date: null }; // toujours le solde courant, indépendant du filtre période
let ventesPeriode = []; // ventes /ventes sur la periode (toutes methodes de paiement)
let redistribPeriode = []; // ventes essence /redistributions sur la periode (carte NPC + cash manuel)

async function chargerTout() {
  const tbody = document.getElementById('tbody-mvts');
  tbody.innerHTML = '<tr><td colspan="7" class="muted text-center">Chargement…</td></tr>';
  try {
    const { debut, fin } = getPeriode();

    // v1.11.1 (perf CEF) : on parallelise les 3 queries banque (solde live +
    // banqueLtd periode + depenses periode) au lieu de les enchainer
    // sequentiellement, ce qui faisait ~600-900 ms cumules sur tablette
    // in-game.
    // Limites separees /banqueLtd vs /depenses :
    //   - /banqueLtd contient TOUTES les operations xbankaccount (add+remove,
    //     dont les "Redistribution N°XXXX" essence => tres volumineux).
    //     Limite 10000 (large safety ceiling). En pratique limite naturelle
    //     par l'archivage automatique a 6 semaines (cf. Cloud Function
    //     archiveBanqueLtdAnciens).
    //   - /depenses ne contient QUE des sorties categorisees (paiements,
    //     achats), volume bien plus faible (~50-100/sem) : 800
    const limBanque   = 10000;
    const limDepenses = (debut && fin) ? 800 : 2000;
    const liveQ = query(collection(db, 'banqueLtd'), orderBy('timestamp', 'desc'), limit(1));
    const banqueQ = (debut && fin)
      ? query(collection(db, 'banqueLtd'),
          where('timestamp', '>=', Timestamp.fromDate(debut)),
          where('timestamp', '<=', Timestamp.fromDate(fin)),
          orderBy('timestamp', 'desc'),
          limit(limBanque))
      : query(collection(db, 'banqueLtd'), orderBy('timestamp', 'desc'), limit(limBanque));
    const depQ = (debut && fin)
      ? query(collection(db, 'depenses'),
          where('timestamp', '>=', Timestamp.fromDate(debut)),
          where('timestamp', '<=', Timestamp.fromDate(fin)),
          orderBy('timestamp', 'desc'),
          limit(limDepenses))
      : query(collection(db, 'depenses'), orderBy('timestamp', 'desc'), limit(limDepenses));

    // Recettes commerciales sur la periode (pour le KPI "Recettes totales") :
    //   - /ventes : ventes epicerie validees par les logs (toutes methodes)
    //   - /redistributions : ventes essence (NPC carte + cash/manuel pompiste)
    // On ne se base PAS sur /banqueLtd type=add car ca inclurait subventions,
    // virements entre comptes, et autres entrees non-commerciales qui ne sont
    // pas du CA. Le tableau ci-dessous reste exhaustif (audit complet).
    // Sans periode (Depuis ouverture), on saute ces fetchs pour eviter un
    // payload massif.
    const ventesPromise = (debut && fin)
      ? listVentesSemaine(debut, fin).catch(() => [])
      : Promise.resolve([]);
    const redistribPromise = (debut && fin)
      ? listRedistributionsSemaine(debut, fin).catch(() => [])
      : Promise.resolve([]);

    const [liveSnap, banqueSnap, depSnap, ventesSnap, redistribSnap] = await Promise.all([
      getDocs(liveQ),
      getDocs(banqueQ),
      getDocs(depQ),
      ventesPromise,
      redistribPromise
    ]);
    ventesPeriode = ventesSnap;
    // Filtre les redistributions supprimees (corrections admin) pour eviter
    // de gonfler artificiellement le CA essence.
    redistribPeriode = redistribSnap.filter(r => !r.supprimee);

    if (!liveSnap.empty) {
      const x = liveSnap.docs[0].data();
      soldeLive = { montant: Number(x.soldeApres) || 0, date: x.timestamp };
    }

    const banqueOps = banqueSnap.docs.map(d => {
      const x = d.data();
      return {
        id: d.id,
        timestamp: x.timestamp,
        type: x.type === 'remove' ? 'remove' : 'add',
        montant: Number(x.montant) || 0,
        soldeAvant: Number(x.soldeAvant) || 0,
        soldeApres: Number(x.soldeApres) || 0,
        raison: x.raison || '',
        source: 'xbankaccount',
        utilisateur: ''
      };
    });

    // /depenses : deja recupere via Promise.all ci-dessus (depSnap)
    const depOps = depSnap.docs.map(d => {
      const x = d.data();
      return {
        id: d.id,
        timestamp: x.timestamp,
        type: 'remove',
        montant: Number(x.montant) || 0,
        soldeAvant: Number(x.soldeAvant) || 0,
        soldeApres: Number(x.soldeApres) || 0,
        raison: x.raison || '',
        source: 'depense',
        utilisateur: x.utilisateur || '',
        typeDepense: x.type || ''
      };
    });

    // 3. Déduplication banque ↔ dépenses
    //    FiveM log CHAQUE paiement sur 2 canaux : xbankaccount (#logs-ig →
    //    /banqueLtd) ET #depenses (→ /depenses). Une seule sortie d'argent
    //    réelle = 2 docs Firestore. Sans dédup, totaux × 2.
    //
    //    Stratégie : pour chaque dépense (source=depense), on cherche un
    //    mouvement banqueLtd correspondant (même montant + type=remove +
    //    timestamp à ±120s) et on le retire. On garde la dépense car elle
    //    porte des métadonnées plus riches (raison textuelle, utilisateur,
    //    fournisseur classifié, etc.).
    //
    //    Clé de matching identique à crossRefBanqueDepense() côté Cloud Fn.
    const DEDUP_WINDOW_MS = 120 * 1000;
    const banqueRemovesByMontant = new Map(); // montant → [{ms, op, used}]
    for (const op of banqueOps) {
      if (op.type !== 'remove') continue;
      const ms = op.timestamp?.toMillis ? op.timestamp.toMillis() : 0;
      if (!ms) continue;
      if (!banqueRemovesByMontant.has(op.montant)) banqueRemovesByMontant.set(op.montant, []);
      banqueRemovesByMontant.get(op.montant).push({ ms, op, used: false });
    }
    const idsBanqueADedupliquer = new Set();
    let nbDoublons = 0;
    for (const dep of depOps) {
      const ms = dep.timestamp?.toMillis ? dep.timestamp.toMillis() : 0;
      if (!ms) continue;
      const candidats = banqueRemovesByMontant.get(dep.montant) || [];
      // On prend le candidat libre le plus proche temporellement (< 120s)
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
        idsBanqueADedupliquer.add(best.op.id);
        nbDoublons++;
      }
    }
    const banqueOpsDedupes = banqueOps.filter(op => !idsBanqueADedupliquer.has(op.id));
    if (nbDoublons > 0) {
      console.log(`[banque] dédup : ${nbDoublons} doublon(s) banqueLtd↔depenses supprimé(s) (${banqueOps.length} banque + ${depOps.length} dép → ${banqueOpsDedupes.length + depOps.length} uniques)`);
    }

    // 4. Combine + tri chronologique
    mouvements = [...banqueOpsDedupes, ...depOps].sort((a, b) => {
      const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return tb - ta;
    });

    rendre();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="7" class="alert danger">Erreur : ${escapeHtml(e.message || e.code)}</td></tr>`;
  }
}

// Une "paie ponctuelle du lundi" = sortie "Paye ponctuelle de membre" (le libelle
// IG des salaires) versee un lundi (Paris). Les salaires de la semaine N sont
// verses le lundi (apres dimanche 23h59) = debut de la semaine N+1. Cote banque,
// on les SORT du total "Sorties" + "Net" de la semaine affichee (ils relevent de
// la semaine precedente), tout en les gardant visibles dans la liste (tag "paie S-1").
// NE matche PAS le transfert d'impot ("Transfert ... (Impot ...)").
const _wdParis = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
function estPaieLundi(m) {
  if (m.type !== 'remove') return false;
  const r = (m.raison || '').toLowerCase();
  const estPaie = r.includes('paye ponctuelle') || m.typeDepense === 'paie';
  if (!estPaie) return false;
  const d = m.timestamp?.toDate ? m.timestamp.toDate()
          : (m.timestamp?.toMillis ? new Date(m.timestamp.toMillis()) : null);
  if (!d) return false;
  return _wdParis.format(d) === 'Mon';
}

function rendre() {
  const filtreType = document.getElementById('filtre-type').value;
  const filtreRech = document.getElementById('filtre-recherche').value.toLowerCase().trim();

  let visibles = mouvements;
  if (filtreType) visibles = visibles.filter(m => m.type === filtreType);
  if (filtreRech) visibles = visibles.filter(m => (m.raison || '').toLowerCase().includes(filtreRech));

  // KPIs : "Solde actuel" = live (indépendant du filtre)
  //        "Recettes totales" = ventes epicerie /ventes + ventes essence
  //                             /redistributions (toutes sources). N'inclut
  //                             PAS les subventions / virements / autres
  //                             entrees xbankaccount non-commerciales.
  //        "Sorties" + "Net" = sur la période sélectionnée
  // Sorties = mouvements 'remove' SAUF les paies du lundi (= paies S-1, versees
  // apres la cloture, rattachees a la semaine precedente). Elles restent dans la
  // liste mais hors du total Sorties + Net de la semaine en cours.
  const removes        = mouvements.filter(m => m.type === 'remove' && !estPaieLundi(m));
  const nbRemove       = removes.length;
  const totalSorties   = removes.reduce((s, m) => s + m.montant, 0);
  const paiesLundi     = mouvements.filter(estPaieLundi);
  const totalPaiesLundi = paiesLundi.reduce((s, m) => s + m.montant, 0);
  // Sépare le VRAI CA épicerie (categorieFiscale 'vente') des entrées classées
  // fiscalement (don reçu, subvention, autre entrée) : elles sont bien encaissées
  // (donc dans le total + la banque), mais affichées À PART pour ne pas gonfler
  // le chiffre "épicerie" (sinon un don de 300K passe pour du CA épicerie).
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente';
  const ventesEpicerie = ventesPeriode.filter(estVenteCA);
  const ventesClassees = ventesPeriode.filter(v => !estVenteCA(v));
  const totalVentes   = ventesEpicerie.reduce((s, v) => s + (Number(v.montant) || 0), 0);
  const nbVentes      = ventesEpicerie.length;
  const LABELS_CAT_FISC = { 'don-recu': 'don reçu', 'don-verse': 'don versé', 'subvention': 'subvention', 'autre-entree': 'autre entrée' };
  const classeesParCat = {};
  ventesClassees.forEach(v => {
    const c = v.categorieFiscale;
    (classeesParCat[c] = classeesParCat[c] || { total: 0, n: 0 });
    classeesParCat[c].total += (Number(v.montant) || 0);
    classeesParCat[c].n += 1;
  });
  const totalClassees = ventesClassees.reduce((s, v) => s + (Number(v.montant) || 0), 0);
  const totalEssence  = redistribPeriode.reduce((s, r) => s + (Number(r.montant) || 0), 0);
  const nbEssence     = redistribPeriode.length;
  const totalRecettes = totalEssence + totalVentes + totalClassees; // argent réellement encaissé (épicerie + essence + entrées classées)
  const periodeLabel  = getPeriodeLabel();

  document.getElementById('kpis-banque').innerHTML = `
    <div class="kpi kpi-bank">
      <div class="label">Solde actuel</div>
      <div class="value">${money(soldeLive.montant)}</div>
      <div class="delta">au ${escapeHtml(datetime(soldeLive.date) || '—')} · live, indépendant du filtre</div>
    </div>
    <div class="kpi kpi-recette" title="Ventes essence (redistributions) + ventes épicerie (/ventes, toutes méthodes de paiement) + entrées classées (don reçu, etc.). Les entrées classées restent dans le total (argent encaissé) mais sont affichées À PART, hors « épicerie », pour ne pas fausser le CA épicerie.">
      <div class="label">Recettes totales <span class="muted" style="font-size:0.7rem;">(${escapeHtml(periodeLabel)})</span></div>
      <div class="value">${money(totalRecettes)}</div>
      <div class="delta">${money(totalEssence)} essence (${nbEssence}) · ${money(totalVentes)} épicerie (${nbVentes})${Object.keys(classeesParCat).map(c => ` · ${money(classeesParCat[c].total)} ${LABELS_CAT_FISC[c] || c} (${classeesParCat[c].n})`).join('')}</div>
    </div>
    <div class="kpi kpi-depense">
      <div class="label">Sorties <span class="muted" style="font-size:0.7rem;">(${escapeHtml(periodeLabel)})</span></div>
      <div class="value">${money(totalSorties)}</div>
      <div class="delta">${nbRemove} mouvements${paiesLundi.length ? ` · hors ${paiesLundi.length} paie(s) S-1 (${money(totalPaiesLundi)})` : ''}</div>
    </div>
    <div class="kpi ${(totalRecettes - totalSorties) >= 0 ? 'kpi-positive' : 'kpi-negative'}" style="border-color:var(--color-info);">
      <div class="label">Net <span class="muted" style="font-size:0.7rem;">(${escapeHtml(periodeLabel)})</span></div>
      <div class="value">${money(totalRecettes - totalSorties)}</div>
      <div class="delta">recettes − sorties sur la période</div>
    </div>
  `;

  document.getElementById('stats-mvts').textContent =
    `${visibles.length} affichés / ${mouvements.length} mouvements (${escapeHtml(periodeLabel)})`;

  const tbody = document.getElementById('tbody-mvts');
  if (visibles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted text-center">Aucun mouvement ne correspond aux filtres.</td></tr>';
    return;
  }

  tbody.innerHTML = visibles.slice(0, 1000).map(m => {
    const isAdd = m.type === 'add';
    const isPaieS1 = estPaieLundi(m);
    const badge = isAdd
      ? '<span class="badge ok">Entrée</span>'
      : '<span class="badge danger">Sortie</span>';
    const colorMontant = isAdd ? 'color:var(--color-success);' : 'color:var(--color-danger);';
    return `
      <tr>
        <td class="mono" style="font-size:0.78rem;">${escapeHtml(datetime(m.timestamp) || '—')}</td>
        <td class="center">${badge}</td>
        <td class="right mono" style="${colorMontant};font-weight:bold;">${isAdd ? '+' : '−'}${moneyPrecis(m.montant)}</td>
        <td class="right mono muted">${moneyPrecis(m.soldeAvant)}</td>
        <td class="right mono"><strong>${moneyPrecis(m.soldeApres)}</strong></td>
        <td>${escapeHtml(m.raison || '—')}${isPaieS1 ? ' <span class="badge neutral" style="font-size:0.65rem;">paie S-1 · hors total</span>' : ''}</td>
        <td><span class="badge neutral">${escapeHtml(m.source)}</span></td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-recharger').addEventListener('click', chargerTout);
document.getElementById('filtre-type').addEventListener('change', rendre);
document.getElementById('filtre-recherche').addEventListener('input', rendre);
// Recharge depuis Firestore quand la période change (= autres bornes timestamp).
attachPeriodFilter(chargerTout);

document.getElementById('btn-export').addEventListener('click', () => {
  const lines = ['Date;Type;Montant;Solde avant;Solde après;Raison;Source;Utilisateur'];
  for (const m of mouvements) {
    lines.push([
      datetime(m.timestamp) || '',
      m.type === 'add' ? 'Entrée' : 'Sortie',
      m.montant,
      m.soldeAvant,
      m.soldeApres,
      (m.raison || '').replace(/;/g, ','),
      m.source,
      (m.utilisateur || '').replace(/;/g, ',')
    ].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `banque-ltd-${dateKeyLocal(new Date())}.csv`;
  a.click();
});

chargerTout();
