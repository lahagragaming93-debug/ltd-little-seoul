// ============================================================
// Page : Stocks épicerie
// ============================================================

import { requireAuth, getCurrentUser } from '../auth.js';
import { renderShell } from '../layout.js';
import {
  listProduits, setProduit, deleteProduit, listenStocks, ajusterStock, listMouvementsRecents,
  listUsers
} from '../api.js';
import { CATEGORIES, CATEGORY_LABELS } from '../data/produits.js';
import { money, moneyPrecis, num, datetime, escapeHtml } from '../utils/formatters.js';
import { canAccess, canCreateProduit } from '../utils/permissions.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { confirmCritique } from '../utils/confirmation.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';

const { profile } = await requireAuth('stocks_epicerie');
// Droit de MODIFICATION du stock. Rôles éditeurs par défaut (direction, DRH, resp.
// vente, resp. pompiste, super-admin) OU permission individuelle 'stocks_edit'
// accordée via Admin > Modifier le compte (ex. un chef d'équipe précis).
// Historique : 05-11 Direction+Admin ; 05-13 DRH ; 05-22 Resp Pompiste ;
// 05-25 Resp Vente ; 07-02 permission par employé 'stocks_edit'.
const editable = canAccess(profile.role, 'stocks_edit', profile.accesSupp);
const canCreate = canCreateProduit(profile.role);

