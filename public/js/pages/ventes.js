// ============================================================
// Page : Ventes
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listenVentesSemaine, listVentesSemaine, listUsers, listProduits,
         getConfig, listQuotasVendeurSemaine, listServicesSemaine } from '../api.js';
import { money, num, datetime, escapeHtml, dateKeyLocal, weekId, durationHM } from '../utils/formatters.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { ouvrirModalModifierVente } from '../utils/vente-modal.js';
import { initSemaineSelector } from '../utils/semaine-selector.js';
import { isVendeur, isDirection, isSuperAdmin,
         PRODUITS_QUOTA_FAB, QUOTA_CA_VENDEUR_DEFAULT } from '../utils/permissions.js';
import { scoreQuotaFabrication, fabricationsFromQuotaDoc, salaireEstime } from '../utils/paie.js';
import { nomProduit } from '../data/produits.js';
import { auth } from '../firebase-config.js';
import { toastSuccess, toastError } from '../utils/toast.js';

const CAT_FN_BASE = 'https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net';
const CATEGORIES_FISCALES = [
  ['vente', 'Vente'], ['don-recu', 'Don reçu'], ['don-verse', 'Don versé'],
  ['subvention', 'Subvention'], ['autre-entree', 'Autre entrée']
];
function labelCategorieFiscale(cf) {
  const found = CATEGORIES_FISCALES.find(([v]) => v === cf);
  return found ? found[1] : 'Vente';
}

// Roles autorises a modifier une vente apres verrouillage
const PEUT_MODIFIER = ['patron', 'co-patron', 'admin-technique', 'drh', 'responsable-vente'];

const { profile } = await requireAuth('ventes');

// Pilotage vendeurs : visible direction + super-admin + responsable vente.
// Permet au resp. vente de suivre les quotas (CA + fabrication) de ses
// vendeurs SANS accès RH (qui lui reste bloqué).
const canPilotageVendeurs = isDirection(profile.role) || isSuperAdmin(profile.role)
  || profile.role === 'responsable-vente';

const html = `
  <div class="kpi-grid" id="kpis-ventes">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="page-toolbar">
    <select id="selecteur-semaine" title="Choisir la semaine"></select>
    <select id="filtre-vendeur" title="Filtrer par vendeur"><option value="">Tous les vendeurs</option></select>
    <select id="filtre-paiement" title="Filtrer par paiement">
      <option value="">Tous paiements</option>
      <option value="especes">Espèces</option>
      <option value="carte">Carte</option>
    </select>
    <input type="text" id="filtre-recherche" placeholder="Rechercher…" style="flex:1;min-width:160px;" />
    <button class="btn" id="btn-export" title="Exporter en CSV" data-tooltip="Exporter CSV">Exporter CSV</button>
  </div>

  <div class="panel framed">
    <div class="panel-title">
      <span id="panel-titre-ventes">Factures de la semaine</span>
      <span id="badge-semaine" class="muted" style="font-size:0.82rem;"></span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-ventes">
        <thead>
          <tr>
            <th data-sort="date">Date</th>
            <th data-sort="facture">#Facture</th>
            <th data-sort="vendeur">Vendeur</th>
            <th data-sort="client">Client</th>
            <th class="right" data-sort="montant">Montant</th>
            <th class="right" data-sort="benefice">Bénéfice</th>
            <th data-sort="paiement">Paiement</th>
            <th data-sort="raison">Raison</th>
            <th class="center" data-sort="verif">Vérif.</th>
            <th class="center">Source</th>
            <th class="center">Actions</th>
          </tr>
        </thead>
        <tbody id="tbody-ventes"><tr><td colspan="11" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  ${canPilotageVendeurs ? `
  <div class="panel framed">
    <div class="panel-title" style="flex-wrap:wrap;gap:8px;">
      <span>Pilotage vendeurs</span>
      <span class="muted" style="font-size:0.78rem;" id="pilotage-vendeurs-meta">—</span>
    </div>
    <div id="pilotage-vendeurs">Chargement…</div>
  </div>
  ` : ''}

  <div class="panel">
    <div class="panel-title"><span>Discordances vente ↔ stock</span></div>
    <div id="discordances">—</div>
  </div>
`;

