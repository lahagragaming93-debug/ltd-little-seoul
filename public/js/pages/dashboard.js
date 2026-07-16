// ============================================================
// Page : Dashboard principal (Patron / Co-Patron / DRH)
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import {
  listVentesSemaine, listenStocks, listenStations, listDepensesSemaine,
  listPaiesSemaine, listSemaines, listenAlertesActives, getConfig,
  getDernierSoldeBanque, getCarburantStatsSemaine,
  listUsers, listServicesSemaine, listQuotasSemaine, listQuotasVendeurSemaine,
  listSubventionsSemaine
} from '../api.js';
import { salaireEstime, fabricationsFromQuotaDoc } from '../utils/paie.js';
import { compteEnFinance } from '../utils/permissions.js';
import { weekId } from '../utils/formatters.js';
import { startOfWeekRP, endOfWeekRP, money, num, pct, datetime, escapeHtml } from '../utils/formatters.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { checkMasseSalariale } from '../utils/paie.js';
import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';
import { renderPeriodFilter, getPeriode, getPeriodeLabel, attachPeriodFilter } from '../utils/period-filter.js';
Chart.register(...registerables);

// Couleurs western pour les graphiques
const CH_COLORS = {
  blood:    '#8B0000',
  bloodLt:  '#b81b1b',
  sand:     '#D2B48C',
  sandLt:   '#e6d3b3',
  gold:     '#c9a961',
  bone:     '#F5F0E8',
  grid:     'rgba(210, 180, 140, 0.12)'
};
Chart.defaults.color = CH_COLORS.sand;
Chart.defaults.font.family = "'Special Elite', 'Courier New', monospace";
Chart.defaults.borderColor = CH_COLORS.grid;

const { user, profile } = await requireAuth('dashboard');

const html = `
  <div class="page-toolbar" style="flex-wrap:wrap;gap:8px;">
    ${renderPeriodFilter('semaine')}
    <span class="spacer"></span>
    <span class="muted" style="font-size:0.8rem;">Solde banque, stocks bas, alertes et stations restent toujours en temps réel.</span>
  </div>

  <div class="kpi-grid" id="kpis">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
    <div>
      <div class="panel framed">
        <div class="panel-title">
          <span>Ventes — semaine en cours</span>
          <span class="muted mono" id="periode-semaine"></span>
        </div>
        <div id="ventes-resume" style="position:relative;height:240px;">
          <canvas id="chart-ventes"></canvas>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title"><span>Top 5 produits — semaine</span></div>
        <div id="top-produits" class="top-produits-list">
          <p class="muted text-center" style="padding:20px 0;">Chargement…</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title"><span>Historique 6 dernières semaines</span></div>
        <div id="historique">—</div>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-title"><span>Alertes actives</span></div>
        <div id="alertes-list">Aucune alerte</div>
      </div>

      <div class="panel">
        <div class="panel-title"><span>Stations essence</span></div>
        <div id="stations-mini">—</div>
      </div>

      <div class="panel">
        <div class="panel-title"><span>Stocks bas</span></div>
        <div id="stocks-bas">—</div>
      </div>
    </div>
  </div>
`;

renderShell(profile, 'dashboard', html);

// === Période (dynamique selon le sélecteur en haut) ===
// debut/fin sont recalculés à chaque chargerKpis() depuis getPeriode().
let debut = startOfWeekRP();
let fin   = endOfWeekRP();

