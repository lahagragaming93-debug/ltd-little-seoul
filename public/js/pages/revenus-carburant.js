// ============================================================
// Page : Revenus carburant
// ============================================================
// Source : collection /redistributions, alimentée par le parser
// `essence` (canal #suivi-achat-essence) — chaque doc = 1 paiement
// d'un client à une station LTD.
//
// Affiche :
//  - 4 KPIs (CA, transactions, litres, prix moyen/L)
//  - Graphique CA par jour
//  - Tableau récap par station (CA, litres, transactions, prix moyen)
//  - Tableau détaillé chronologique
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listRedistributionsSemaine, listUsers, listQuotasSemaine, getConfig } from '../api.js';
import { money, moneyPrecis, num, datetime, escapeHtml, dateKeyLocal,
         weekId, startOfWeekRP, endOfWeekRP } from '../utils/formatters.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';
import { renderPeriodFilter, getPeriode, getPeriodeLabel, attachPeriodFilter } from '../utils/period-filter.js';
import { initSemaineSelector } from '../utils/semaine-selector.js';
import { salaireEstime } from '../utils/paie.js';
Chart.register(...registerables);

const CH_COLORS = {
  blood:   '#8B0000',
  bloodLt: '#b81b1b',
  sand:    '#D2B48C',
  gold:    '#c9a961',
  bone:    '#F5F0E8',
  grid:    'rgba(210, 180, 140, 0.12)'
};
Chart.defaults.color = CH_COLORS.sand;
Chart.defaults.font.family = "'Special Elite', 'Courier New', monospace";
Chart.defaults.borderColor = CH_COLORS.grid;

// Reprise officielle du LTD par Morgan HARPER le 2026-05-09. Les transactions
// anterieures restent en base (audit) mais ne sont pas affichees ici.
const REPRISE_DATE = new Date('2026-05-09T00:00:00');

const { profile } = await requireAuth('revenus_carburant');

// Config globale (objectifs de quota actuels + fallback pour le pilotage).
const configCarb = await getConfig().catch(() => ({}));

const html = `
  <div class="kpi-grid" id="kpis-carb">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="page-toolbar" style="flex-wrap:wrap;gap:8px;">
    ${renderPeriodFilter('semaine')}
    <select id="filtre-station" title="Filtrer par station">
      <option value="">Toutes stations</option>
    </select>
    <span class="spacer"></span>
    <span class="muted mono" id="stats-carb">—</span>
    <button class="btn" id="btn-export-csv" title="Exporter en CSV" data-tooltip="Export CSV">Exporter CSV</button>
  </div>

  <div class="panel framed">
    <div class="panel-title" style="flex-wrap:wrap;gap:8px;">
      <span>Pilotage pompistes</span>
      <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="muted" style="font-size:0.78rem;" id="pilotage-meta">—</span>
        <select id="sel-semaine-pilotage" title="Choisir la semaine" style="min-width:200px;"></select>
      </span>
    </div>
    <div id="pilotage-pompistes">Chargement…</div>
  </div>

  <div class="panel framed">
    <div class="panel-title"><span>Chiffre d'affaires carburant par jour</span></div>
    <div style="height:260px;position:relative;">
      <canvas id="chart-carb"></canvas>
    </div>
  </div>

  <div class="panel framed">
    <div class="panel-title">
      <span>Récap par station</span>
      <span class="muted" style="font-size:0.75rem;">— click sur en-tête pour trier</span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-stations">
        <thead>
          <tr>
            <th data-sort="station">Station</th>
            <th class="right" data-sort="transactions">Transactions</th>
            <th class="right" data-sort="litres">Litres vendus</th>
            <th class="right" data-sort="ca">CA</th>
            <th class="right" data-sort="prixMoyen">Prix moyen / L</th>
          </tr>
        </thead>
        <tbody id="tbody-stations"><tr><td colspan="5" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>Détail des transactions</span>
      <span class="muted" style="font-size:0.75rem;">— ordre chronologique</span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-transactions">
        <thead>
          <tr>
            <th data-sort="date">Date</th>
            <th data-sort="station">Station</th>
            <th class="right" data-sort="litres">Litres</th>
            <th class="right" data-sort="prixL">Prix / L</th>
            <th class="right" data-sort="montant">Montant</th>
            <th class="right" data-sort="stockAvant">Stock avant</th>
            <th class="right" data-sort="stockApres">Stock après</th>
            <th data-sort="redistribution">N° lot</th>
          </tr>
        </thead>
        <tbody id="tbody-transactions"><tr><td colspan="8" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>
`;