renderShell(profile, 'ventes', html);

makeSortable(document.getElementById('table-ventes'));

const [users, produits] = await Promise.all([
  listUsers().catch(() => []),
  listProduits().catch(() => [])
]);

const usersById = users.reduce((m, u) => (m[u.id] = u, m), {});

// Pilotage vendeurs : config quotas (chargée une fois) + snapshot des quotas
// de fabrication de la semaine sélectionnée (rechargé au changement de semaine).
let configPilotage = {};       // config globale ACTUELLE (semaine en cours)
let quotaCfgPilotage = {};      // objectifs EFFECTIFS de la semaine affichée
let quotasVendeurPilotage = [];
let servicesPilotage = [];      // heures de service de la semaine affichée
if (canPilotageVendeurs) {
  configPilotage = await getConfig().catch(() => ({}));
  quotaCfgPilotage = configPilotage;
}

const selVendeur = document.getElementById('filtre-vendeur');
users.filter(u => ['vendeur-novice','vendeur-intermediaire','vendeur-experimente','chef-equipe','livreur'].includes(u.role))
  .forEach(u => {
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = `${u.prenom} ${u.nom}`;
    selVendeur.appendChild(o);
  });

let ventes = [];
let unsubVentes = null;
let currentDebut = null;
let currentFin = null;
let currentIsCurrent = true;
let currentStatutLabel = 'En cours';

// Charge ventes pour une semaine donnee.
// - Semaine en cours : listener temps reel (onSnapshot).
// - Semaine cloturee : fetch one-shot (figee, pas besoin de listener).
function chargerVentes(debut, fin, isCurrent) {
  if (unsubVentes) {
    try { unsubVentes(); } catch {}
    unsubVentes = null;
  }
  currentDebut = debut;
  currentFin = fin;
  currentIsCurrent = isCurrent;

  document.getElementById('tbody-ventes').innerHTML =
    '<tr><td colspan="11" class="muted text-center">Chargement…</td></tr>';

  if (isCurrent) {
    unsubVentes = listenVentesSemaine(debut, fin, list => {
      ventes = list;
      renderTable();
      renderKpis();
      renderPilotageVendeurs();
    });
  } else {
    listVentesSemaine(debut, fin).then(list => {
      ventes = list;
      renderTable();
      renderKpis();
      renderPilotageVendeurs();
    }).catch(err => {
      console.error('[ventes] fetch semaine cloturee', err);
      document.getElementById('tbody-ventes').innerHTML =
        '<tr><td colspan="11" class="muted text-center">Erreur de chargement.</td></tr>';
    });
  }
}

// Selecteur semaine : initialise + branche le rechargement
await initSemaineSelector('#selecteur-semaine', {
  storageKey: 'ventes-semaine-selectionnee',
  onChange: async ({ debut, fin, weekKey, isCurrent, statutLabel, semaine }) => {
    currentStatutLabel = isCurrent ? 'En cours' : statutLabel;
    // Met a jour le titre du panel + badge
    const fmt = d => d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
    document.getElementById('panel-titre-ventes').textContent =
      `Factures de la semaine du ${fmt(debut)} au ${fmt(fin)}`;
    const badge = document.getElementById('badge-semaine');
    if (isCurrent) {
      badge.textContent = '';
    } else {
      badge.innerHTML = `<span class="badge ok">${escapeHtml(statutLabel)}</span> · lecture seule`;
    }
    // Pilotage vendeurs : recharge les quotas de fabrication de la semaine ciblée
    // (le CA, lui, vient des ventes chargées par chargerVentes ci-dessous).
    if (canPilotageVendeurs) {
      const wId = isCurrent ? weekId() : weekKey;
      const [qv, svc] = await Promise.all([
        listQuotasVendeurSemaine(wId).catch(() => []),
        listServicesSemaine(debut, fin).catch(() => [])
      ]);
      quotasVendeurPilotage = qv;
      servicesPilotage = svc;
      // Objectifs de quota : semaine en cours = config actuelle ; semaine
      // clôturée = objectifs figés dans /semaines (fallback config actuelle
      // pour les semaines clôturées avant la mise en place du snapshot).
      quotaCfgPilotage = isCurrent ? configPilotage : (semaine?.quotaConfig || configPilotage);
    }
    chargerVentes(debut, fin, isCurrent);
  }
});