// === KPIs ===
async function chargerKpis() {
  // Met à jour debut/fin depuis le filtre période. Fallback semaine en cours
  // si "Depuis ouverture" (debut=null) — sinon les listSemaine pourraient
  // remonter trop loin et ralentir la page.
  const periode = getPeriode();
  debut = periode.debut || startOfWeekRP();
  fin   = periode.fin   || new Date();
  document.getElementById('periode-semaine').textContent =
    `${debut.toLocaleDateString('fr-FR')} → ${fin.toLocaleDateString('fr-FR')} · ${getPeriodeLabel()}`;

  // v1.11.1 (perf CEF) : inclure listSemaines(6) dans le Promise.all initial
  // au lieu de l'awaiter sequentiellement plus bas (gain ~150 ms sur tablette).
  // v1.11.3 : on passe (debut, fin) a getDernierSoldeBanque pour que le solde
  // affiche corresponde a la fin de la periode choisie (avant : toujours live).
  // v1.11.3 : on charge aussi les subventions de la semaine pour le calcul
  // du benefice net (coherent avec /comptabilite).
  // PERF (2026-06-07) : carburant en agrégation serveur (carbStats = {total,count}).
  const [ventes, depenses, paies, config, soldeBanque, carbStats, allUsers, services, quotas, quotasV, semaines, subventions] = await Promise.all([
    listVentesSemaine(debut, fin).catch(() => []),
    listDepensesSemaine(debut, fin).catch(() => []),
    listPaiesSemaine(debut, fin).catch(() => []),
    getConfig().catch(() => ({})),
    getDernierSoldeBanque(debut, fin).catch(() => null),
    getCarburantStatsSemaine(debut, fin).catch(() => ({ total: 0, count: 0 })),
    listUsers().catch(() => []),
    listServicesSemaine(debut, fin).catch(() => []),
    listQuotasSemaine(weekId()).catch(() => []),
    listQuotasVendeurSemaine(weekId()).catch(() => []),
    listSemaines(6).catch(() => []),
    listSubventionsSemaine(debut, fin).catch(() => [])
  ]);

  const ca = ventes.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montant || 0) : 0), 0); // dons/subventions hors CA
  const caCarburant = carbStats.total;
  const caTotal = ca + caCarburant;
  const benefice = ventes.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.benefice || 0) : 0), 0);
  // Depenses : exclut type='paie' (doublon)
  const totalDepenses = depenses.filter(d => d.type !== 'paie').reduce((s, d) => s + (d.montant || 0), 0);
  const totalSubventions = subventions.reduce((s, b) => s + (Number(b.montant) || 0), 0);
  const totalPaies = paies.reduce((s, p) => s + (p.montant || 0), 0);

  // Masse salariale PREVISIONNELLE : somme des salaires estimes (Direction fixe
  // + Vendeur/Pompiste variable selon CA/quotas). Reflet temps reel de ce qui
  // sera du au prochain versement (lundi-mardi suivant).
  let masseEstimee = 0;
  for (const usr of allUsers.filter(x => compteEnFinance(x.role) && x.statut === 'actif')) {
    const myV = ventes.filter(v => v.vendeurId === usr.id);
    const myCaParticulier = myV.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0); // don hors CA → pas de salaire gonflé
    const q = quotas.find(qu => qu.employeId === usr.id) || { bidons: 0, caoutchoucs: 0 };
    const qv = quotasV.find(qu => qu.employeId === usr.id) || {};
    masseEstimee += salaireEstime({
      role: usr.role,
      caGenere: myCaParticulier,
      bidonsRealises: q.bidons,
      caoutchoucsRealises: q.caoutchoucs,
      fabrications: fabricationsFromQuotaDoc(qv),
      salaireDecide: usr.salaireDecide
    }, config, weekId(debut)); // date la formule sur la semaine AFFICHEE (resp-vente hybride a partir du 22/06)
  }
  const masseSalariale = Math.max(masseEstimee, totalPaies);
  // Benefice net = tresorerie reelle : on inclut les subventions recues
  // (cf. /comptabilite.js — la subvention est de l'argent qui rentre, meme
  // si fiscalement non imposable).
  const beneficeNet = caTotal + totalSubventions - totalDepenses - masseSalariale;
  // Ratio TTE (Art. 4-1.13) = masse / CA total. Le CA inclut TOUT le carburant
  // (NPC auto + manuel pompiste) car Art. 4-2.1 definit le CA comme la totalite
  // des revenus de l'entreprise — l'IRS regarde le total, pas un subset metier.
  const masse = checkMasseSalariale(masseSalariale, caTotal);

  // Solde banque LTD (dernière dépense connue avec champ soldeApres)
  let soldeKpi = `
    <div class="kpi kpi-bank" title="Aucune donnée de solde encore enregistrée">
      <div class="label">Solde banque LTD</div>
      <div class="value muted">—</div>
      <div class="delta muted">en attente de dépense Discord</div>
    </div>`;
  if (soldeBanque) {
    const dateSolde = datetime(soldeBanque.timestamp);
    soldeKpi = `
      <div class="kpi kpi-bank" title="Solde au moment de la dernière dépense Discord (${escapeHtml(dateSolde)} — « ${escapeHtml(soldeBanque.raison)} »)">
        <div class="label">Solde banque LTD</div>
        <div class="value">${money(soldeBanque.solde)}</div>
        <div class="delta">au ${escapeHtml(dateSolde)}</div>
      </div>`;
  }

  const kpis = document.getElementById('kpis');
  kpis.innerHTML = `
    ${soldeKpi}
    <div class="kpi">
      <div class="label">CA semaine</div>
      <div class="value">${money(ca)}</div>
      <div class="delta">${ventes.length} factures produits</div>
    </div>
    <div class="kpi">
      <div class="label">CA carburant</div>
      <div class="value">${money(caCarburant)}</div>
      <div class="delta">${carbStats.count} ventes essence</div>
    </div>
    <div class="kpi">
      <div class="label">Bénéfice brut</div>
      <div class="value">${money(benefice)}</div>
      <div class="delta">marge produits</div>
    </div>
    <div class="kpi">
      <div class="label">Bénéfice net estimé</div>
      <div class="value">${money(beneficeNet)}</div>
      <div class="delta ${beneficeNet >= 0 ? 'up' : 'down'}">
        après dépenses + salaires
      </div>
    </div>
    <div class="kpi" title="Prévisionnel : salaires fixes Direction + variables Vendeur/Pompiste calculés selon CA/quotas en temps réel.">
      <div class="label">Masse salariale</div>
      <div class="value">${pct(masse.ratio * 100, 1)}</div>
      <div class="delta ${masse.ok ? 'up' : 'down'}">
        ${masse.ok ? '≤ 90% (TTE OK)' : 'Dépasse 90%'} · ${money(masseSalariale)} prévu / ${money(totalPaies)} versé
      </div>
    </div>
  `;

  // === Chart 1 — Ventes par jour de la semaine ===
  const joursOrder = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  const ventesParJour = Object.fromEntries(joursOrder.map(j => [j, 0]));
  ventes.forEach(v => {
    const t = v.timestamp?.toDate?.() || new Date();
    const j = t.toLocaleDateString('fr-FR', { weekday: 'long' }).toLowerCase();
    if (ventesParJour[j] != null) ventesParJour[j] += ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montant || 0) : 0);
  });
  renderChartVentes(ventesParJour);

  // === Top 5 produits (CA + quantité + nombre de factures) ===
  const topMap = {};
  ventes.forEach(v => {
    if (v.cachee) return; // doublons caches : ignores
    const lignes = Array.isArray(v.lignes) && v.lignes.length > 0 ? v.lignes : (v.items || []);
    lignes.forEach(it => {
      const k = it.nom || it.produitNom || it.produitId || it.id || 'Inconnu';
      const qte = Number(it.quantite || 1);
      const ca  = Number(it.total ?? (qte * (it.prixVente || it.prixUnitaire || 0)));
      if (!topMap[k]) topMap[k] = { nom: k, ca: 0, qte: 0, nbFactures: 0, _facturesIds: new Set() };
      topMap[k].ca  += ca;
      topMap[k].qte += qte;
      topMap[k]._facturesIds.add(v.id || v.factureId);
    });
  });
  const topAll = Object.values(topMap).map(t => ({
    nom: t.nom, ca: t.ca, qte: t.qte, nbFactures: t._facturesIds.size
  }));
  const totalCAItems = topAll.reduce((s, t) => s + t.ca, 0);
  const top = topAll.sort((a, b) => b.ca - a.ca).slice(0, 5);
  renderTopProduits(top, totalCAItems);

  // === Historique 6 semaines === (semaines deja recupere via Promise.all)
  const histDiv = document.getElementById('historique');
  if (semaines.length === 0) {
    histDiv.innerHTML = `<p class="muted">Première semaine — pas d'historique.</p>`;
  } else {
    histDiv.innerHTML = `
      <div class="table-scroll" style="max-height:400px;">
        <table class="data" id="table-historique">
          <thead><tr>
            <th data-sort="semaine">Semaine</th>
            <th class="right" data-sort="ca">CA</th>
            <th class="right" data-sort="depenses">Dépenses</th>
            <th class="right" data-sort="benefice">Bénéfice net</th>
            <th data-sort="statut">Statut</th>
          </tr></thead>
          <tbody>
            ${semaines.map(s => `
              <tr>
                <td>${s.numero || s.dateDebut || '—'}</td>
                <td class="right">${money(s.ca)}</td>
                <td class="right">${money(s.depenses)}</td>
                <td class="right">${money(s.benefice)}</td>
                <td><span class="badge ${s.statut === 'cloturee' ? 'ok' : 'info'}">${s.statut || 'en cours'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    makeSortable(document.getElementById('table-historique'));
  }
}
chargerKpis();
// Recharge tout dès que la période change.
attachPeriodFilter(chargerKpis);

