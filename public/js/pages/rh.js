// ============================================================
// Page : Ressources humaines
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import {
  listUsers, listVentesSemaine, listVentesSemaineIncluantCachees, listServicesSemaine, listQuotasSemaine,
  listQuotasVendeurSemaine, listPaiesSemaine, getConfig, listenConfig, setConfig, updateUser,
  listRedistributionsSemaine, listPaiesEstimeesSemaine, marquerPaieVersee
} from '../api.js';
import { ROLE_LABELS, isVendeur, isPompiste, isResponsable, isDirection,
         isSuperAdmin, compteEnFinance, PLAFOND_SALAIRE, PLAFOND_CA_VENDEUR,
         BONUS_QUOTA_VENDEUR_MAX, QUOTA_CA_VENDEUR_DEFAULT,
         PRODUITS_QUOTA_FAB, isNouveauSystemeVendeur } from '../utils/permissions.js';
import { salaireEstime, scorePompiste, scoreQuotaFabrication, checkMasseSalariale,
         fabricationsFromQuotaDoc } from '../utils/paie.js';
import { nomProduit } from '../data/produits.js';
import { money, num, pct, datetime, escapeHtml,
         startOfWeekRP, endOfWeekRP, weekId, durationHM } from '../utils/formatters.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { initSemaineSelector } from '../utils/semaine-selector.js';

const { profile } = await requireAuth('rh');
const editable = isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh';

const html = `
  <div class="page-toolbar" style="flex-wrap:wrap;gap:8px;">
    <select id="filtre-semaine" title="Choisir la semaine — courante ou n'importe quelle semaine clôturée"></select>
    <span id="badge-semaine" class="muted mono" style="font-size:0.78rem;align-self:center;">—</span>
  </div>

  <div id="rh-banner"></div>

  <div class="kpi-grid" id="kpis-rh">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  ${editable ? `
  <div class="panel framed" id="panel-quotas-hebdo">
    <div class="panel-title">
      <span>Quotas hebdomadaires <span class="muted" style="font-size:0.78rem;">— centralisé · prend effet à la prochaine clôture</span></span>
      <button class="btn btn-sm" id="btn-toggle-quotas" title="Ouvrir / fermer le bloc">Afficher</button>
    </div>
    <div id="bloc-quotas" class="hidden">
      <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-start;">
        <div class="panel" style="flex:1 1 280px;min-width:240px;padding:10px;">
          <div class="mono mb-1" style="font-size:0.92rem;">Pompistes</div>
          <label class="muted" style="font-size:0.78rem;">Bidons (0 = désactivé)</label>
          <input type="number" id="q-bidons" min="0" step="1" />
          <label class="muted" style="font-size:0.78rem;margin-top:6px;display:block;">Caoutchoucs (0 = désactivé)</label>
          <input type="number" id="q-caoutchoucs" min="0" step="1" />
        </div>
        <div class="panel" style="flex:1 1 280px;min-width:240px;padding:10px;">
          <div class="mono mb-1" style="font-size:0.92rem;">Vendeurs — CA hebdo</div>
          <label class="muted" style="font-size:0.78rem;">Quota CA (avert auto si non atteint)</label>
          <input type="number" id="q-ca-vendeur" min="0" step="100" />
        </div>
        <div class="panel" style="flex:2 1 360px;min-width:280px;padding:10px;">
          <div class="mono mb-1" style="font-size:0.92rem;">Vendeurs — Quota fabrication (bonus max 5 000 $)</div>
          <div class="muted" style="font-size:0.75rem;margin-bottom:6px;">0 = produit désactivé cette semaine. Le bonus est versé au prorata du score moyen des produits actifs.</div>
          <div class="row" style="gap:8px;flex-wrap:wrap;">
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Eau purifiée</label><input type="number" id="q-fab-eau" min="0" step="1" /></div>
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Mastic carrosserie</label><input type="number" id="q-fab-mastic" min="0" step="1" /></div>
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Visseries</label><input type="number" id="q-fab-visseries" min="0" step="1" /></div>
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Pain à burger</label><input type="number" id="q-fab-pain" min="0" step="1" /></div>
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Lumière Violette</label><input type="number" id="q-fab-lumiere" min="0" step="1" /></div>
            <div style="flex:1 1 130px;"><label class="muted" style="font-size:0.78rem;">Sac en jute</label><input type="number" id="q-fab-jute" min="0" step="1" /></div>
          </div>
        </div>
      </div>
      <div class="row mt-2" style="gap:8px;align-items:center;">
        <button class="btn btn-primary" id="btn-save-quotas">Enregistrer les quotas</button>
        <span class="muted" id="lbl-quotas-state" style="font-size:0.78rem;">—</span>
      </div>
    </div>
  </div>
  ` : ''}

  <div class="page-toolbar">
    <select id="filtre-role" title="Filtrer par rôle">
      <option value="">Tous rôles</option>
      ${Object.entries(ROLE_LABELS).map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}
    </select>
    <select id="filtre-statut" title="Filtrer par statut">
      <option value="">Tous statuts</option>
      <option value="actif">Actifs</option>
      <option value="suspendu">Suspendus</option>
    </select>
    <input type="text" id="filtre-recherche" placeholder="Rechercher (nom, Discord)" style="flex:1;min-width:160px;" />
  </div>

  <div class="panel framed">
    <div class="panel-title"><span id="titre-effectif">Effectif</span></div>
    <div class="table-scroll">
      <table class="data" id="table-rh">
        <thead id="thead-rh">
          <tr>
            <th data-sort="nom">Nom</th>
            <th data-sort="role">Rôle</th>
            <th data-sort="discord">ID Discord</th>
            <th class="right" data-sort="heures">Heures</th>
            <th class="right" data-sort="caQuota">CA / Quota</th>
            <th class="right" data-sort="salaire">Salaire estimé</th>
            <th data-sort="statut">Statut</th>
            <th class="center">Actions</th>
          </tr>
        </thead>
        <tbody id="tbody-rh"><tr><td colspan="8" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title"><span>Activité de la semaine</span></div>
    <div id="activite">—</div>
  </div>

  <!-- Modal détail employé -->
  <div id="modal-employe" class="modal-backdrop hidden">
    <div class="modal" style="max-width: 920px;max-height:92vh;overflow-y:auto;">
      <h3 id="emp-nom">—</h3>
      <div id="emp-content">—</div>
      <div class="row mt-3">
        ${editable ? '<button class="btn btn-primary" id="btn-decide-salaire" title="Décider un salaire fixe (responsables/direction)">Décider salaire</button>' : ''}
        <button class="btn" id="btn-voir-espace" title="Ouvrir l'espace personnel de cet employé (lecture seule, debug)">Voir son espace</button>
        <button class="btn btn-ghost" id="btn-close-emp">Fermer</button>
      </div>
    </div>
  </div>
`;
renderShell(profile, 'rh', html);

