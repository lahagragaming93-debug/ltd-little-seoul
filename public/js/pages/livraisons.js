// ============================================================
// Page : Déclaration de livraison
// ============================================================
// Le LIVREUR déclare ses livraisons (traçabilité — ce qu'il a livré). Aucune
// incidence sur le CA : sa paie est un FIXE de 5 000 $ (le patron verse selon
// les livraisons réellement honorées, en s'appuyant sur cet historique).
// La direction + DRH consultent l'historique complet.
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import {
  ajouterLivraison, listenLivraisons, listenLivraisonsLivreur, supprimerLivraison, listProduits
} from '../api.js';
import { money, escapeHtml } from '../utils/formatters.js';
import { isDirection, isSuperAdmin, canAccess, defaultLandingPage } from '../utils/permissions.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { confirmCritique } from '../utils/confirmation.js';

const { user, profile } = await requireAuth();   // auth seule ; on gère l'accès à la page juste après
const supp              = Array.isArray(profile.accesSupp) ? profile.accesSupp : [];
// Peut DÉCLARER : le livreur (par son rôle) OU toute personne à qui la direction a accordé la
// permission « Déclarer une livraison » (accesSupp). Une déclaration ne génère aucun CA ni salaire.
const peutDeclarer      = canAccess(profile.role, 'livraisons_declare', supp);
const peutConsulterTout = isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh';
const peutSupprimer     = isDirection(profile.role) || isSuperAdmin(profile.role);
// Accès à la page = pouvoir consulter (rôle/accès « livraisons ») OU pouvoir déclarer. Sinon redirection.
if (!peutDeclarer && !canAccess(profile.role, 'livraisons', supp)) {
  window.location.href = defaultLandingPage(profile.role);
  throw new Error('Accès livraisons refusé');
}