const html = `
  <!-- Onglets de section -->
  <div class="row mb-2" id="onglets-stocks" style="gap:6px;flex-wrap:wrap;">
    <button class="btn btn-tab active" data-section="vente_epicerie" title="Stock vendable aux particuliers (commission vendeur)">Vente épicerie <span class="badge neutral" data-count="vente_epicerie">0</span></button>
    <button class="btn btn-tab" data-section="vente_pro" title="Stock vendable aux partenaires pros (CA LTD)">Vente partenaire <span class="badge neutral" data-count="vente_pro">0</span></button>
    <button class="btn btn-tab" data-section="achat_fournisseur" title="Matières premières achetées (non revendues)">Achat fournisseur <span class="badge neutral" data-count="achat_fournisseur">0</span></button>
    <button class="btn btn-tab" data-section="fabrication" title="Quincaillerie — produits craftés par les vendeurs">Quincaillerie <span class="badge neutral" data-count="fabrication">0</span></button>
    <button class="btn btn-tab" data-section="mouvements" title="Historique des derniers mouvements (entrée/sortie/ajustement)">Mouvements</button>
  </div>

  <div class="page-toolbar">
    <select id="filtre-categorie" title="Filtrer par catégorie">
      <option value="">Toutes catégories</option>
      ${Object.entries(CATEGORY_LABELS).map(([k, l]) =>
        `<option value="${k}">${l}</option>`).join('')}
    </select>
    <select id="filtre-alerte" title="Filtrer par niveau">
      <option value="">Tous niveaux</option>
      <option value="rupture">Ruptures</option>
      <option value="bas">Sous seuil</option>
      <option value="ok">OK</option>
    </select>
    <input type="text" id="filtre-recherche" placeholder="Rechercher…" style="flex:1;min-width:160px;" />
    ${canCreate ? `
      <button class="btn btn-primary" id="btn-nouveau-produit" title="Ajouter un produit au catalogue" data-tooltip="Ajouter produit">+ Ajouter</button>
    ` : ''}
  </div>

  <!-- Panel unique : affiche la section active -->
  <div class="panel framed" id="panel-section-actif">
    <div class="panel-title">
      <span id="section-titre">Vente épicerie — particuliers</span>
      <span class="muted mono" id="stats-stock">—</span>
    </div>
    <div class="table-scroll">
      <table class="data sortable" id="table-stocks">
        <thead id="thead-stocks"></thead>
        <tbody id="tbody-stocks"><tr><td colspan="9" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Panel mouvements (affiche uniquement quand section = mouvements) -->
  <div class="panel framed hidden" id="panel-mouvements">
    <div class="panel-title"><span>Derniers mouvements de stock</span></div>
    <div id="mouvements">Chargement…</div>
  </div>

  <!-- Modale création produit -->
  <div id="modal-nouveau" class="modal-backdrop hidden">
    <div class="modal" style="max-width:560px;">
      <h3>+ Ajouter un produit au catalogue</h3>
      <div class="alert info mb-2" style="font-size:0.82rem;">
        <span>L'<strong>identifiant</strong> du produit est généré automatiquement à partir du nom (slug). Il sert de clé technique : il ne sera plus modifiable après création. Le nom, lui, reste éditable.</span>
      </div>
      <label>Nom du produit *</label>
      <input type="text" id="new-produit-nom" placeholder="Ex. Bouteille d'eau" />
      <label>Identifiant technique (auto) <span class="muted" style="font-size:0.75rem;">— modifiable</span></label>
      <input type="text" id="new-produit-id" placeholder="bouteille-eau" style="font-family:var(--font-mono);font-size:0.85rem;" />
      <label>Catégorie</label>
      <select id="new-produit-categorie">
        ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
      </select>
      <div class="field-row">
        <div><label>Prix achat ($)</label><input type="number" id="new-produit-prix-achat" min="0" step="0.01" value="0" /></div>
        <div><label>Prix vente ($)</label><input type="number" id="new-produit-prix-vente" min="0" step="0.01" value="0" /></div>
        <div><label>Seuil alerte</label><input type="number" id="new-produit-seuil" min="0" step="1" value="5" /></div>
      </div>
      <label>Stock initial <span class="muted" style="font-size:0.75rem;">— optionnel</span></label>
      <input type="number" id="new-produit-stock" min="0" step="1" value="0" />
      <label>Section de stock</label>
      <select id="new-produit-section">
        <option value="vente_epicerie">Vente épicerie — particuliers (commission vendeur)</option>
        <option value="vente_pro">Vente partenaire — pros (CA LTD, pas de commission)</option>
        <option value="achat_fournisseur">Achat fournisseur — matière première (non vendue)</option>
        <option value="fabrication">Quincaillerie (produit crafté par les vendeurs)</option>
      </select>
      <label>Fournisseur <span class="muted" style="font-size:0.75rem;">— optionnel (ex. "Yootool", "GB Foundry")</span></label>
      <input type="text" id="new-produit-fournisseur" placeholder="Vide si pas applicable" maxlength="60" />
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-creer-produit">Créer le produit</button>
        <button class="btn btn-ghost" id="btn-cancel-nouveau">Annuler</button>
      </div>
    </div>
  </div>

  <!-- Modale édition produit -->
  <div id="modal-edit" class="modal-backdrop hidden">
    <div class="modal">
      <h3>Modifier le produit</h3>
      <input type="hidden" id="edit-id" />
      <label>Nom</label><input type="text" id="edit-nom" />
      <div class="field-row">
        <div><label>Prix achat ($)</label><input type="number" id="edit-prix-achat" min="0" step="0.01" /></div>
        <div><label>Prix vente ($)</label><input type="number" id="edit-prix-vente" min="0" step="0.01" /></div>
        <div><label>Seuil alerte</label><input type="number" id="edit-seuil" min="0" step="1" /></div>
      </div>
      <label>Section de stock</label>
      <select id="edit-section">
        <option value="vente_epicerie">Vente épicerie — particuliers (commission vendeur)</option>
        <option value="vente_pro">Vente partenaire — pros (CA LTD, pas de commission)</option>
        <option value="achat_fournisseur">Achat fournisseur — matière première (non vendue)</option>
        <option value="fabrication">Quincaillerie (produit crafté par les vendeurs)</option>
      </select>
      <label>Fournisseur <span class="muted" style="font-size:0.75rem;">— apparaît aussi dans l'onglet Achat fournisseur</span></label>
      <input type="text" id="edit-fournisseur" placeholder="ex. Yootool, GB Foundry" maxlength="60" />
      <label>Ajustement manuel du stock</label>
      <div class="field-row">
        <div><input type="number" id="edit-delta" placeholder="+/− unités" /></div>
        <div><input type="text" id="edit-raison" placeholder="Justification (obligatoire si ajustement)" /></div>
      </div>
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save">Enregistrer</button>
        <button class="btn btn-ghost" id="btn-cancel">Annuler</button>
      </div>
    </div>
  </div>
`;