document.getElementById('filtre-vendeur').addEventListener('change', renderTable);
document.getElementById('filtre-paiement').addEventListener('change', renderTable);
document.getElementById('filtre-recherche').addEventListener('input', renderTable);

// === Pilotage vendeurs : récap CA + fabrication par vendeur ===
// 2 statuts séparés (CA / Fabrication). Suit la semaine sélectionnée.
// Lecture seule (aucune écriture) : c'est l'équivalent du pilotage pompistes
// pour le responsable vente, qui n'a pas accès à RH.
function renderPilotageVendeurs() {
  if (!canPilotageVendeurs) return;
  const div = document.getElementById('pilotage-vendeurs');
  if (!div) return;

  const quotaCA  = Number(quotaCfgPilotage.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  const quotaFab = quotaCfgPilotage.quotaFabrication || {};
  const fabActifs = PRODUITS_QUOTA_FAB.filter(id => Number(quotaFab[id] || 0) > 0);

  const vendeurs = users
    .filter(u => u.statut === 'actif' && isVendeur(u.role))
    .map(u => {
      const myV = ventes.filter(v => v.vendeurId === u.id);
      const caPart = myV.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0); // don hors CA vendeur
      const qDoc = quotasVendeurPilotage.find(q => q.employeId === u.id) || {};
      const heuresMs = servicesPilotage
        .filter(s => s.employeId === u.id)
        .reduce((acc, s) => acc + (s.duree || 0), 0);
      const fabrications = fabricationsFromQuotaDoc(qDoc);
      const salaireEst = salaireEstime(
        { role: u.role, caGenere: caPart, fabrications, salaireDecide: u.salaireDecide || 0 },
        quotaCfgPilotage
      );
      return { u, caPart, fabrications, heuresMs, salaireEst };
    });

  const totalCA = vendeurs.reduce((s, x) => s + x.caPart, 0);
  document.getElementById('pilotage-vendeurs-meta').textContent =
    `${vendeurs.length} vendeur${vendeurs.length > 1 ? 's' : ''} · ${money(totalCA)} CA particulier cumulé`;

  if (vendeurs.length === 0) {
    div.innerHTML = `<p class="muted">Aucun vendeur actif.</p>`;
    return;
  }

  const badge = (score) => {
    if (score >= 1)   return '<span class="badge ok">Atteint</span>';
    if (score >= 0.5) return '<span class="badge neutral">En cours</span>';
    return '<span class="badge warn">En retard</span>';
  };

  vendeurs.sort((a, b) => (b.caPart / (quotaCA || 1)) - (a.caPart / (quotaCA || 1)));

  div.innerHTML = `
    <div class="table-scroll" style="max-height:500px;">
      <table class="data" id="table-pilotage-vendeurs">
        <thead><tr>
          <th data-sort="nom">Vendeur</th>
          <th data-sort="role">Rôle</th>
          <th class="right" data-sort="heures">Heures</th>
          <th data-sort="ca">CA particulier</th>
          <th data-sort="statutca">Statut CA</th>
          <th>Fabrication</th>
          <th data-sort="statutfab">Statut Fab.</th>
          <th class="right" data-sort="salaire">Salaire estimé</th>
          <th class="center">Voir</th>
        </tr></thead>
        <tbody>
          ${vendeurs.map(({ u, caPart, fabrications, heuresMs, salaireEst }) => {
            const pctCA = quotaCA > 0 ? Math.min(100, (caPart / quotaCA) * 100) : 0;
            const scoreCA = quotaCA > 0 ? Math.min(1, caPart / quotaCA) : 1;
            const scoreFab = scoreQuotaFabrication(fabrications, quotaFab);
            const caCell = `<div class="mono" style="font-size:0.85rem;">${money(caPart)} / ${money(quotaCA)}</div>
              <div class="progress" style="height:8px;margin-top:2px;"><div class="fill" style="width:${pctCA}%;${caPart >= quotaCA ? 'background:var(--color-cactus,#5a8);' : (pctCA < 30 ? 'background:var(--color-blood);' : '')}"></div></div>`;
            const fabCell = fabActifs.length === 0
              ? '<span class="muted" style="font-size:0.78rem;">aucune fabrication cette semaine</span>'
              : fabActifs.map(id => {
                  const f = Number(fabrications[id] || 0);
                  const q = Number(quotaFab[id] || 0);
                  const pctF = q > 0 ? Math.min(100, (f / q) * 100) : 0;
                  return `<div style="margin-bottom:4px;">
                    <div class="mono" style="font-size:0.78rem;">${escapeHtml(nomProduit(id))} : ${num(f)} / ${num(q)}</div>
                    <div class="progress" style="height:6px;"><div class="fill" style="width:${pctF}%;${f >= q ? 'background:var(--color-cactus,#5a8);' : (pctF < 30 ? 'background:var(--color-blood);' : '')}"></div></div>
                  </div>`;
                }).join('');
            return `
              <tr>
                <td><strong>${escapeHtml(u.prenom || '')} ${escapeHtml(u.nom || '')}</strong></td>
                <td class="muted" style="font-size:0.78rem;">${escapeHtml(u.role || '')}</td>
                <td class="right mono" data-sort-value="${heuresMs}">${durationHM(heuresMs)}</td>
                <td data-sort-value="${caPart}">${caCell}</td>
                <td data-sort-value="${scoreCA}">${badge(scoreCA)}</td>
                <td>${fabCell}</td>
                <td data-sort-value="${scoreFab}">${fabActifs.length === 0 ? '<span class="muted">—</span>' : badge(scoreFab)}</td>
                <td class="right mono" data-sort-value="${salaireEst}">${money(salaireEst)}</td>
                <td class="center"><a class="btn btn-sm" href="employee.html?asUser=${escapeHtml(u.id)}" title="Voir l'espace de ce vendeur">Voir</a></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  makeSortable(document.getElementById('table-pilotage-vendeurs'));
}