// Lundi ISO 'YYYY-MM-DD' d'une date 'YYYY-MM-DD' (getters LOCAUX — jamais de
// toISOString qui décalerait d'un jour en GMT+1/+2).
function lundiKey(ymd) {
  const p = String(ymd || '').split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return '';
  const dt = new Date(p[0], p[1] - 1, p[2]);
  const day = (dt.getDay() + 6) % 7;              // 0 = lundi
  dt.setDate(dt.getDate() - day);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function ymdLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function hmLocal(d)  { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function labelLundi(w) { const p = String(w || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : w; }

const now = new Date();
const formHtml = peutDeclarer ? `
  <div class="panel framed" style="margin-bottom:16px;">
    <div class="panel-title">Déclarer une livraison</div>
    <p class="muted" style="margin-top:-4px;">Renseigne ce que tu as livré. Ça ne compte pas comme du chiffre d'affaires — c'est le suivi de tes livraisons de la semaine, que la direction consulte.</p>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 16px;">
      <div><label>Date</label><input type="date" id="l-date" value="${ymdLocal(now)}"></div>
      <div><label>Heure</label><input type="time" id="l-heure" value="${hmLocal(now)}"></div>
      <div><label>Client livré</label><input type="text" id="l-client" placeholder="Nom du client / entreprise" maxlength="80"></div>
      <div><label>Produit livré</label><select id="l-produit"><option value="">Chargement…</option></select></div>
      <div><label>Quantité</label><input type="number" id="l-qte" min="1" step="1" placeholder="0"></div>
      <div><label>Montant total facturé ($)</label><input type="number" id="l-montant" min="0" step="1" placeholder="0"></div>
    </div>
    <div class="row mt-3">
      <button class="btn btn-primary" id="btn-declarer">Déclarer la livraison</button>
    </div>
  </div>
` : '';

const html = `
  ${formHtml}
  <div class="kpi-grid" id="kpis-liv">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>
  <div class="page-toolbar">
    <span class="spacer"></span>
    <select id="filtre-semaine" style="min-width:200px;"><option value="all">Toutes les semaines</option></select>
  </div>
  <div class="panel framed">
    <div class="panel-title"><span id="liste-titre">Historique des livraisons</span></div>
    <div id="liste">Chargement…</div>
  </div>
`;
renderShell(profile, 'livraisons', html);

let livraisons = [];

// Produits pour le select (livreur uniquement).
if (peutDeclarer) {
  listProduits().then(arr => {
    const sel = document.getElementById('l-produit');
    if (!sel) return;
    const tri = arr.slice().sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    sel.innerHTML = '<option value="">— choisir —</option>' +
      tri.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nom || p.id)}</option>`).join('');
  }).catch(() => {
    const sel = document.getElementById('l-produit');
    if (sel) sel.innerHTML = '<option value="">(produits indisponibles — recharge la page)</option>';
  });
}

// Écoute temps réel : direction = toutes les livraisons ; livreur = les siennes.
if (peutConsulterTout) {
  listenLivraisons(arr => { livraisons = arr; render(); });
} else {
  listenLivraisonsLivreur(user.uid, arr => { livraisons = arr; render(); });
}

document.getElementById('filtre-semaine').addEventListener('change', render);
if (peutDeclarer) document.getElementById('btn-declarer').addEventListener('click', declarer);

async function declarer() {
  const date    = document.getElementById('l-date').value;
  const heure   = document.getElementById('l-heure').value;
  const client  = document.getElementById('l-client').value.trim();
  const selProd = document.getElementById('l-produit');
  const produitId  = selProd.value;
  const produitNom = produitId ? (selProd.options[selProd.selectedIndex]?.text || '') : '';
  const quantite = parseInt(document.getElementById('l-qte').value, 10);
  const montant  = parseInt(document.getElementById('l-montant').value, 10);

  if (!date)   return toastError('Date obligatoire.');
  if (!heure)  return toastError('Heure obligatoire.');
  if (!client) return toastError('Client obligatoire.');
  if (!produitId) return toastError('Produit obligatoire.');
  if (!Number.isFinite(quantite) || quantite <= 0) return toastError('Quantité invalide.');
  if (!Number.isFinite(montant)  || montant  < 0)  return toastError('Montant invalide.');

  const btn = document.getElementById('btn-declarer');
  btn.disabled = true;
  try {
    await ajouterLivraison({
      livreurId: user.uid,
      livreurNom: `${profile.prenom || ''} ${profile.nom || ''}`.trim() || profile.email || '—',
      date, heure,
      weekKey: lundiKey(date),
      client, produitId, produit: produitNom,
      quantite, montant
    });
    toastSuccess('Livraison déclarée.');
    document.getElementById('l-client').value = '';
    document.getElementById('l-qte').value = '';
    document.getElementById('l-montant').value = '';
    selProd.value = '';
  } catch (e) {
    toastError('Échec : ' + (e?.message || 'erreur inattendue.'));
  } finally {
    btn.disabled = false;
  }
}

function render() {
  const selSem = document.getElementById('filtre-semaine');
  const semaines = [...new Set(livraisons.map(l => l.weekKey).filter(Boolean))].sort().reverse();
  const courant = selSem.value;
  selSem.innerHTML = '<option value="all">Toutes les semaines</option>' +
    semaines.map(w => `<option value="${w}">Semaine du ${labelLundi(w)}</option>`).join('');
  if (courant === 'all' || semaines.includes(courant)) selSem.value = courant;

  const filtre = selSem.value;
  const filtrees = (filtre === 'all') ? livraisons : livraisons.filter(l => l.weekKey === filtre);

  const totalMontant = filtrees.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const totalQte     = filtrees.reduce((s, l) => s + (Number(l.quantite) || 0), 0);
  const nbLivreurs   = new Set(filtrees.map(l => l.livreurId)).size;

  document.getElementById('kpis-liv').innerHTML = `
    <div class="kpi"><div class="label">Livraisons</div><div class="value">${filtrees.length}</div><div class="delta">${filtre === 'all' ? 'toutes semaines' : 'cette semaine'}</div></div>
    <div class="kpi"><div class="label">Quantité livrée</div><div class="value">${totalQte}</div><div class="delta">unités</div></div>
    <div class="kpi kpi-bank"><div class="label">Montant facturé</div><div class="value">${money(totalMontant)}</div><div class="delta">total (info — hors CA)</div></div>
    ${peutConsulterTout ? `<div class="kpi"><div class="label">Livreurs</div><div class="value">${nbLivreurs}</div><div class="delta">distincts</div></div>` : ''}
  `;

  document.getElementById('liste-titre').textContent = `Historique des livraisons — ${filtrees.length}`;

  const div = document.getElementById('liste');
  if (filtrees.length === 0) {
    div.innerHTML = `<p class="muted">Aucune livraison déclarée${filtre === 'all' ? '' : ' cette semaine'}.</p>`;
    return;
  }
  div.innerHTML = `
    <div class="table-scroll" style="max-height:600px;">
      <table class="data">
        <thead><tr>
          <th>Date</th><th>Heure</th>
          ${peutConsulterTout ? '<th>Livreur</th>' : ''}
          <th>Client</th><th>Produit</th>
          <th class="right">Qté</th><th class="right">Montant</th>
          ${peutSupprimer ? '<th class="center">—</th>' : ''}
        </tr></thead>
        <tbody>
          ${filtrees.map(l => `
            <tr>
              <td class="mono" style="font-size:0.82rem;">${escapeHtml(l.date || '—')}</td>
              <td class="mono" style="font-size:0.82rem;">${escapeHtml(l.heure || '—')}</td>
              ${peutConsulterTout ? `<td><strong>${escapeHtml(l.livreurNom || '?')}</strong></td>` : ''}
              <td>${escapeHtml(l.client || '—')}</td>
              <td>${escapeHtml(l.produit || '—')}</td>
              <td class="right mono">${Number(l.quantite) || 0}</td>
              <td class="right mono">${money(l.montant || 0)}</td>
              ${peutSupprimer ? `<td class="center"><button class="btn btn-sm btn-danger" data-del="${l.id}" title="Supprimer">Suppr.</button></td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (peutSupprimer) {
    div.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => onSupprimer(btn.getAttribute('data-del')));
    });
  }
}

async function onSupprimer(id) {
  const l = livraisons.find(x => x.id === id);
  const ok = await confirmCritique({
    titre: 'Supprimer cette livraison',
    message: `Supprimer la livraison de <strong>${escapeHtml(l?.livreurNom || '')}</strong> (${escapeHtml(l?.client || '')} · ${escapeHtml(l?.produit || '')}) ? Action définitive.`,
    btnConfirm: 'Supprimer',
    delaiSec: 2
  });
  if (!ok) return;
  try {
    await supprimerLivraison(id);
    toastSuccess('Livraison supprimée.');
  } catch (e) {
    toastError('Échec : ' + (e?.message || 'erreur.'));
  }
}