renderShell(profile, 'stocks_epicerie', html);

let produits = [];
let stocks = {};
let sortState = { key: 'nom', dir: 'asc' };
let sectionActive = 'vente_epicerie';

const SECTION_LABELS = {
  vente_epicerie:    { titre: 'Vente épicerie — particuliers',           sub: '(commission vendeur)' },
  vente_pro:         { titre: 'Vente partenaire — professionnels',       sub: '(CA LTD, pas de commission)' },
  achat_fournisseur: { titre: 'Achat fournisseur — matières premières',  sub: '(achetées, non revendues)' },
  fabrication:       { titre: 'Quincaillerie',                          sub: '(produits craftés par les vendeurs)' }
};

// Determine la section d'appartenance d'un produit (1 seule)
function sectionProduit(p) {
  if (p.enFabrication) return 'fabrication';
  if (p.intrant)       return 'achat_fournisseur';
  if (p.pourPro)       return 'vente_pro';
  return 'vente_epicerie';
}

// Definition des colonnes affichables (header + getter de cellule)
// Note : data-sort sur le <th> pour le tri, classes alignement gerees ici.
const COLONNES_DEFS = {
  nom:       { th: 'Produit',        cls: '',        sort: 'nom' },
  categorie: { th: 'Catégorie',      cls: '',        sort: 'categorie' },
  qte:       { th: 'Stock',          cls: 'right',   sort: 'qte' },
  prixAchat: { th: 'Prix achat',     cls: 'right',   sort: 'prixAchat' },
  prixVente: { th: 'Prix vente',     cls: 'right',   sort: 'prixVente' },
  marge:     { th: 'Marge',          cls: 'right',   sort: 'marge' },
  seuil:     { th: 'Seuil alerte',   cls: 'right',   sort: 'seuil' },
  statut:    { th: 'Statut',         cls: 'center',  sort: 'statut' }
};

// Colonnes affichees selon l'onglet actif :
//   achat_fournisseur : pas de prix vente (jamais revendus)
//   fabrication       : pas de prix achat (crafté par le LTD, marge = 100%)
//   autres            : tout
function colonnesPourSection(section) {
  const base = ['nom', 'categorie', 'qte'];
  const fin  = ['seuil', 'statut'];
  if (section === 'achat_fournisseur') return [...base, 'prixAchat', ...fin];
  if (section === 'fabrication')       return [...base, 'prixVente', ...fin];
  return [...base, 'prixAchat', 'prixVente', 'marge', ...fin];
}

const STATUT_ORDER = { rupture: 0, bas: 1, ok: 2 };

function sortRows(rows) {
  const { key, dir } = sortState;
  const sign = dir === 'asc' ? 1 : -1;
  const cmpStr = (a, b) => String(a || '').localeCompare(String(b || ''), 'fr', { sensitivity: 'base' });
  const cmpNum = (a, b) => (a || 0) - (b || 0);

  return [...rows].sort((r1, r2) => {
    let res;
    switch (key) {
      case 'nom':       res = cmpStr(r1.p.nom, r2.p.nom); break;
      case 'categorie': res = cmpStr(CATEGORY_LABELS[r1.p.categorie] || r1.p.categorie, CATEGORY_LABELS[r2.p.categorie] || r2.p.categorie); break;
      case 'qte':       res = cmpNum(r1.qte, r2.qte); break;
      case 'prixAchat': res = cmpNum(r1.p.prixAchat, r2.p.prixAchat); break;
      case 'prixVente': res = cmpNum(r1.p.prixVente, r2.p.prixVente); break;
      case 'marge':     res = cmpNum((r1.p.prixVente || 0) - (r1.p.prixAchat || 0), (r2.p.prixVente || 0) - (r2.p.prixAchat || 0)); break;
      case 'seuil':     res = cmpNum(r1.seuil, r2.seuil); break;
      case 'statut':    res = STATUT_ORDER[r1.statut] - STATUT_ORDER[r2.statut]; break;
      default:          res = 0;
    }
    if (res === 0) res = cmpStr(r1.p.nom, r2.p.nom); // tie-breaker stable par nom
    return res * sign;
  });
}