renderShell(profile, 'revenus_carburant', html);

makeSortable(document.getElementById('table-stations'));
makeSortable(document.getElementById('table-transactions'));

let chartCarb = null;
let dataCache = []; // pour l'export CSV

async function recharger() {
  let { debut, fin } = getPeriode();
  // Si "Depuis ouverture" (debut=null) → on prend depuis la reprise officielle.
  if (!debut) debut = REPRISE_DATE;
  if (!fin)   fin   = new Date();
  // On ne descend jamais sous la date de reprise officielle.
  const debutEffectif = debut < REPRISE_DATE ? REPRISE_DATE : debut;
  const list = await listRedistributionsSemaine(debutEffectif, fin).catch(() => []);
  // Double filet : exclure aussi cote client tout doc qui aurait un timestamp anterieur
  dataCache = list.filter(r => {
    const t = r.timestamp?.toDate?.();
    return t && t >= REPRISE_DATE;
  });

  // Alimente le filtre station (dynamique selon les données chargées)
  const stationsUniques = [...new Set(list.map(r => r.station || r.stationId).filter(Boolean))].sort();
  const selStation = document.getElementById('filtre-station');
  const selected = selStation.value;
  selStation.innerHTML = `<option value="">Toutes les stations</option>` +
    stationsUniques.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  selStation.value = stationsUniques.includes(selected) ? selected : '';

  rendre();
}

function rendre() {
  const stationFilter = document.getElementById('filtre-station').value;
  let rows = dataCache;
  if (stationFilter) rows = rows.filter(r => (r.station || r.stationId) === stationFilter);

  // === KPIs globaux ===
  const ca = rows.reduce((s, r) => s + (Number(r.montant) || 0), 0);
  // Pour les litres, on EXCLUT les transactions sans detail (litres=0,
  // typiquement issues du rattrapage #revenu).
  const rowsAvecDetail = rows.filter(r => (Number(r.litres) || 0) > 0);
  const litres = rowsAvecDetail.reduce((s, r) => s + (Number(r.litres) || 0), 0);

  document.getElementById('kpis-carb').innerHTML = `
    <div class="kpi kpi-recette">
      <div class="label">CA carburant</div>
      <div class="value">${money(ca)}</div>
      <div class="delta">${rows.length} transactions</div>
    </div>
    <div class="kpi">
      <div class="label">Litres vendus</div>
      <div class="value">${litres > 0 ? num(litres) + ' L' : '<span class="muted">—</span>'}</div>
      <div class="delta">${litres > 0 ? 'total période' : 'pas de détail'}</div>
    </div>
  `;

  document.getElementById('stats-carb').textContent =
    `${rows.length} transactions — ${money(ca)} de CA`;

  // === Récap par station ===
  const parStation = new Map();
  for (const r of rows) {
    const k = r.station || r.stationId || '—';
    if (!parStation.has(k)) parStation.set(k, { transactions: 0, litres: 0, ca: 0 });
    const s = parStation.get(k);
    s.transactions += 1;
    s.litres += Number(r.litres) || 0;
    s.ca += Number(r.montant) || 0;
  }
  const tbodyStations = document.getElementById('tbody-stations');
  if (parStation.size === 0) {
    tbodyStations.innerHTML = `<tr><td colspan="5" class="muted text-center">Aucune transaction sur la période.</td></tr>`;
  } else {
    // Tri : vraies stations d'abord (par CA decroissant), placeholders
    // ("Station inconnue ...", litres=0) tout en bas avec note muted.
    const isPlaceholder = (s) => s.litres === 0;
    const entries = [...parStation.entries()];
    const reelles = entries.filter(([, s]) => !isPlaceholder(s)).sort((a, b) => b[1].ca - a[1].ca);
    const placeholders = entries.filter(([, s]) =>  isPlaceholder(s)).sort((a, b) => b[1].ca - a[1].ca);

    const renderRow = ([nom, s], placeholder = false) => {
      const prixM = s.litres > 0 ? s.ca / s.litres : 0;
      const litresAffiche = s.litres > 0 ? num(s.litres) + ' L' : '<span class="muted">—</span>';
      const prixAffiche   = s.litres > 0 ? moneyPrecis(prixM)  : '<span class="muted">—</span>';
      const cls = placeholder ? ' class="muted"' : '';
      const note = placeholder
        ? ' <span class="badge neutral" style="font-size:0.65rem;">migration</span>'
        : '';
      return `
        <tr${cls}>
          <td><strong>${escapeHtml(nom)}</strong>${note}</td>
          <td class="right mono">${num(s.transactions)}</td>
          <td class="right mono">${litresAffiche}</td>
          <td class="right mono">${money(s.ca)}</td>
          <td class="right mono">${prixAffiche}</td>
        </tr>`;
    };
    tbodyStations.innerHTML =
      reelles.map(e => renderRow(e, false)).join('') +
      placeholders.map(e => renderRow(e, true)).join('');
  }

  // === Détail transactions ===
  const tbodyTrans = document.getElementById('tbody-transactions');
  if (rows.length === 0) {
    tbodyTrans.innerHTML = `<tr><td colspan="8" class="muted text-center">Aucune transaction sur la période.</td></tr>`;
  } else {
    const cellOuTiret = (val, formatter) =>
      (Number(val) || 0) > 0 ? formatter(val) : '<span class="muted">—</span>';
    // PERF CEF : ne pas injecter des milliers de <tr> d'un coup (freeze de
    // plusieurs secondes + scroll saccadé). On affiche les 200 transactions les
    // plus récentes ; les totaux / KPI / récap par station plus haut sont
    // calculés sur l'INTÉGRALITÉ des données, donc restent exacts.
    const MAX_TX = 200;
    const shown = rows.slice(0, MAX_TX);
    tbodyTrans.innerHTML = shown.map(r => `
      <tr>
        <td>${datetime(r.timestamp)}</td>
        <td>${escapeHtml(r.station || r.stationId || '—')}</td>
        <td class="right mono">${cellOuTiret(r.litres, v => num(v) + ' L')}</td>
        <td class="right mono">${cellOuTiret(r.prixLitre, moneyPrecis)}</td>
        <td class="right mono">${moneyPrecis(r.montant || 0)}</td>
        <td class="right mono muted">${cellOuTiret(r.stockAvant, v => num(v) + ' L')}</td>
        <td class="right mono">${cellOuTiret(r.stockApres, v => num(v) + ' L')}</td>
        <td class="mono">#${escapeHtml(String(r.id || r.redistributionId || '—'))}</td>
      </tr>
    `).join('') +
    (rows.length > MAX_TX ? `<tr><td colspan="8" class="muted text-center">… ${rows.length - MAX_TX} transactions plus anciennes masquées (${rows.length} au total sur la période — les totaux ci-dessus les incluent).</td></tr>` : '');
  }

  // === Graphique CA par jour ===
  renderChart(rows);
}

