// ============================================================
// Page : Découverte des items FiveM (outil de mapping)
// Liste tous les itemNom uniques observés dans /mouvementsStock,
// triés par fréquence. Le user les mappe avec le catalogue commercial.
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listItemsFiveMUniques } from '../api.js';
import { CATALOGUE } from '../data/produits.js';
import { datetime, escapeHtml, dateKeyLocal } from '../utils/formatters.js';
import { isDirection, isSuperAdmin } from '../utils/permissions.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';

const { profile } = await requireAuth('admin');
if (!isDirection(profile.role) && !isSuperAdmin(profile.role) && profile.role !== 'drh') {
  document.body.innerHTML = '<div style="padding:30px;color:#fff;background:#1a1a1a;">Accès réservé à Direction / DRH / Admin Technique.</div>';
  throw new Error('Forbidden');
}

const html = `
  <div class="alert info mb-2">
    <span>
      <strong>Outil de découverte des items FiveM.</strong> Liste agrégée de tous
      les noms d'items vus passer dans <code>#logs-ig</code> (collection
      <code>/mouvementsStock</code>), triés par fréquence.
      <br>Utilise cette liste pour identifier les <strong>noms internes FiveM</strong> de
      tes produits commerciaux (ex. "Crème Glaci" → "Crème Glacée"). Le mapping
      définitif se fera dans <code>discord-bot/parsers/mapping-fivem.js</code>.
    </span>
  </div>

  <div class="row mb-2" style="flex-wrap:wrap;gap:8px;">
    <button class="btn btn-primary" id="btn-recharger">Recharger</button>
    <input type="text" id="filtre-recherche" placeholder="Filtrer par nom…" style="flex:1;min-width:200px;" />
    <select id="filtre-mapping">
      <option value="">Tous</option>
      <option value="non-mappe">Non mappés (parasites / nouveaux)</option>
      <option value="mappe">Déjà dans le catalogue</option>
    </select>
    <button class="btn" id="btn-export-csv">Export CSV</button>
    <span class="spacer"></span>
    <span class="muted mono" id="stats-items">—</span>
  </div>

  <div class="panel framed">
    <div class="panel-title">
      <span>Items FiveM observés</span>
      <span class="muted" style="font-size:0.75rem;">— les 2000 derniers mouvements de stock</span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-items">
        <thead>
          <tr>
            <th data-sort="nom">Nom FiveM (brut)</th>
            <th data-sort="slug">Slug interne</th>
            <th class="right" data-sort="vu">Vu (×)</th>
            <th data-sort="premier">Premier vu</th>
            <th data-sort="dernier">Dernier vu</th>
            <th class="center" data-sort="mapping">Mapping catalogue</th>
          </tr>
        </thead>
        <tbody id="tbody-items">
          <tr><td colspan="6" class="muted text-center">Chargement…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
`;

renderShell(profile, 'admin', html);

makeSortable(document.getElementById('table-items'));

// Index des slugs du catalogue pour détecter les items déjà mappés
const SLUGS_CATALOGUE = new Set(CATALOGUE.map(p => p.id));
const NOMS_CATALOGUE = new Set(CATALOGUE.map(p => p.nom.toLowerCase()));

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Suggère un produit du catalogue qui ressemble (Levenshtein simple)
function suggererCatalogue(nomBrut) {
  const slug = slugify(nomBrut);
  // Match exact slug
  if (SLUGS_CATALOGUE.has(slug)) {
    const p = CATALOGUE.find(p => p.id === slug);
    return { type: 'exact', produit: p };
  }
  // Match exact nom
  const lc = nomBrut.toLowerCase();
  if (NOMS_CATALOGUE.has(lc)) {
    const p = CATALOGUE.find(p => p.nom.toLowerCase() === lc);
    return { type: 'exact-nom', produit: p };
  }
  // Match approximatif : un mot du nomBrut est dans un nom du catalogue
  const motsBruts = lc.split(/\s+/).filter(m => m.length >= 3);
  for (const p of CATALOGUE) {
    const nomCat = p.nom.toLowerCase();
    for (const mot of motsBruts) {
      if (nomCat.includes(mot)) {
        return { type: 'approx', produit: p, motCommun: mot };
      }
    }
  }
  return null;
}