function updateSortArrows() {
  document.querySelectorAll('#table-stocks thead th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.dataset.sort === sortState.key) {
      arrow.textContent = sortState.dir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sorted');
    } else {
      arrow.textContent = '';
      th.classList.remove('sorted');
    }
  });
}

async function chargerProduits() {
  produits = await listProduits().catch(() => []);
  if (produits.length === 0 && editable) {
    document.getElementById('tbody-stocks').innerHTML = `
      <tr><td colspan="9" class="muted text-center">
        Catalogue vide. Utilise "+ Ajouter un produit" pour commencer.
      </td></tr>`;
  }
}
await chargerProduits();

listenStocks(s => { stocks = s; renderTable(); });

function ligneProduit({ p, qte, seuil, statut, section }, colonnes) {
  const marge = (p.prixVente || 0) - (p.prixAchat || 0);
  const cls = qte < 0 ? 'alert-out' : (statut === 'rupture' ? 'alert-out' : (statut === 'bas' ? 'alert-low' : ''));
  const badgeStatut = qte < 0
    ? `<span class="badge danger" title="Stock négatif — incohérence">NÉG ${num(qte)}</span>`
    : (statut === 'rupture'
        ? '<span class="badge danger">RUPTURE</span>'
        : (statut === 'bas' ? '<span class="badge warn">BAS</span>' : '<span class="badge ok">OK</span>'));
  // Badge fournisseur (si defini)
  const fournisseurBadge = p.fournisseur && String(p.fournisseur).trim()
    ? ` <span class="badge neutral" title="Acheté chez ${escapeHtml(p.fournisseur)}" style="font-size:0.65rem;">${escapeHtml(p.fournisseur)}</span>`
    : '';
  // Sur l'onglet achat_fournisseur, on ajoute la section principale
  // (utile car un produit avec fournisseur peut "vivre" dans vente_epicerie/pro/fabrication)
  const sectionBadge = (sectionActive === 'achat_fournisseur' && section !== 'achat_fournisseur')
    ? ` <span class="badge ok" style="font-size:0.65rem;" title="Section principale">${SECTION_LABELS[section]?.titre.split(' — ')[0] || section}</span>`
    : '';

  const cellules = {
    nom:       `<td>${escapeHtml(p.nom)}${fournisseurBadge}${sectionBadge}</td>`,
    categorie: `<td><span class="muted">${CATEGORY_LABELS[p.categorie] || p.categorie}</span></td>`,
    qte:       `<td class="right mono ${qte < 0 ? 'alerte-fort' : ''}">${num(qte)}</td>`,
    prixAchat: `<td class="right mono">${moneyPrecis(p.prixAchat || 0)}</td>`,
    prixVente: `<td class="right mono">${moneyPrecis(p.prixVente || 0)}</td>`,
    marge:     `<td class="right mono ${marge >= 0 ? '' : 'muted'}">${moneyPrecis(marge)}</td>`,
    seuil:     `<td class="right mono">${num(seuil)}</td>`,
    statut:    `<td class="center">${badgeStatut}</td>`
  };

  return `
    <tr class="${cls}">
      ${colonnes.map(k => cellules[k]).join('')}
      ${editable ? `<td class="actions-cell">
        <button class="btn btn-sm btn-ghost" data-edit="${p.id}" title="Modifier le produit (prix, seuil, stock)" data-tooltip="Modifier">Modifier</button>
        ${canCreate ? `<button class="btn btn-sm btn-danger" data-delete-produit="${p.id}" title="Supprimer du catalogue" data-tooltip="Supprimer">Suppr.</button>` : ''}
      </td>` : ''}
    </tr>
  `;
}