makeSortable(document.getElementById('table-rh'));

function labelSemaine(debut, fin) {
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return `${fmt(debut)} → ${fmt(fin)}`;
}

let users = [], ventes = [], ventesAvecCachees = [], services = [],
    quotas = [], paies = [], config = {}, redistributions = [],
    quotasVendeur = [];
let debut, fin, wId;

// Listener temps-reel sur /config/global : tablettes in-game (pas de F5).
// Reload si un quota/prix change pendant que la page est ouverte.
let _cfgSigRh = null;
listenConfig((newCfg) => {
  const sig = JSON.stringify({
    qB: newCfg.quotaBidons,
    qC: newCfg.quotaCaoutchoucs,
    qCA: newCfg.quotaCAVendeur,
    qF: newCfg.quotaFabrication || null,
    pE: newCfg.prixEssence
  });
  if (_cfgSigRh == null) { _cfgSigRh = sig; return; }
  if (sig !== _cfgSigRh) {
    console.log('[rh] config changee live -> reload');
    window.location.reload();
  }
});
let metricsByUser = {};
// Snapshots /paiesEstimees pour la semaine cible (uniquement en mode 'precedente')
let snapshotsByUser = {};                 // userId -> doc snapshot
let snapshotMode = false;                 // true si on est en mode "semaine precedente"
let canEditVerse = editable;              // direction/DRH/admin-tech peuvent cocher

// Reçoit un payload de semaine-selector :
//   { weekKey, debut, fin, statut, statutLabel, isCurrent, semaine }
// - isCurrent = true  : semaine en cours, mode live (recalcul ventes/services).
// - isCurrent = false : semaine clôturée, mode snapshot (lecture /paiesEstimees + checkbox Versé).
async function chargerSemaine(payload) {
  debut = payload.debut;
  fin   = payload.fin;
  wId   = payload.isCurrent ? weekId() : payload.weekKey;
  snapshotMode = !payload.isCurrent;
  document.getElementById('badge-semaine').textContent =
    `${snapshotMode ? 'À PAYER · ' : ''}${labelSemaine(debut, fin)}`;
  document.getElementById('titre-effectif').textContent =
    snapshotMode
      ? `Effectif — ${payload.statutLabel || 'semaine clôturée'} (${labelSemaine(debut, fin)})`
      : 'Effectif — semaine en cours';

  // Le nombre de colonnes change selon le mode (+ colonne "Versé ?")
  const ncols = snapshotMode ? 9 : 8;
  document.getElementById('tbody-rh').innerHTML =
    `<tr><td colspan="${ncols}" class="muted text-center">Chargement…</td></tr>`;

  // On charge en parallele : meme set qu'avant + snapshots en mode 'precedente'.
  const tasks = [
    listUsers().catch(() => []),
    listVentesSemaine(debut, fin).catch(() => []),
    listVentesSemaineIncluantCachees(debut, fin).catch(() => []),
    listServicesSemaine(debut, fin).catch(() => []),
    listQuotasSemaine(wId).catch(() => []),
    listPaiesSemaine(debut, fin, wId).catch(() => []),
    getConfig().catch(() => ({})),
    listRedistributionsSemaine(debut, fin).catch(() => []),
    snapshotMode ? listPaiesEstimeesSemaine(wId).catch(() => []) : Promise.resolve([]),
    listQuotasVendeurSemaine(wId).catch(() => [])
  ];

  const [u, v, vc, s, q, p, c, r, snaps, qv] = await Promise.all(tasks);
  users = u; ventes = v; ventesAvecCachees = vc; services = s;
  quotas = q; paies = p; config = c; redistributions = r;
  quotasVendeur = qv;

  snapshotsByUser = {};
  (snaps || []).forEach(sn => { if (sn.userId) snapshotsByUser[sn.userId] = sn; });

  renderTableHeader();
  calculerMetriques();
  renderKpis();
  renderTable();
  renderActivite();
}

// === En-tete table : ajoute/retire la colonne "Versé ?" selon mode ===
function renderTableHeader() {
  const thead = document.getElementById('thead-rh');
  const colVerse = snapshotMode
    ? `<th class="center" data-sort="paye" title="Cocher quand la paie a ete versee IG (lundi 00h-01h)">Versé&nbsp;?</th>`
    : '';
  thead.innerHTML = `
    <tr>
      <th data-sort="nom">Nom</th>
      <th data-sort="role">Rôle</th>
      <th data-sort="discord">ID Discord</th>
      <th class="right" data-sort="heures">Heures</th>
      <th class="right" data-sort="caQuota">CA / Quota</th>
      <th class="right" data-sort="salaire">Salaire estimé</th>
      ${colVerse}
      <th data-sort="statut">Statut</th>
      <th class="center">Actions</th>
    </tr>
  `;
  // Re-attache le sortable apres modification du DOM
  makeSortable(document.getElementById('table-rh'));
}