let items = [];

async function charger() {
  const tbody = document.getElementById('tbody-items');
  tbody.innerHTML = '<tr><td colspan="6" class="muted text-center">Chargement…</td></tr>';
  try {
    items = await listItemsFiveMUniques(2000);
    rendre();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="alert danger">Erreur : ${escapeHtml(e.message || e.code)}</td></tr>`;
  }
}

function rendre() {
  const filtre = document.getElementById('filtre-recherche').value.toLowerCase().trim();
  const filtreMap = document.getElementById('filtre-mapping').value;

  let visibles = items;
  if (filtre) {
    visibles = visibles.filter(i =>
      i.nomFivem.toLowerCase().includes(filtre) ||
      (i.slug || '').toLowerCase().includes(filtre)
    );
  }
  if (filtreMap === 'mappe') {
    visibles = visibles.filter(i => suggererCatalogue(i.nomFivem)?.type === 'exact' || suggererCatalogue(i.nomFivem)?.type === 'exact-nom');
  } else if (filtreMap === 'non-mappe') {
    visibles = visibles.filter(i => {
      const sug = suggererCatalogue(i.nomFivem);
      return !sug || sug.type === 'approx';
    });
  }

  const stats = document.getElementById('stats-items');
  const totalMappes = items.filter(i => {
    const s = suggererCatalogue(i.nomFivem);
    return s && (s.type === 'exact' || s.type === 'exact-nom');
  }).length;
  stats.textContent = `${visibles.length} affichés / ${items.length} uniques (${totalMappes} mappés)`;

  const tbody = document.getElementById('tbody-items');
  if (visibles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted text-center">Aucun item ne correspond au filtre.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(i => {
    const sug = suggererCatalogue(i.nomFivem);
    let mapping = '<span class="badge warn">Non mappé</span>';
    if (sug?.type === 'exact')      mapping = `<span class="badge ok">${escapeHtml(sug.produit.nom)}</span>`;
    else if (sug?.type === 'exact-nom') mapping = `<span class="badge ok">${escapeHtml(sug.produit.nom)} <small>(par nom)</small></span>`;
    else if (sug?.type === 'approx')    mapping = `<span class="badge" style="background:#fff8d4;color:#7a6800;border:1px solid #c9a961;">${escapeHtml(sug.produit.nom)} <small>(approx)</small></span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(i.nomFivem)}</strong></td>
        <td class="mono" style="font-size:0.78rem;color:#888;">${escapeHtml(i.slug || '—')}</td>
        <td class="right mono"><strong>${i.count}</strong></td>
        <td class="muted" style="font-size:0.78rem;">${escapeHtml(datetime(i.premierVu))}</td>
        <td class="muted" style="font-size:0.78rem;">${escapeHtml(datetime(i.dernierVu))}</td>
        <td class="center">${mapping}</td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-recharger').addEventListener('click', charger);
document.getElementById('filtre-recherche').addEventListener('input', rendre);
document.getElementById('filtre-mapping').addEventListener('change', rendre);

document.getElementById('btn-export-csv').addEventListener('click', () => {
  const lines = ['Nom FiveM;Slug;Vu (×);Premier vu;Dernier vu;Suggestion catalogue;Type match'];
  for (const i of items) {
    const sug = suggererCatalogue(i.nomFivem);
    const sugTxt = sug ? sug.produit.nom : '';
    const sugType = sug?.type || 'aucun';
    lines.push([
      i.nomFivem.replace(/;/g, ','),
      i.slug || '',
      i.count,
      datetime(i.premierVu) || '',
      datetime(i.dernierVu) || '',
      sugTxt.replace(/;/g, ','),
      sugType
    ].join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `items-fivem-decouverte-${dateKeyLocal(new Date())}.csv`;
  a.click();
  toastSuccess('Export CSV téléchargé.');
});

charger();