function wireActions(tbody) {
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => ouvrirEdition(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-delete-produit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteProduit;
      const p = produits.find(x => x.id === id);
      const stock = stocks[id]?.quantite || 0;
      const ok = await confirmCritique({
        titre: 'Supprimer un produit du catalogue',
        message: `Le produit <strong>${escapeHtml(p?.nom || id)}</strong> sera supprimé du catalogue.<br><br>
          • Stock actuel : <strong>${stock}</strong> unités (le stock est conservé en base mais ne sera plus visible)<br>
          • Les ventes passées avec ce produit restent dans l'historique<br>
          • L'historique des prix (audit) reste consultable<br><br>
          Si ce produit a encore des stocks ou apparaît dans les logs FiveM, il sera <strong>recréé automatiquement</strong> par le bot.`,
        btnConfirm: 'Supprimer le produit',
        delaiSec: 3,
        requireType: 'SUPPRIMER'
      });
      if (!ok) return;
      try {
        await deleteProduit(id);
        toastSuccess(`Produit "${p?.nom || id}" supprimé.`);
        await chargerProduits();
        renderTable();
      } catch (e) {
        console.error(e);
        toastError(e?.message || e?.code || "Erreur à la suppression.");
      }
    });
  });
}

function renderTable() {
  const panelStocks = document.getElementById('panel-section-actif');
  const panelMvts   = document.getElementById('panel-mouvements');
  const toolbar     = document.querySelector('.page-toolbar');

  // === Section "Mouvements" : cache le panel stocks, affiche le panel mouvements ===
  if (sectionActive === 'mouvements') {
    panelStocks.classList.add('hidden');
    panelMvts.classList.remove('hidden');
    if (toolbar) toolbar.classList.add('hidden');
    return;
  }
  panelStocks.classList.remove('hidden');
  panelMvts.classList.add('hidden');
  if (toolbar) toolbar.classList.remove('hidden');

  // === Sections stock : filtre + render table ===
  const cat = document.getElementById('filtre-categorie').value;
  const niveau = document.getElementById('filtre-alerte').value;
  const recherche = document.getElementById('filtre-recherche').value.toLowerCase().trim();

  let allRows = produits.map(p => {
    const stock = stocks[p.id] || { quantite: 0 };
    const qte = stock.quantite || 0;
    const seuil = p.seuilAlerte ?? 0;
    let statut = 'ok';
    if (qte === 0) statut = 'rupture';
    else if (qte <= seuil) statut = 'bas';
    return { p, qte, seuil, statut, section: sectionProduit(p) };
  });

  // Compteurs par section pour les badges des onglets
  // Note : achat_fournisseur inclut les intrants ET les produits avec un
  // fournisseur defini (peuvent etre AUSSI dans vente_epicerie/vente_pro).
  const counts = { vente_epicerie: 0, vente_pro: 0, achat_fournisseur: 0, fabrication: 0 };
  for (const r of allRows) counts[r.section] = (counts[r.section] || 0) + 1;
  // Pour achat_fournisseur, on rajoute les produits avec fournisseur defini
  // mais qui appartiennent a une autre section principale.
  counts.achat_fournisseur += allRows.filter(r =>
    r.section !== 'achat_fournisseur' && r.p.fournisseur && String(r.p.fournisseur).trim()
  ).length;
  for (const [s, c] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${s}"]`);
    if (el) el.textContent = c;
  }

  // Filtre par section active : achat_fournisseur affiche intrants + tout
  // produit avec fournisseur defini (meme s'il vit dans une autre section)
  let rows;
  if (sectionActive === 'achat_fournisseur') {
    rows = allRows.filter(r =>
      r.section === 'achat_fournisseur' ||
      (r.p.fournisseur && String(r.p.fournisseur).trim())
    );
  } else {
    rows = allRows.filter(r => r.section === sectionActive);
  }

  // Filtres globaux
  if (cat) rows = rows.filter(r => r.p.categorie === cat);
  if (niveau) rows = rows.filter(r => r.statut === niveau);
  if (recherche) rows = rows.filter(r => r.p.nom.toLowerCase().includes(recherche));

  rows = sortRows(rows);

  // Titre + stats
  const lbl = SECTION_LABELS[sectionActive];
  document.getElementById('section-titre').innerHTML = `${lbl.titre} <span class="muted" style="font-size:0.78rem;">${lbl.sub}</span>`;
  const out = rows.filter(r => r.statut === 'rupture').length;
  const low = rows.filter(r => r.statut === 'bas').length;
  const neg = rows.filter(r => r.qte < 0).length;
  const parts = [`${rows.length} réf.`];
  if (neg > 0) parts.push(`<span class="alerte-fort">${neg} négatif${neg>1?'s':''}</span>`);
  if (out > 0) parts.push(`${out} rupture${out>1?'s':''}`);
  if (low > 0) parts.push(`${low} bas`);
  document.getElementById('stats-stock').innerHTML = parts.join(' · ');

  // === Reconstruit le <thead> selon les colonnes de la section ===
  const colonnes = colonnesPourSection(sectionActive);
  const thead = document.getElementById('thead-stocks');
  thead.innerHTML = `
    <tr>
      ${colonnes.map(k => {
        const c = COLONNES_DEFS[k];
        return `<th class="${c.cls}" data-sort="${c.sort}">${c.th} <span class="sort-arrow"></span></th>`;
      }).join('')}
      ${editable ? '<th class="center">Actions</th>' : ''}
    </tr>
  `;
  // Rewire le tri (le thead a ete reconstruit)
  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      else sortState = { key, dir: 'asc' };
      renderTable();
    });
  });
  updateSortArrows();

  const tbody = document.getElementById('tbody-stocks');
  const colspan = colonnes.length + (editable ? 1 : 0);
  tbody.innerHTML = rows.length === 0
    ? `<tr><td colspan="${colspan}" class="muted text-center">Aucun produit dans cette section.</td></tr>`
    : rows.map(r => ligneProduit(r, colonnes)).join('');

  wireActions(tbody);
}