function renderChart(rows) {
  const ctx = document.getElementById('chart-carb')?.getContext('2d');
  if (!ctx) return;

  // Groupe par jour en heure locale Paris (cf. dateKeyLocal). toISOString()
  // bucketait les transactions de lundi 00h-02h Paris dans dimanche UTC.
  const parJour = new Map();
  for (const r of rows) {
    const d = r.timestamp?.toDate?.();
    if (!d) continue;
    const key = dateKeyLocal(d);
    parJour.set(key, (parJour.get(key) || 0) + (Number(r.montant) || 0));
  }
  const labels = [...parJour.keys()].sort();
  const data = labels.map(k => parJour.get(k));
  const labelsFR = labels.map(k => {
    const [, m, d] = k.split('-');
    return `${d}/${m}`;
  });

  if (chartCarb) chartCarb.destroy();
  if (data.length === 0) {
    ctx.canvas.parentElement.innerHTML = '<p class="muted text-center" style="padding-top:90px;">Aucune transaction sur la période.</p>';
    return;
  }
  chartCarb = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labelsFR,
      datasets: [{
        data,
        backgroundColor: CH_COLORS.blood,
        borderColor: CH_COLORS.bloodLt,
        borderWidth: 1,
        hoverBackgroundColor: CH_COLORS.bloodLt
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleColor: CH_COLORS.gold,
          bodyColor: CH_COLORS.bone,
          borderColor: CH_COLORS.blood,
          borderWidth: 1,
          callbacks: { label: (ctx) => money(ctx.raw) }
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: CH_COLORS.grid }, ticks: { callback: v => money(v) } },
        x: { grid: { display: false } }
      }
    }
  });
}