// === Stations mini-bloc ===
listenStations(stations => {
  const div = document.getElementById('stations-mini');
  if (stations.length === 0) {
    div.innerHTML = `<p class="muted">Aucune station configurée. <a href="admin.html">Configurer</a></p>`;
    return;
  }
  div.innerHTML = stations.map(s => {
    const niveau = s.stockMax ? (s.stockActuel / s.stockMax) * 100 : 0;
    const sousAlerte = s.stockActuel < (s.seuilAlerte || 0);
    return `
      <div class="row" style="margin-bottom:8px;gap:10px;">
        <div style="flex:1;">
          <div style="font-family:var(--font-heading);font-size:0.85rem;">
            ${escapeHtml(s.nom)} ${sousAlerte ? '<span class="badge danger">ALERTE</span>' : ''}
          </div>
          <div class="progress" style="height:14px;">
            <div class="fill" style="width:${Math.min(niveau, 100)}%"></div>
            <div class="label">${num(s.stockActuel || 0)} L</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
});

// === Stocks bas ===
listenStocks(stockMap => {
  // Récupérer les seuils depuis produits
  const div = document.getElementById('stocks-bas');
  const bas = Object.entries(stockMap)
    .filter(([id, s]) => s.seuilAlerte != null && s.quantite <= s.seuilAlerte)
    .slice(0, 8);
  if (bas.length === 0) {
    div.innerHTML = `<p class="muted">Tous les stocks sont OK.</p>`;
    return;
  }
  div.innerHTML = bas.map(([id, s]) => `
    <div class="row" style="margin-bottom:6px;">
      <span class="badge ${s.quantite === 0 ? 'danger' : 'warn'}">${s.quantite === 0 ? 'RUPTURE' : 'BAS'}</span>
      <span>${escapeHtml(s.nom || id)}</span>
      <span class="spacer"></span>
      <span class="mono">${num(s.quantite || 0)}</span>
    </div>
  `).join('');
});

// ============ Charts ============
let chartVentes = null;

function renderChartVentes(ventesParJour) {
  const ctx = document.getElementById('chart-ventes')?.getContext('2d');
  if (!ctx) return;
  const data = Object.values(ventesParJour);
  const total = data.reduce((s, v) => s + v, 0);
  if (chartVentes) chartVentes.destroy();
  if (total === 0) {
    ctx.canvas.parentElement.innerHTML = '<p class="muted text-center" style="padding-top:80px;">Aucune vente cette semaine.</p>';
    return;
  }
  chartVentes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(ventesParJour).map(j => j.charAt(0).toUpperCase() + j.slice(1, 3)),
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

// === Top 5 produits — rendu HTML/CSS (plus lisible qu'un bar chart) ===
function renderTopProduits(top, totalCA) {
  const div = document.getElementById('top-produits');
  if (!div) return;
  if (top.length === 0) {
    div.innerHTML = `<p class="muted text-center" style="padding:30px 0;">Aucune vente cette semaine.</p>`;
    return;
  }

  const max = top[0].ca || 1;
  const RANGS = [
    { medaille: '01', cls: 'rang-or' },
    { medaille: '02', cls: 'rang-argent' },
    { medaille: '03', cls: 'rang-bronze' },
    { medaille: '04', cls: 'rang-autre' },
    { medaille: '05', cls: 'rang-autre' }
  ];

  div.innerHTML = top.map((t, i) => {
    const r = RANGS[i] || RANGS[4];
    const pct = max > 0 ? Math.round((t.ca / max) * 100) : 0;
    const partTotal = totalCA > 0 ? Math.round((t.ca / totalCA) * 100) : 0;
    return `
      <div class="top-produit-row ${r.cls}">
        <div class="top-rang">${r.medaille}</div>
        <div class="top-info">
          <div class="top-nom" title="${escapeHtml(t.nom)}">${escapeHtml(t.nom)}</div>
          <div class="top-meta">
            <span class="top-qte">${num(t.qte)} unité${t.qte > 1 ? 's' : ''}</span>
            <span class="top-sep">·</span>
            <span class="top-fact">${t.nbFactures} facture${t.nbFactures > 1 ? 's' : ''}</span>
            <span class="top-sep">·</span>
            <span class="top-part">${partTotal}% du total</span>
          </div>
          <div class="top-bar-wrap">
            <div class="top-bar" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="top-ca">${money(t.ca)}</div>
      </div>
    `;
  }).join('');
}

// === Alertes ===
listenAlertesActives(alertes => {
  const div = document.getElementById('alertes-list');
  if (alertes.length === 0) {
    div.innerHTML = `<p class="muted">Aucune alerte active.</p>`;
    return;
  }
  div.innerHTML = alertes.slice(0, 8).map(a => `
    <div class="alert ${a.gravite || 'warn'}">
      <div style="flex:1;">
        <div>${escapeHtml(a.message)}</div>
        <div class="muted mono" style="font-size:0.72rem;">${datetime(a.timestamp)}</div>
      </div>
    </div>
  `).join('');
});