// Onglets de section
document.querySelectorAll('#onglets-stocks .btn-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#onglets-stocks .btn-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sectionActive = btn.dataset.section;
    renderTable();
    if (sectionActive === 'mouvements') chargerMouvements();
  });
});

document.getElementById('filtre-categorie').addEventListener('change', renderTable);
document.getElementById('filtre-alerte').addEventListener('change', renderTable);
document.getElementById('filtre-recherche').addEventListener('input', renderTable);

// Note : le tri par colonne est attache dynamiquement dans renderTable
// (le <thead> est reconstruit a chaque rendu pour gerer les colonnes variables
// selon l'onglet actif).

// === Édition produit ===
function ouvrirEdition(id) {
  const p = produits.find(x => x.id === id);
  if (!p) return;
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-nom').value = p.nom || '';
  document.getElementById('edit-prix-achat').value = p.prixAchat || 0;
  document.getElementById('edit-prix-vente').value = p.prixVente || 0;
  document.getElementById('edit-seuil').value = p.seuilAlerte || 0;
  document.getElementById('edit-section').value = sectionProduit(p);
  document.getElementById('edit-fournisseur').value = p.fournisseur || '';
  document.getElementById('edit-delta').value = '';

  // Auto-calc Vente partenaire : prix vente = 2.1 × prix achat (live).
  // L'utilisateur peut surcharger en editant le champ prix vente apres.
  // Reset des handlers a chaque ouverture pour ne pas en empiler.
  const inAchat   = document.getElementById('edit-prix-achat');
  const inVente   = document.getElementById('edit-prix-vente');
  const inSection = document.getElementById('edit-section');
  function autoCalcVentePartenaire() {
    if (inSection.value !== 'vente_pro') return;
    const a = Number(inAchat.value) || 0;
    inVente.value = (a * 2.1).toFixed(2);
  }
  inAchat.oninput = autoCalcVentePartenaire;
  inSection.onchange = autoCalcVentePartenaire;
  document.getElementById('edit-raison').value = '';
  document.getElementById('modal-edit').classList.remove('hidden');
}

document.getElementById('btn-cancel').addEventListener('click', () => {
  document.getElementById('modal-edit').classList.add('hidden');
});