// === Auto-detection match paie /paies <-> snapshot ===
// Retourne la paie /paies la plus probable pour un snapshot non paye, ou null.
// Critere : meme beneficiaireId + montant a +/- 5% du montantEstime.
// La fenetre temporelle est deja celle de listPaiesSemaine (lundi N+1 00h ->
// mardi N+1 21h), pas besoin de re-filtrer.
function trouverPaieMatchee(snap) {
  if (!snap || snap.paye) return null;
  const cible = snap.montantEstime || 0;
  if (cible <= 0) return null;
  const tol = Math.max(500, cible * 0.05); // tolerance 5% mini 500$
  const candidates = paies.filter(p => {
    if (p.beneficiaireId !== snap.userId) return false;
    const m = Number(p.montant) || 0;
    return Math.abs(m - cible) <= tol;
  });
  if (candidates.length === 0) return null;
  // Renvoie la plus proche (en valeur absolue de l'ecart)
  candidates.sort((a, b) =>
    Math.abs((Number(a.montant) || 0) - cible) - Math.abs((Number(b.montant) || 0) - cible)
  );
  return candidates[0];
}

// === Calculer les métriques par employé ===
// caTotal : tout le CA (sert au LTD pour la compta)
// caParticulier : seulement les ventes "particulier" (sert au calcul de la commission vendeur)
//                 Fallback sur v.montant si montantParticulier n'existe pas encore (vente historique)
function calculerMetriques() {
  metricsByUser = {};
  users.forEach(u => {
    const myVentes = ventes.filter(v => v.vendeurId === u.id);
    const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente'; // don/subvention hors CA & hors commission
    const ca = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montant || 0) : 0), 0);
    const caParticulier = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0);
    const benefice = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.benefice || 0) : 0), 0);

    const myServices = services.filter(s => s.employeId === u.id);
    const heuresMs = myServices.reduce((s, x) => s + (x.duree || 0), 0);

    const myQuota = quotas.find(q => q.employeId === u.id) || { bidons: 0, caoutchoucs: 0 };
    const myQuotaV = quotasVendeur.find(q => q.employeId === u.id) || {};
    const fabrications = fabricationsFromQuotaDoc(myQuotaV);

    const myPaies = paies.filter(p => p.beneficiaireId === u.id);
    const totalPaie = myPaies.reduce((s, p) => s + (p.montant || 0), 0);

    const employe = {
      role: u.role,
      caGenere: caParticulier, // commission sur particulier seulement
      bidonsRealises: myQuota.bidons || 0,
      caoutchoucsRealises: myQuota.caoutchoucs || 0,
      fabrications,
      salaireDecide: u.salaireDecide || 0
    };
    const estime = salaireEstime(employe, config, wId); // date la formule sur la semaine AFFICHEE (sinon fallback live errone sur semaine passee)

    metricsByUser[u.id] = {
      ca, caParticulier, benefice, heuresMs, ventes: myVentes,
      bidons: myQuota.bidons || 0,
      caoutchoucs: myQuota.caoutchoucs || 0,
      fabrications,
      salaireEstime: estime,
      totalPaie
    };
  });
}