attachPeriodFilter(recharger);
document.getElementById('filtre-station').addEventListener('change', rendre);

// === Export CSV ===
document.getElementById('btn-export-csv').addEventListener('click', () => {
  const stationFilter = document.getElementById('filtre-station').value;
  let rows = dataCache;
  if (stationFilter) rows = rows.filter(r => (r.station || r.stationId) === stationFilter);

  const lines = ['Date;Station;Litres;Prix/L;Montant;Stock avant;Stock apres;N° lot'];
  for (const r of rows) {
    lines.push([
      datetime(r.timestamp),
      (r.station || r.stationId || '').replace(/[;\n\r]/g, ' '),
      r.litres || 0,
      r.prixLitre || 0,
      r.montant || 0,
      r.stockAvant ?? '',
      r.stockApres ?? '',
      r.id || r.redistributionId || ''
    ].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `revenus-carburant-${dateKeyLocal(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

recharger();

// ============================================================
// Pilotage pompistes (deplace depuis Stations essence le 2026-06-01 :
// la page Stations est consultee par les pompistes, qui n'ont pas a voir
// ces infos de management ; Revenus carburant est reservee direction/DRH/
// responsable-pompiste). Recap par pompiste : quota bidons/caoutchoucs
// (dimensions actives uniquement), litres, ravitaillements, salaire estime.
// Selecteur de semaine dedie ; lecture seule.
// ============================================================
async function chargerPilotagePompistes(pDebut = startOfWeekRP(), pFin = endOfWeekRP(), pWId = weekId(), pCfgQuota = configCarb) {
  const div = document.getElementById('pilotage-pompistes');
  if (!div) return;
  const [users, quotas, redists] = await Promise.all([
    listUsers().catch(() => []),
    listQuotasSemaine(pWId).catch(() => []),
    listRedistributionsSemaine(pDebut, pFin).catch(() => [])
  ]);

  const pompistes = users.filter(u =>
    u.statut === 'actif' &&
    (/^pompiste-/.test(u.role || '') || u.role === 'responsable-pompiste')
  );

  const quotasById = new Map(quotas.map(q => [q.employeId, q]));

  const ravitsById = new Map();
  for (const r of redists) {
    if (r.source !== 'manuel-pompiste') continue;
    if (r.supprimee) continue;
    if (!r.pompisteId) continue;
    if (!ravitsById.has(r.pompisteId)) ravitsById.set(r.pompisteId, { nb: 0, litres: 0, bidons: 0, dernier: null });
    const v = ravitsById.get(r.pompisteId);
    v.nb++;
    v.litres += Number(r.litres) || 0;
    v.bidons += Number(r.bidons) || 0;
    const ts = r.timestamp?.toMillis?.() || 0;
    if (ts && (!v.dernier || ts > v.dernier)) v.dernier = ts;
  }

  // Objectifs de la semaine affichee (figes si semaine cloturee, sinon config actuelle)
  const qB = pCfgQuota.quotaBidons      ?? 1700;
  const qC = pCfgQuota.quotaCaoutchoucs ??  800;
  const bidonsActif = qB > 0;
  const caoutsActif = qC > 0;

  function scoreOf(p) {
    const q = quotasById.get(p.id) || {};
    const sB = bidonsActif ? Math.min(1, (Number(q.bidons) || 0) / qB) : 1;
    const sC = caoutsActif ? Math.min(1, (Number(q.caoutchoucs) || 0) / qC) : 1;
    const dims = (bidonsActif ? 1 : 0) + (caoutsActif ? 1 : 0);
    return dims === 0 ? 0 : ((bidonsActif ? sB : 0) + (caoutsActif ? sC : 0)) / dims;
  }
  pompistes.sort((a, b) => scoreOf(b) - scoreOf(a));

  if (pompistes.length === 0) {
    div.innerHTML = `<p class="muted">Aucun pompiste actif.</p>`;
    document.getElementById('pilotage-meta').textContent = '—';
    return;
  }

  const totalLitres = [...ravitsById.values()].reduce((s, v) => s + v.litres, 0);
  const totalBidons = [...ravitsById.values()].reduce((s, v) => s + v.bidons, 0);
  document.getElementById('pilotage-meta').textContent =
    `${pompistes.length} pompiste${pompistes.length > 1 ? 's' : ''} · ${num(Math.round(totalLitres))} L (${totalBidons.toFixed(0)} bidons) cumulés`;

  function badgeStatus(score, nbRavits, q) {
    if (nbRavits === 0 && (!q || (!q.bidons && !q.caoutchoucs))) {
      return '<span class="badge danger" title="Aucune activité cette semaine">Inactif</span>';
    }
    if (score >= 1) return '<span class="badge ok">Quota atteint</span>';
    if (score >= 0.5) return '<span class="badge neutral">En cours</span>';
    return '<span class="badge warn">En retard</span>';
  }

  div.innerHTML = `
    <div class="table-scroll" style="max-height:500px;">
      <table class="data" id="table-pilotage">
        <thead><tr>
          <th data-sort="nom">Pompiste</th>
          <th data-sort="role">Rôle</th>
          ${bidonsActif ? '<th data-sort="bidons">Bidons quota</th>' : ''}
          ${caoutsActif ? '<th data-sort="caoutchoucs">Caoutchoucs quota</th>' : ''}
          <th class="right" data-sort="litres">Litres semaine</th>
          <th class="right" data-sort="nbRavits">Ravitaillements</th>
          <th data-sort="dernier">Dernière activité</th>
          <th data-sort="status">Statut</th>
          <th class="right" data-sort="salaire">Salaire estimé</th>
          <th class="center">Voir</th>
        </tr></thead>
        <tbody>
          ${pompistes.map(p => {
            const q = quotasById.get(p.id) || {};
            const bDone = Number(q.bidons || 0);
            const cDone = Number(q.caoutchoucs || 0);
            const v = ravitsById.get(p.id) || { nb: 0, litres: 0, bidons: 0, dernier: null };
            const score = scoreOf(p);
            const pctB = bidonsActif ? Math.min(100, (bDone / qB) * 100) : 0;
            const pctC = caoutsActif ? Math.min(100, (cDone / qC) * 100) : 0;
            const salaireEst = salaireEstime(
              { role: p.role, bidonsRealises: bDone, caoutchoucsRealises: cDone, salaireDecide: p.salaireDecide || 0 },
              pCfgQuota
            );
            const dernierStr = v.dernier
              ? new Date(v.dernier).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
              : '<span class="muted">—</span>';
            const cellQuota = (done, qv, pctv) => `<div class="mono" style="font-size:0.85rem;">${num(done)} / ${num(qv)}</div><div class="progress" style="height:8px;margin-top:2px;"><div class="fill" style="width:${pctv}%;${done >= qv ? 'background:var(--color-cactus,#5a8);' : (pctv < 30 ? 'background:var(--color-blood);' : '')}"></div></div>`;
            const bCell = bidonsActif ? `<td data-sort-value="${bDone}">${cellQuota(bDone, qB, pctB)}</td>` : '';
            const cCell = caoutsActif ? `<td data-sort-value="${cDone}">${cellQuota(cDone, qC, pctC)}</td>` : '';
            return `
              <tr>
                <td><strong>${escapeHtml(p.prenom || '')} ${escapeHtml(p.nom || '')}</strong></td>
                <td class="muted" style="font-size:0.78rem;">${escapeHtml(p.role || '')}</td>
                ${bCell}
                ${cCell}
                <td class="right mono">${num(Math.round(v.litres))} L<div class="muted" style="font-size:0.72rem;">${v.bidons.toFixed(1)} bidons</div></td>
                <td class="right mono">${v.nb}</td>
                <td class="mono" style="font-size:0.78rem;" data-sort-value="${v.dernier || 0}">${dernierStr}</td>
                <td data-sort-value="${score}">${badgeStatus(score, v.nb, q)}</td>
                <td class="right mono" data-sort-value="${salaireEst}">${money(salaireEst)}</td>
                <td class="center"><a class="btn btn-sm" href="employee.html?asUser=${escapeHtml(p.id)}" title="Voir l'espace de ce pompiste">Voir</a></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  makeSortable(document.getElementById('table-pilotage'));
}

// Selecteur de semaine dedie au pilotage (declenche onChange a l'init).
initSemaineSelector('#sel-semaine-pilotage', {
  storageKey: 'pilotage-pompiste-semaine',
  onChange: ({ debut: d, fin: f, weekKey, isCurrent, semaine }) => {
    const cfgQ = isCurrent ? configCarb : (semaine?.quotaConfig || configCarb);
    chargerPilotagePompistes(d, f, isCurrent ? weekId() : weekKey, cfgQ);
  }
});