document.getElementById('btn-save').addEventListener('click', async () => {
  const id = document.getElementById('edit-id').value;
  const p = produits.find(x => x.id === id);
  if (!p) return;
  const section = document.getElementById('edit-section').value;
  const patch = {
    nom: document.getElementById('edit-nom').value.trim(),
    prixAchat: Number(document.getElementById('edit-prix-achat').value) || 0,
    prixVente: Number(document.getElementById('edit-prix-vente').value) || 0,
    seuilAlerte: Number(document.getElementById('edit-seuil').value) || 0,
    // Section -> 3 flags pourPro / intrant / enFabrication (1 seul actif)
    pourPro:       section === 'vente_pro',
    intrant:       section === 'achat_fournisseur',
    enFabrication: section === 'fabrication',
    fournisseur:   document.getElementById('edit-fournisseur').value.trim(),
    categorie: p.categorie
  };
  const delta = Number(document.getElementById('edit-delta').value);
  const raison = document.getElementById('edit-raison').value.trim();

  try {
    await setProduit(id, patch);
    if (delta && Number.isFinite(delta) && delta !== 0) {
      if (!raison) return toastError("Justification obligatoire pour ajustement.");
      await ajusterStock(id, delta, raison, getCurrentUser().uid);
    }
    toastSuccess("Produit enregistré.");
    document.getElementById('modal-edit').classList.add('hidden');
    await chargerProduits();
    renderTable();
    chargerMouvements();
  } catch (err) {
    toastError(err.message || "Erreur d'enregistrement.");
    console.error(err);
  }
});