// === KPIs ===
function renderKpis() {
  // On exclut les rôles techniques (admin-technique) des calculs financiers / masse salariale
  const usersFinance = users.filter(u => compteEnFinance(u.role));
  const caProduits   = ventes.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montant || 0) : 0), 0); // dénominateur masse/CA TTE : hors dons
  // CA carburant POMPISTE seulement (source 'manuel-pompiste') : exclut les
  // ventes NPC automatiques (source 'banqueLtd-redistribution') qui ne sont
  // liees a aucun employe. Avant le fix, ces ventes gonflaient le denominateur
  // et faisaient apparaitre le ratio TTE artificiellement bas.
  const caCarburant  = redistributions
    .filter(r => r.source === 'manuel-pompiste')
    .reduce((s, r) => s + (Number(r.montant) || 0), 0);
  // TTE : ratio masse salariale sur CA OPERATIONNEL POMPISTE (produits +
  // carburant manuel), denominateur coherent avec les salaires variables des
  // employes. Reflete la vraie pression masse salariale / CA generable par
  // l'equipe.
  const totalCA = caProduits + caCarburant;

  // En mode 'precedente', on lit les estimations FIGEES dans /paiesEstimees
  // (snapshot a la cloture). En mode 'courante', calcul live comme avant.
  let totalEstime, kpisExtra = '';
  if (snapshotMode) {
    // Effectif estimé = snapshot figé si > 0, sinon recalcul live (snapshot de
    // clôture partielle/incomplète -> on ne sous-estime pas la masse à verser).
    let resteAVerser = 0, nbARegler = 0;
    totalEstime = 0;
    usersFinance.forEach(u => {
      const sn = snapshotsByUser[u.id];
      const eff = (sn && Number(sn.montantEstime) > 0) ? Number(sn.montantEstime) : (metricsByUser[u.id]?.salaireEstime || 0);
      totalEstime += eff;
      const paye = sn ? !!sn.paye : false;
      if (!paye) { resteAVerser += eff; if (eff > 0) nbARegler++; }
    });
    kpisExtra = `
      <div class="kpi" style="border-color:var(--color-gold,#d4b14d);">
        <div class="label">Reste à verser</div>
        <div class="value">${money(resteAVerser)}</div>
        <div class="delta">${nbARegler} employé(s) non coché(s)</div>
      </div>
    `;
  } else {
    totalEstime = usersFinance.reduce((s, u) => s + (metricsByUser[u.id]?.salaireEstime || 0), 0);
  }

  const totalVerse = paies.reduce((s, p) => s + (p.montant || 0), 0);
  const masse = checkMasseSalariale(totalEstime, totalCA);
  const actifs = usersFinance.filter(u => u.statut === 'actif').length;
  const technicians = users.filter(u => isSuperAdmin(u.role) && u.statut === 'actif').length;
  const deltaEstime = snapshotMode ? 'figé à la clôture' : 'cette semaine';
  const labelVerse = snapshotMode ? `paies /paies fenêtre lun→mar` : 'via paie Discord';

  document.getElementById('kpis-rh').innerHTML = `
    <div class="kpi"><div class="label">Effectif actif</div><div class="value">${actifs}</div><div class="delta">/ ${usersFinance.length} comptes${technicians > 0 ? ` <span style="color:var(--color-gold);">+${technicians} tech</span>` : ''}</div></div>
    <div class="kpi"><div class="label">Salaires estimés</div><div class="value">${money(totalEstime)}</div><div class="delta">${deltaEstime}</div></div>
    <div class="kpi"><div class="label">Salaires versés</div><div class="value">${money(totalVerse)}</div><div class="delta">${labelVerse}</div></div>
    <div class="kpi"><div class="label">Masse salariale</div><div class="value">${pct(masse.ratio*100,1)}</div><div class="delta ${masse.ok ? 'up' : 'down'}">limite TTE: 90%</div></div>
    ${kpisExtra}
  `;

  // Bandeau : semaine en cours encore vide (typiquement au créneau de paie du
  // lundi) -> aiguille vers la dernière semaine clôturée pour voir les salaires.
  const banner = document.getElementById('rh-banner');
  if (banner) {
    const sel = document.getElementById('filtre-semaine');
    const closedOpt = sel ? [...sel.options].find(o => o.value !== 'current') : null;
    if (!snapshotMode && totalCA === 0 && closedOpt) {
      banner.innerHTML = `<div class="alert warn" style="margin-bottom:10px;">Semaine en cours encore vide — les salaires variables s'affichent à 0. Pour voir les montants à verser, sélectionne la dernière semaine clôturée. <button class="btn btn-sm" id="rh-goto-closed">Voir la semaine clôturée</button></div>`;
      const b = document.getElementById('rh-goto-closed');
      if (b) b.addEventListener('click', () => { sel.value = closedOpt.value; sel.dispatchEvent(new Event('change')); });
    } else {
      banner.innerHTML = '';
    }
  }
}