function renderTable() {
  const v = document.getElementById('filtre-vendeur').value;
  const p = document.getElementById('filtre-paiement').value;
  const r = document.getElementById('filtre-recherche').value.toLowerCase().trim();

  let rows = ventes;
  if (v) rows = rows.filter(x => x.vendeurId === v);
  if (p) rows = rows.filter(x => (x.paiement || '').toLowerCase() === p);
  if (r) rows = rows.filter(x =>
    (x.client || '').toLowerCase().includes(r) ||
    (x.raison || '').toLowerCase().includes(r)
  );

  const tbody = document.getElementById('tbody-ventes');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="muted text-center">Aucune vente sur cette semaine.</td></tr>`;
    return;
  }
  // Modification autorisee uniquement sur la semaine en cours (semaines
  // cloturees = figees, lecture seule absolue).
  const peutModifier = PEUT_MODIFIER.includes(profile.role) && currentIsCurrent;
  tbody.innerHTML = rows.map(v => {
    const vendeur = usersById[v.vendeurId];
    const verif = v.stockVerifie === false
      ? '<span class="badge danger" title="Vente sans sortie de stock corrélée">Discordance</span>'
      : (v.stockVerifie === true ? '<span class="badge ok" title="Stock vérifié">OK</span>' : '<span class="muted">—</span>');
    const sourceTag = v.source === 'manuelle'
      ? '<span class="badge neutral" title="Vente déclarée sur le site">Site</span>'
      : '<span class="badge neutral" title="Importée depuis #suivi-facture / #factures">Bot</span>';
    const modifIcon = v.modifieParNom
      ? `<span class="muted" title="Modifiée par ${escapeHtml(v.modifieParNom)} — ${escapeHtml(v.motifModification || '')}" style="margin-left:4px;font-size:0.72rem;">[modifiée]</span>`
      : '';
    let btnModif = '';
    if (PEUT_MODIFIER.includes(profile.role)) {
      btnModif = peutModifier
        ? `<button class="btn btn-sm btn-modif-vente" data-id="${escapeHtml(v.id)}" title="Modifier la vente" data-tooltip="Modifier">Modifier</button>`
        : `<button class="btn btn-sm" disabled title="Semaine clôturée — non modifiable" data-tooltip="Semaine clôturée">Clôturée</button>`;
    }
    // Classification fiscale (déclaration IRS). Hors 'vente' = exclu du CA.
    const cf = v.categorieFiscale || 'vente';
    let selCategorie = '';
    if (peutModifier) {
      const opts = CATEGORIES_FISCALES
        .map(([val, lab]) => `<option value="${val}"${cf === val ? ' selected' : ''}>${lab}</option>`).join('');
      selCategorie = `<select class="sel-cat-vente" data-id="${escapeHtml(v.id)}" title="Catégorie fiscale — hors « Vente » = sorti du CA et transmis au cabinet" style="font-size:0.74rem;margin-top:4px;width:100%;">${opts}</select>`;
    }
    const catBadge = cf !== 'vente'
      ? ` <span class="badge" style="background:rgba(120,170,90,0.22);color:#9c6;font-size:0.64rem;" title="Hors CA — déclaré en ${labelCategorieFiscale(cf)}">${labelCategorieFiscale(cf)}</span>`
      : '';
    return `
      <tr>
        <td class="mono">${datetime(v.timestamp)}</td>
        <td class="mono">#${escapeHtml(v.factureId || v.id)}</td>
        <td>${vendeur ? escapeHtml(vendeur.prenom + ' ' + vendeur.nom) : escapeHtml(v.vendeurNom || '—')}</td>
        <td>${escapeHtml(v.client || '—')}</td>
        <td class="right mono">${money(v.montant)}${catBadge}</td>
        <td class="right mono ${(v.benefice||0) >= 0 ? '' : 'muted'}">${money(v.benefice || 0)}</td>
        <td><span class="badge neutral">${escapeHtml(v.paiement || '—')}</span></td>
        <td class="muted">${escapeHtml(v.raison || '')}</td>
        <td class="center">${verif}</td>
        <td class="center">${sourceTag}${modifIcon}</td>
        <td class="actions-cell">${btnModif}${selCategorie}</td>
      </tr>
    `;
  }).join('');

  // Bind boutons modifier (uniquement si semaine en cours)
  if (peutModifier) {
    tbody.querySelectorAll('.btn-modif-vente').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const vente = ventes.find(x => x.id === id);
        if (!vente) return;
        ouvrirModalModifierVente(vente, {
          onSuccess: () => {
            // listenVentesSemaine va re-rendre tout seul
          }
        });
      });
    });

    // Bind sélecteurs de catégorie fiscale (don reçu/versé, subvention, autre entrée)
    tbody.querySelectorAll('.sel-cat-vente').forEach(sel => {
      const avant = sel.value;
      sel.addEventListener('change', async () => {
        const id = sel.dataset.id;
        const categorieFiscale = sel.value;
        sel.disabled = true;
        try {
          const idToken = await auth.currentUser.getIdToken();
          const resp = await fetch(`${CAT_FN_BASE}/categoriserVente`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
            body: JSON.stringify({ venteId: id, categorieFiscale })
          });
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
          toastSuccess(categorieFiscale === 'vente'
            ? 'Reclassé en vente (compté dans le CA).'
            : `Classé en « ${labelCategorieFiscale(categorieFiscale)} » — sorti du CA, transmis au cabinet pour le JSON IRS.`);
          // listenVentesSemaine re-render tout seul (badge + CA mis à jour)
        } catch (e) {
          sel.value = avant;
          toastError('Échec classification : ' + (e?.message || 'erreur inattendue.'));
        } finally {
          sel.disabled = false;
        }
      });
    });
  }
}

function renderKpis() {
  // CA = ventes uniquement ; les entrées classées (dons/subventions/autres) sont hors CA.
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente';
  const ca = ventes.reduce((s, v) => s + (estVenteCA(v) ? (v.montant || 0) : 0), 0);
  const benefice = ventes.reduce((s, v) => s + (estVenteCA(v) ? (v.benefice || 0) : 0), 0);

  // Comptage generique de toutes les valeurs de `paiement` rencontrees
  // (especes, carte, autre, virement, ...). Avant : seules "especes" et "carte"
  // etaient comptees -> ventes "autre" invisibles dans le KPI mais presentes
  // dans le CA total = ecart inexpliquable. On affiche maintenant especes/carte
  // dans la valeur principale + "+N autre(s)" en delta si applicable.
  const counts = {};
  for (const v of ventes) {
    const p = (v.paiement || 'especes').toLowerCase().trim();
    counts[p] = (counts[p] || 0) + 1;
  }
  const especes = counts['especes'] || 0;
  const carte   = counts['carte']   || 0;
  const autres  = Object.keys(counts)
    .filter(k => k !== 'especes' && k !== 'carte')
    .reduce((s, k) => s + counts[k], 0);
  const deltaPaiements = autres > 0
    ? `espèces / carte (+${autres} autre${autres > 1 ? 's' : ''})`
    : 'espèces / carte';

  const moyenne = ventes.length ? ca / ventes.length : 0;
  const periodeLabel = currentIsCurrent ? 'CA semaine' : 'CA semaine clôturée';

  document.getElementById('kpis-ventes').innerHTML = `
    <div class="kpi"><div class="label">${periodeLabel}</div><div class="value">${money(ca)}</div><div class="delta">${ventes.length} factures</div></div>
    <div class="kpi"><div class="label">Bénéfice brut</div><div class="value">${money(benefice)}</div><div class="delta">marge produits</div></div>
    <div class="kpi"><div class="label">Panier moyen</div><div class="value">${money(moyenne)}</div><div class="delta">par facture</div></div>
    <div class="kpi"><div class="label">Paiements</div><div class="value mono">${especes}/${carte}</div><div class="delta">${deltaPaiements}</div></div>
  `;

  // Discordances
  const disc = ventes.filter(v => v.stockVerifie === false);
  const div = document.getElementById('discordances');
  if (disc.length === 0) {
    div.innerHTML = `<p class="muted">Aucune discordance détectée.</p>`;
  } else {
    div.innerHTML = `
      <div class="alert warn">
        <div>${disc.length} vente${disc.length > 1 ? 's' : ''} sans sortie de stock correspondante détectée.</div>
      </div>
      <table class="data mt-2">
        <thead><tr><th>Date</th><th>Facture</th><th>Vendeur</th><th class="right">Montant</th><th>Détails</th></tr></thead>
        <tbody>
          ${disc.map(v => `
            <tr>
              <td>${datetime(v.timestamp)}</td>
              <td>#${escapeHtml(v.factureId || v.id)}</td>
              <td>${escapeHtml(usersById[v.vendeurId]?.prenom + ' ' + usersById[v.vendeurId]?.nom || v.vendeurNom || '—')}</td>
              <td class="right mono">${money(v.montant)}</td>
              <td class="muted">${escapeHtml(v.raison || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

// === Export CSV ===
document.getElementById('btn-export').addEventListener('click', () => {
  const v = document.getElementById('filtre-vendeur').value;
  const p = document.getElementById('filtre-paiement').value;
  let rows = ventes;
  if (v) rows = rows.filter(x => x.vendeurId === v);
  if (p) rows = rows.filter(x => (x.paiement || '').toLowerCase() === p);

  const lines = [
    'Date;Facture;Vendeur;Client;Montant;Benefice;Paiement;Raison'
  ];
  rows.forEach(x => {
    const vendeur = usersById[x.vendeurId];
    lines.push([
      datetime(x.timestamp),
      x.factureId || x.id,
      vendeur ? `${vendeur.prenom} ${vendeur.nom}` : (x.vendeurNom || ''),
      x.client || '',
      x.montant || 0,
      x.benefice || 0,
      x.paiement || '',
      (x.raison || '').replace(/[;\n\r]/g, ' ')
    ].join(';'));
  });
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const wkLabel = currentDebut ? dateKeyLocal(currentDebut) : 'semaine';
  a.download = `ventes-semaine-${wkLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