// === Derniers mouvements ===
async function chargerMouvements() {
  const [mvts, users] = await Promise.all([
    listMouvementsRecents(20).catch(() => []),
    listUsers().catch(() => [])
  ]);
  // Index pour matching rapide : par idDiscord, idPerso, et par nom RP complet
  const byDiscord = {};
  const byPerso   = {};
  const byNom     = {};
  for (const u of users) {
    if (u.idDiscord) byDiscord[u.idDiscord] = u;
    if (u.idPerso)   byPerso[u.idPerso] = u;
    const nomComplet = `${u.prenom || ''} ${u.nom || ''}`.trim().toLowerCase();
    if (nomComplet) byNom[nomComplet] = u;
  }
  function resolveUser(m) {
    if (m.discord && byDiscord[m.discord]) return byDiscord[m.discord];
    if (m.characterId && byPerso[m.characterId]) return byPerso[m.characterId];
    const raw = (m.par || '').trim().toLowerCase();
    return byNom[raw] || null;
  }

  const div = document.getElementById('mouvements');
  if (mvts.length === 0) {
    div.innerHTML = `<p class="muted">Aucun mouvement (logs Discord à venir).</p>`;
    return;
  }
  div.innerHTML = `
    <table class="data" id="table-mouvements">
      <thead><tr>
        <th data-sort="date">Date</th>
        <th data-sort="type">Type</th>
        <th data-sort="item">Item</th>
        <th class="right" data-sort="qte">Quantité</th>
        <th data-sort="source">Employé</th>
        <th data-sort="raison">Raison</th>
      </tr></thead>
      <tbody>
        ${mvts.map(m => {
          const u = resolveUser(m);
          const sourceCell = u
            ? `<a href="rh.html?q=${encodeURIComponent(u.prenom + ' ' + u.nom)}" class="user-link" title="Voir le profil employé">${escapeHtml(u.prenom + ' ' + u.nom)}</a>`
            : `<span class="muted" title="Employé non lié à un compte du site">${escapeHtml(m.par || m.source || '—')}</span>`;
          return `
          <tr>
            <td>${datetime(m.timestamp)}</td>
            <td><span class="badge ${m.type?.includes('add') ? 'ok' : 'warn'}">${m.type}</span></td>
            <td>${escapeHtml(m.item || '—')}</td>
            <td class="right mono">${num(m.quantite || 0)}</td>
            <td>${sourceCell}</td>
            <td class="muted">${escapeHtml(m.raison || '')}</td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  `;
  const tMvts = document.getElementById('table-mouvements');
  wrapScroll(tMvts, 400);
  makeSortable(tMvts);
}
// Note : chargerMouvements() est appele uniquement quand l'onglet Mouvements
// est active (clic sur onglet). Pas de chargement initial.

// === Création d'un nouveau produit (direction + DRH) ===
function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const btnNouveauProduit = document.getElementById('btn-nouveau-produit');
if (btnNouveauProduit) {
  const modalNouveau = document.getElementById('modal-nouveau');
  const inputNom     = document.getElementById('new-produit-nom');
  const inputId      = document.getElementById('new-produit-id');

  // Auto-slug du nom vers l'ID tant que l'user n'a pas modifié l'ID manuellement
  let idTouchedByUser = false;
  inputNom.addEventListener('input', () => {
    if (!idTouchedByUser) inputId.value = slugify(inputNom.value);
  });
  inputId.addEventListener('input', () => { idTouchedByUser = true; });

  btnNouveauProduit.addEventListener('click', () => {
    inputNom.value = '';
    inputId.value = '';
    idTouchedByUser = false;
    document.getElementById('new-produit-categorie').value = 'divers';
    document.getElementById('new-produit-prix-achat').value = 0;
    document.getElementById('new-produit-prix-vente').value = 0;
    document.getElementById('new-produit-seuil').value = 5;
    document.getElementById('new-produit-stock').value = 0;
    // Section : par defaut, on prefill avec la section active
    document.getElementById('new-produit-section').value = sectionActive === 'mouvements' ? 'vente_epicerie' : sectionActive;
    document.getElementById('new-produit-fournisseur').value = '';

    // Auto-calc Vente partenaire : prix vente = 2.1 × prix achat
    const inA = document.getElementById('new-produit-prix-achat');
    const inV = document.getElementById('new-produit-prix-vente');
    const inS = document.getElementById('new-produit-section');
    function autoCalc() {
      if (inS.value !== 'vente_pro') return;
      const a = Number(inA.value) || 0;
      inV.value = (a * 2.1).toFixed(2);
    }
    inA.oninput = autoCalc;
    inS.onchange = autoCalc;

    modalNouveau.classList.remove('hidden');
    setTimeout(() => inputNom.focus(), 50);
  });

  document.getElementById('btn-cancel-nouveau').addEventListener('click', () => {
    modalNouveau.classList.add('hidden');
  });

  document.getElementById('btn-creer-produit').addEventListener('click', async () => {
    const nom        = inputNom.value.trim();
    const id         = (inputId.value || '').trim() || slugify(nom);
    const categorie  = document.getElementById('new-produit-categorie').value;
    const prixAchat  = Number(document.getElementById('new-produit-prix-achat').value) || 0;
    const prixVente  = Number(document.getElementById('new-produit-prix-vente').value) || 0;
    const seuilAlerte= Number(document.getElementById('new-produit-seuil').value) || 0;
    const stockInit  = Number(document.getElementById('new-produit-stock').value) || 0;
    const section    = document.getElementById('new-produit-section').value;
    const pourPro       = section === 'vente_pro';
    const intrant       = section === 'achat_fournisseur';
    const enFabrication = section === 'fabrication';
    const fournisseur   = document.getElementById('new-produit-fournisseur').value.trim();

    if (!nom)          return toastError("Nom obligatoire.");
    if (!/^[a-z0-9-]+$/.test(id)) return toastError("Identifiant invalide (lettres minuscules, chiffres, tirets uniquement).");
    if (produits.find(p => p.id === id)) {
      return toastError(`Un produit avec l'ID "${id}" existe déjà — choisis un autre identifiant ou modifie le produit existant.`);
    }
    if (prixVente > 0 && prixAchat > prixVente) {
      const ok = await confirmCritique({
        titre: 'Marge négative',
        message: `Le prix d'achat (<strong>${prixAchat} $</strong>) est supérieur au prix de vente (<strong>${prixVente} $</strong>). Le produit sera vendu à perte.<br><br>Confirmer quand même ?`,
        btnConfirm: 'Créer quand même',
        delaiSec: 3
      });
      if (!ok) return;
    }

    try {
      await setProduit(id, { nom, categorie, prixAchat, prixVente, seuilAlerte, pourPro, intrant, enFabrication, fournisseur });
      // Stock initial : ajustement avec raison "création"
      if (stockInit > 0) {
        const me = getCurrentUser();
        await ajusterStock(id, stockInit, 'Création produit (stock initial)', me?.uid || profile.id);
      }
      toastSuccess(`Produit "${nom}" créé.`);
      modalNouveau.classList.add('hidden');
      // Re-charge la liste + re-render pour refléter le nouveau produit
      // (le listener listenStocks ne se déclenchera que si on a posé un stock initial)
      await chargerProduits();
      renderTable();
    } catch (e) {
      console.error(e);
      toastError(e?.message || e?.code || "Erreur à la création.");
    }
  });
}