// === Filtres + render table ===
function renderTable() {
  const fr = document.getElementById('filtre-role').value;
  const fs = document.getElementById('filtre-statut').value;
  const fq = document.getElementById('filtre-recherche').value.toLowerCase().trim();

  // Exclut les rôles techniques (admin-technique) du tableau effectif
  let rows = users.filter(u => compteEnFinance(u.role));
  if (fr) rows = rows.filter(u => u.role === fr);
  if (fs) rows = rows.filter(u => (u.statut || 'actif') === fs);
  if (fq) rows = rows.filter(u =>
    `${u.prenom} ${u.nom}`.toLowerCase().includes(fq) ||
    (u.idDiscord || '').toLowerCase().includes(fq) ||
    (u.idPerso || '').toLowerCase().includes(fq)
  );

  const tbody = document.getElementById('tbody-rh');
  const ncols = snapshotMode ? 9 : 8;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${ncols}" class="muted text-center">Aucun employé.</td></tr>`;
    return;
  }
  // Hoiste hors de la boucle map : valeurs invariantes par row.
  const nouveauVendeur = isNouveauSystemeVendeur(config);
  const quotaCAShow = Number(config.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  const quotaFabActif = Object.values(config.quotaFabrication || {}).some(v => Number(v) > 0);

  tbody.innerHTML = rows.map(u => {
    const m = metricsByUser[u.id] || {};
    const heures = durationHM(m.heuresMs || 0);
    const heuresOK = (m.heuresMs || 0) >= 7 * 3600 * 1000;
    const heuresMark = heuresOK ? '' : '<span class="muted">!</span> ';
    const plafond = PLAFOND_SALAIRE[u.role] || 0;

    // En mode snapshot : source de verite = doc /paiesEstimees figeé.
    // (Si pas de snapshot pour cet user, fallback sur calcul live = 0 etc.)
    const snap = snapshotMode ? snapshotsByUser[u.id] : null;
    // Snapshot fiable seulement s'il est figé à une valeur > 0. Si absent OU figé
    // à 0 (clôture partielle/incomplète), on retombe sur le recalcul LIVE de la
    // semaine sélectionnée (= la vraie valeur, identique à l'endpoint estimé).
    const snapOk = !!(snap && Number(snap.montantEstime) > 0);
    const salaireEstime = snapOk ? Number(snap.montantEstime) : (m.salaireEstime || 0);
    const caShow = snapOk ? (Number(snap.caParticulier) || Number(snap.ca) || 0) : (m.caParticulier ?? m.ca ?? 0);
    const caTotal = snapOk ? (Number(snap.ca) || 0) : (m.ca || 0);
    const bidonsShow = snapOk ? (snap.bidons || 0) : (m.bidons || 0);
    const caoutShow = snapOk ? (snap.caoutchoucs || 0) : (m.caoutchoucs || 0);

    let progressLabel = '—';
    if (isVendeur(u.role)) {
      const part = caTotal > 0 && caShow < caTotal
        ? ` <span class="muted" style="font-size:0.72rem;">(sur ${money(caTotal)} total)</span>`
        : '';
      let fabLabel = '';
      if (nouveauVendeur && quotaFabActif) {
        const fabSnap = (snapOk && snap.fabrications) ? snap.fabrications : (m.fabrications || {});
        const scoreFab = scoreQuotaFabrication(fabSnap, config.quotaFabrication || {});
        fabLabel = `<br><span class="muted" style="font-size:0.72rem;">quota fab ${pct(scoreFab*100, 0)} · bonus ${money(Math.round(scoreFab * BONUS_QUOTA_VENDEUR_MAX))}</span>`;
      }
      progressLabel = `${money(caShow)} / ${money(quotaCAShow)}${part}${fabLabel}`;
    } else if (isPompiste(u.role)) {
      const score = scorePompiste(bidonsShow, caoutShow, config.quotaBidons, config.quotaCaoutchoucs);
      progressLabel = `${pct(score, 0)}`;
    } else if (u.role === 'livreur') {
      progressLabel = `${money(caShow)} <span class="muted" style="font-size:0.72rem;">CA livraisons · sans quota</span>`;
    } else if (u.role === 'chef-equipe') {
      progressLabel = `${money(caShow)} <span class="muted" style="font-size:0.72rem;">CA · fixe 8 000 + part CA</span>`;
    } else if (isResponsable(u.role) || isDirection(u.role) || u.role === 'drh') {
      progressLabel = `Décidé`;
    }

    // === Colonne "Versé ?" (mode snapshot uniquement) ===
    let cellVerse = '';
    if (snapshotMode) {
      if (!snap) {
        cellVerse = `<td class="center muted" title="Pas de snapshot — semaine non clôturée ou employé créé après">—</td>`;
      } else {
        const paye = !!snap.paye;
        const match = !paye ? trouverPaieMatchee(snap) : null;
        const matchInfo = match
          ? `<span class="badge ok" style="font-size:0.68rem;" title="Paie /paies probable : ${money(match.montant)} le ${datetime(match.timestamp)}">≈ ${money(match.montant)}</span>`
          : '';
        const dejaPaye = paye
          ? `<span class="badge ok" style="font-size:0.68rem;" title="${snap.paieMatcheeMontant ? 'Lié à paie ' + money(snap.paieMatcheeMontant) : 'Coché manuellement'}">payé</span>`
          : '';
        // Pre-coche visuelle si match auto detecté (mais pas encore enregistre)
        // -> on garde paye=false en base, on flag visuellement.
        const matchAttr = match ? `data-paie-match="${escapeHtml(match.id)}"` : '';
        const ecart = match ? (Number(match.montant) || 0) - (Number(snap.montantEstime) || 0) : 0;
        const ecartLabel = match && Math.abs(ecart) > 0
          ? `<span class="muted" style="font-size:0.66rem;display:block;color:${Math.abs(ecart) > 1000 ? 'var(--color-red,#c0392b)' : 'var(--color-orange,#e07b00)'};">écart ${ecart > 0 ? '+' : ''}${money(ecart)}</span>`
          : '';
        const disabledAttr = canEditVerse ? '' : 'disabled';
        cellVerse = `
          <td class="center">
            <label style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:${canEditVerse ? 'pointer' : 'default'};">
              <input type="checkbox" class="chk-paye"
                data-snap="${escapeHtml(snap.id)}"
                ${matchAttr}
                ${paye ? 'checked' : ''}
                ${disabledAttr}
                title="Cocher quand la paie a ete versee" />
              ${dejaPaye || matchInfo}
              ${ecartLabel}
            </label>
          </td>
        `;
      }
    }

    return `
      <tr>
        <td><strong>${escapeHtml(u.prenom)} ${escapeHtml(u.nom)}</strong></td>
        <td><span class="badge neutral">${ROLE_LABELS[u.role] || u.role}</span></td>
        <td class="mono">${escapeHtml(u.idDiscord || '—')}</td>
        <td class="right mono">${heuresMark}${heures}</td>
        <td class="right mono">${progressLabel}</td>
        <td class="right mono">${money(salaireEstime)} <span class="muted" style="font-size:0.7rem;">/ ${money(plafond)}</span></td>
        ${cellVerse}
        <td><span class="badge ${u.statut === 'actif' ? 'ok' : 'warn'}">${u.statut || 'actif'}</span></td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-ghost" data-detail="${u.id}" title="Voir le détail (heures, ventes, salaire estimé)" data-tooltip="Détail">Détail</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-detail]').forEach(b => {
    b.addEventListener('click', () => ouvrirDetail(b.dataset.detail));
  });

  // === Handler checkbox "Versé ?" ===
  if (snapshotMode && canEditVerse) {
    tbody.querySelectorAll('.chk-paye').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const snapId = chk.dataset.snap;
        const paye = chk.checked;
        const paieMatcheeId = paye ? (chk.dataset.paieMatch || null) : null;
        chk.disabled = true;
        try {
          await marquerPaieVersee({ snapshotId: snapId, paye, paieMatcheeId });
          // Met a jour le snapshot local + KPIs sans tout recharger
          const sn = Object.values(snapshotsByUser).find(s => s.id === snapId);
          if (sn) {
            sn.paye = paye;
            sn.datePaiement = paye ? new Date() : null;
            sn.paieMatcheeId = paieMatcheeId;
          }
          renderKpis();
          renderTable();
          toastSuccess(paye ? 'Paie marquée versée.' : 'Décoché.');
        } catch (err) {
          chk.checked = !paye; // rollback visuel
          toastError(err?.message || 'Erreur enregistrement');
        } finally {
          chk.disabled = false;
        }
      });
    });
  }
}
['filtre-role', 'filtre-statut', 'filtre-recherche'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderTable);
});

// === Bloc Quotas hebdomadaires (centralise, direction/DRH/admin-tech) ===
// Regroupe les 3 familles : pompiste (bidons/caoutchoucs), vendeur CA,
// vendeur fabrication (4 produits). Source unique, evite la dispersion.
if (editable) {
  const toggleBtn = document.getElementById('btn-toggle-quotas');
  const blocQ     = document.getElementById('bloc-quotas');
  const lblState  = document.getElementById('lbl-quotas-state');

  function ouvrirQuotas() {
    const c = config || {};
    document.getElementById('q-bidons').value      = c.quotaBidons      ?? 1700;
    document.getElementById('q-caoutchoucs').value = c.quotaCaoutchoucs ?? 800;
    document.getElementById('q-ca-vendeur').value  = c.quotaCAVendeur   ?? 50000;
    const qf = c.quotaFabrication || {};
    document.getElementById('q-fab-eau').value       = qf['bouteille-eau-purifiee']?? 0;
    document.getElementById('q-fab-mastic').value    = qf['mastic-carrosserie']    ?? 0;
    document.getElementById('q-fab-visseries').value = qf['visseries']             ?? 0;
    document.getElementById('q-fab-pain').value      = qf['pain-burger']           ?? 0;
    document.getElementById('q-fab-lumiere').value   = qf['lumiere-violette']      ?? 0;
    document.getElementById('q-fab-jute').value      = qf['sac-jute']              ?? 0;
    blocQ.classList.remove('hidden');
    toggleBtn.textContent = 'Masquer';
    lblState.textContent = 'Valeurs chargées · 0 = produit désactivé.';
  }
  function fermerQuotas() {
    blocQ.classList.add('hidden');
    toggleBtn.textContent = 'Afficher';
  }
  toggleBtn.addEventListener('click', () => {
    if (blocQ.classList.contains('hidden')) ouvrirQuotas();
    else fermerQuotas();
  });

  document.getElementById('btn-save-quotas').addEventListener('click', async () => {
    const parseQ = (id, fallback) => {
      const v = Number(document.getElementById(id).value);
      return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
    };
    const patch = {
      quotaBidons:      parseQ('q-bidons',      1700),
      quotaCaoutchoucs: parseQ('q-caoutchoucs',  800),
      quotaCAVendeur:   parseQ('q-ca-vendeur', 50000),
      quotaFabrication: {
        'bouteille-eau-purifiee': parseQ('q-fab-eau',       0),
        'mastic-carrosserie':     parseQ('q-fab-mastic',    0),
        'visseries':              parseQ('q-fab-visseries', 0),
        'pain-burger':            parseQ('q-fab-pain',      0),
        'lumiere-violette':       parseQ('q-fab-lumiere',   0),
        'sac-jute':               parseQ('q-fab-jute',      0)
      }
    };
    try {
      lblState.textContent = 'Enregistrement…';
      await setConfig(patch);
      lblState.textContent = 'Quotas enregistrés — les pages employé se rechargent automatiquement.';
      toastSuccess('Quotas mis à jour.');
    } catch (e) {
      console.error('[rh] setConfig quotas', e);
      lblState.textContent = 'Erreur lors de l\'enregistrement.';
      toastError(e.message || 'Erreur enregistrement.');
    }
  });
}

// Sélecteur de semaine factorisé : courante + N dernières clôturées (snapshots).
// Appelle chargerSemaine immédiatement avec le payload de la semaine restaurée
// depuis sessionStorage (clé "rh-semaine") ou "current" par défaut.
await initSemaineSelector('#filtre-semaine', {
  storageKey: 'rh-semaine',
  defaultLastClosed: true,
  onChange: chargerSemaine
});

// Pre-remplit le champ de recherche depuis ?q=... (lien profond depuis /stocks)
const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) document.getElementById('filtre-recherche').value = _qParam;

function ouvrirDetail(uid) {
  const u = users.find(x => x.id === uid);
  if (!u) return;
  const m = metricsByUser[uid] || {};

  document.getElementById('emp-nom').textContent = `${u.prenom} ${u.nom} — ${ROLE_LABELS[u.role]}`;
  let html = `
    <p class="muted">
      ID Discord: <span class="mono">${escapeHtml(u.idDiscord || '—')}</span> ·
      ID Perso: <span class="mono">${escapeHtml(u.idPerso || '—')}</span> ·
      Entrée: ${u.dateEntree || '—'}
    </p>
    <table class="data">
      <tbody>
        <tr><td>Heures de service</td><td class="right mono">${durationHM(m.heuresMs || 0)}</td></tr>
        <tr><td>Salaires versés</td><td class="right mono">${money(m.totalPaie || 0)}</td></tr>
        <tr><td>Salaire estimé (semaine)</td><td class="right mono">${money(m.salaireEstime || 0)}</td></tr>
        <tr><td>Plafond TTE</td><td class="right mono">${money(PLAFOND_SALAIRE[u.role] || 0)}</td></tr>
  `;
  if (isVendeur(u.role) || u.role === 'livreur' || u.role === 'chef-equipe') {
    const cp = m.caParticulier ?? m.ca ?? 0;
    const caPro = (m.ca || 0) - cp;
    html += `
      <tr><td>CA total généré</td><td class="right mono">${money(m.ca || 0)}</td></tr>
      <tr><td>↳ CA particulier <span class="muted">(commissionnable)</span></td><td class="right mono">${money(cp)}</td></tr>
      ${caPro > 0 ? `<tr><td>↳ CA pro <span class="muted">(non commissionné)</span></td><td class="right mono">${money(caPro)}</td></tr>` : ''}
      <tr><td>Bénéfice généré pour le LTD</td><td class="right mono">${money(m.benefice || 0)}</td></tr>
      <tr><td>Nombre de ventes</td><td class="right mono">${(m.ventes || []).length}</td></tr>
    `;
    // Decomposition CA + bonus fab : vendeurs uniquement (chef/livreur n'ont pas de bonus fab)
    if (isVendeur(u.role) && isNouveauSystemeVendeur(config)) {
      const plafondCA = PLAFOND_CA_VENDEUR[u.role] || 0;
      const quotaCAConfig = Number(config.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
      const salaireCAPart = Math.round((quotaCAConfig > 0 ? Math.min(1, cp / quotaCAConfig) : 0) * plafondCA);
      const fab = m.fabrications || {};
      const qFab = config.quotaFabrication || {};
      const scoreFab = scoreQuotaFabrication(fab, qFab);
      const bonusFab = Math.round(scoreFab * BONUS_QUOTA_VENDEUR_MAX);
      html += `<tr><td>Part CA du salaire <span class="muted">(prorata ${money(quotaCAConfig)})</span></td><td class="right mono">${money(salaireCAPart)} / ${money(plafondCA)}</td></tr>`;
      const produitsAffiches = PRODUITS_QUOTA_FAB.filter(id => Number(qFab[id] || 0) > 0 || Number(fab[id] || 0) > 0);
      if (produitsAffiches.length > 0) {
        html += `<tr><td colspan="2" class="muted" style="padding-top:10px;font-weight:bold;">Quota fabrication</td></tr>`;
        for (const id of produitsAffiches) {
          const q = Number(qFab[id] || 0);
          const f = Number(fab[id] || 0);
          const lbl = q === 0 ? `${f} (hors quota)` : `${f} / ${q}`;
          html += `<tr><td>↳ ${escapeHtml(nomProduit(id))}</td><td class="right mono">${lbl}</td></tr>`;
        }
        html += `<tr><td>Score quota fabrication</td><td class="right mono">${pct(scoreFab * 100, 0)}</td></tr>`;
        html += `<tr><td>Bonus quota du salaire</td><td class="right mono">${money(bonusFab)} / ${money(BONUS_QUOTA_VENDEUR_MAX)}</td></tr>`;
      }
    }
  }
  if (isPompiste(u.role)) {
    const score = scorePompiste(m.bidons, m.caoutchoucs, config.quotaBidons, config.quotaCaoutchoucs);
    html += `
      <tr><td>Bidons réalisés</td><td class="right mono">${m.bidons || 0} / ${(config.quotaBidons ?? 1700) === 0 ? '0 (désactivé)' : (config.quotaBidons ?? 1700)}</td></tr>
      <tr><td>Caoutchoucs réalisés</td><td class="right mono">${m.caoutchoucs || 0} / ${(config.quotaCaoutchoucs ?? 800) === 0 ? '0 (désactivé)' : (config.quotaCaoutchoucs ?? 800)}</td></tr>
      <tr><td>Score global</td><td class="right mono">${pct(score, 1)}</td></tr>
    `;
  }
  html += `</tbody></table>`;

  // === Table des factures (vendeurs uniquement) ===
  // Affiche TOUTES les factures (manuelles + bot, y compris les cachees en
  // doublon) pour permettre la comparaison "ce que le bot a vu" vs "ce que
  // le vendeur a declare".
  if (isVendeur(u.role)) {
    const mesVentes = ventesAvecCachees
      .filter(v => v.vendeurId === uid)
      .sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));

    if (mesVentes.length === 0) {
      html += `<p class="muted mt-3">Aucune facture cette semaine.</p>`;
    } else {
      const nbBot = mesVentes.filter(v => v.source !== 'manuelle').length;
      const nbMan = mesVentes.filter(v => v.source === 'manuelle').length;
      const nbAnn = mesVentes.filter(v => v.annulee).length;
      const nbCac = mesVentes.filter(v => v.cachee && !v.annulee).length;
      html += `
        <h4 class="mt-3" style="margin-bottom:6px;">Factures de la semaine — comparaison bot / manuelle</h4>
        <p class="muted" style="font-size:0.78rem;margin:0 0 8px;">
          ${mesVentes.length} factures totales · ${nbBot} bot · ${nbMan} manuelles · ${nbCac > 0 ? `<span class="alerte-fort">${nbCac} cachées (doublons)</span>` : '0 cachée'}${nbAnn > 0 ? ` · <span class="alerte-fort">${nbAnn} annulée${nbAnn > 1 ? 's' : ''} IG</span>` : ''}
        </p>
        <div class="table-scroll" style="max-height:380px;">
        <table class="data" style="font-size:0.8rem;">
          <thead><tr>
            <th>Date</th>
            <th class="center">Source</th>
            <th>#Facture</th>
            <th>Client</th>
            <th class="right">Montant</th>
            <th class="right">Bénéf</th>
            <th class="right">Commissionnable</th>
            <th class="center">Statut</th>
          </tr></thead>
          <tbody>
            ${mesVentes.map(v => {
              const date = datetime(v.timestamp);
              const isManuelle = v.source === 'manuelle';
              const source = isManuelle
                ? '<span class="badge ok" title="Déclarée manuellement par le vendeur">Manuelle</span>'
                : '<span class="badge neutral" title="Remontée automatiquement par le bot Discord">Bot</span>';
              const cm = v.montantParticulier ?? v.montant ?? 0;
              const benefice = v.benefice != null ? money(v.benefice) : '<span class="muted">—</span>';
              let statut, trClass = '';
              if (v.annulee) {
                const motif = escapeHtml(v.motifAnnulation || 'Annulée');
                statut = `<span class="badge warn" title="${motif}">Annulée</span>`;
                trClass = 'muted';
              } else if (v.cachee) {
                statut = `<span class="badge warn" title="Doublon caché — remplacée par #${v.remplaceeParFactureId || '?'}">Cachée</span>`;
                trClass = 'muted';
              } else if (cm === 0 && (v.montant || 0) > 0) {
                statut = '<span class="badge neutral" title="Ne compte pas dans la commission (produits pro)">CA pro</span>';
              } else {
                statut = '<span class="badge ok">Compte</span>';
              }
              return `
                <tr class="${trClass}">
                  <td class="mono" style="font-size:0.75rem;">${date}</td>
                  <td class="center">${source}</td>
                  <td class="mono">#${escapeHtml(String(v.factureId || v.id || ''))}</td>
                  <td>${escapeHtml(v.client || '—')}</td>
                  <td class="right mono">${money(v.montant || 0)}</td>
                  <td class="right mono">${benefice}</td>
                  <td class="right mono ${cm > 0 ? '' : 'muted'}">${cm > 0 ? money(cm) : '—'}</td>
                  <td class="center">${statut}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        </div>
        <p class="muted" style="font-size:0.74rem;margin:4px 0 0;">
          <strong>Comparaison</strong> : si tu vois 2 lignes pour la même vente (1 bot + 1 manuelle avec même montant), la bot est cachée — seule la manuelle compte. ${nbCac > 0 ? 'Détecte automatiquement les doublons.' : 'Aucun doublon détecté cette semaine pour cet employé.'}
        </p>
      `;
    }
  }

  // === Bloc salaire ===
  // DRH : montant FIXE 18 000 $ (decision patron) — pas de saisie
  // Responsable Vente / Responsable Pompiste : decide manuellement par patron
  //   (depuis 2026-05-24, traitement identique : ses ventes/crafts ne sont
  //    PAS commissionnes — salaire fixe au plafond 17 000 $ ou montant decide).
  // Patron / Co-Patron : decide manuellement
  if (u.role === 'drh') {
    html += `
      <div class="alert info" style="font-size:0.85rem;">
        <strong>Salaire DRH fixe : 18 000 $/semaine</strong> — imposé par le patron, non modifiable.
      </div>
    `;
  } else if (isResponsable(u.role) || isDirection(u.role)) {
    html += `
      <label>Salaire décidé (max ${money(PLAFOND_SALAIRE[u.role])}) — pour ${ROLE_LABELS[u.role]}</label>
      <input type="number" id="emp-salaire-decide" min="0" value="${u.salaireDecide || PLAFOND_SALAIRE[u.role]}" />
    `;
  }

  document.getElementById('emp-content').innerHTML = html;
  document.getElementById('modal-employe').dataset.uid = uid;
  document.getElementById('modal-employe').classList.remove('hidden');
}

document.getElementById('btn-close-emp').addEventListener('click', () => {
  document.getElementById('modal-employe').classList.add('hidden');
});

// Bouton "Voir son espace" : ouvre employee.html?asUser=UID en mode debug
document.getElementById('btn-voir-espace').addEventListener('click', () => {
  const uid = document.getElementById('modal-employe').dataset.uid;
  if (!uid) return;
  window.location.href = `employee.html?asUser=${encodeURIComponent(uid)}`;
});

const btnDecide = document.getElementById('btn-decide-salaire');
if (btnDecide) {
  btnDecide.addEventListener('click', async () => {
    const uid = document.getElementById('modal-employe').dataset.uid;
    const input = document.getElementById('emp-salaire-decide');
    if (!input) return toastError("Pas de champ salaire pour ce rôle.");
    const v = Number(input.value) || 0;
    const u = users.find(x => x.id === uid);
    if (!u) return;
    const plaf = PLAFOND_SALAIRE[u.role] || 0;
    if (v > plaf) return toastError(`Plafond TTE: ${money(plaf)}.`);
    try {
      await updateUser(uid, { salaireDecide: v });
      toastSuccess("Salaire décidé enregistré.");
    } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); }
  });
}

// === Activité de la semaine ===
function renderActivite() {
  const usersById = users.reduce((m, u) => (m[u.id] = u, m), {});
  const div = document.getElementById('activite');
  if (services.length === 0 && paies.length === 0) {
    div.innerHTML = `<p class="muted">Aucune activité sur cette semaine.</p>`;
    return;
  }
  const parEmp = {};
  services.forEach(s => {
    if (!parEmp[s.employeId]) parEmp[s.employeId] = { duree: 0, sessions: 0 };
    parEmp[s.employeId].duree += s.duree || 0;
    parEmp[s.employeId].sessions += 1;
  });
  const sorted = Object.entries(parEmp).sort((a, b) => b[1].duree - a[1].duree);
  div.innerHTML = `
    <table class="data" id="table-activite">
      <thead><tr>
        <th data-sort="emp">Employé</th>
        <th class="right" data-sort="sessions">Sessions</th>
        <th class="right" data-sort="heures">Heures totales</th>
      </tr></thead>
      <tbody>
        ${sorted.map(([uid, s]) => {
          const u = usersById[uid];
          return `<tr>
            <td>${u ? escapeHtml(u.prenom + ' ' + u.nom) : uid}</td>
            <td class="right mono">${s.sessions}</td>
            <td class="right mono" data-sort-value="${s.duree}">${durationHM(s.duree)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  const tAct = document.getElementById('table-activite');
  wrapScroll(tAct, 400);
  makeSortable(tAct);
}

// === Chargement initial ===
// Géré par initSemaineSelector ci-dessus (premier appel synchrone à chargerSemaine
// avec le payload de la semaine sélectionnée — restaurée depuis sessionStorage
// ou "current" par défaut).
