// ============================================================
// Page : Notes de frais
// ============================================================
// Liste toutes les notes de frais (essence vehicule LTD avance par les
// pompistes). Direction + DRH peuvent approuver / rejeter / marquer
// remboursee. Le resp-pompiste a un acces lecture seule (pilotage).
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listenAllNotesFrais, callFunction, logSite } from '../api.js';
import { money, datetime, escapeHtml } from '../utils/formatters.js';
import { isDirection, isSuperAdmin } from '../utils/permissions.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { confirmCritique, infoModal } from '../utils/confirmation.js';

const { profile } = await requireAuth('notes_frais');
const canTraiter = isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh';

const STATUT_LABEL = {
  'en-attente': 'En attente',
  'approuvee':  'Approuvée',
  'remboursee': 'Remboursée',
  'rejetee':    'Rejetée'
};
const STATUT_CLASS = {
  'en-attente': 'warn',
  'approuvee':  'neutral',
  'remboursee': 'ok',
  'rejetee':    'danger'
};

const html = `
  <div class="kpi-grid" id="kpis-nf">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="page-toolbar">
    <span class="spacer"></span>
    <select id="filtre-statut" style="min-width:180px;">
      <option value="all">Tous statuts</option>
      <option value="en-attente" selected>En attente</option>
      <option value="approuvee">Approuvée</option>
      <option value="remboursee">Remboursée</option>
      <option value="rejetee">Rejetée</option>
    </select>
  </div>

  <div class="panel framed">
    <div class="panel-title"><span id="liste-titre">Notes de frais</span></div>
    <div id="liste">Chargement…</div>
  </div>

  <!-- Modal screenshot (visualisation) -->
  <div id="modal-screen" class="modal-backdrop hidden">
    <div class="modal" style="max-width:680px;">
      <h3>Screenshot de la note de frais</h3>
      <div id="modal-screen-body" style="text-align:center;">—</div>
      <div class="row mt-3">
        <button class="btn btn-ghost" id="btn-close-screen">Fermer</button>
      </div>
    </div>
  </div>

  <!-- Modal rejet (motif obligatoire) -->
  <div id="modal-reject" class="modal-backdrop hidden">
    <div class="modal" style="max-width:480px;">
      <h3>Rejeter la note de frais</h3>
      <p class="muted">Le motif sera visible par le pompiste pour qu'il comprenne le refus.</p>
      <label>Motif de rejet <span style="color:var(--color-blood-light);">*</span></label>
      <textarea id="reject-motif" rows="3" maxlength="500" placeholder="Ex : screenshot illisible, montant non justifie, ..."></textarea>
      <div class="row mt-3">
        <button class="btn btn-danger" id="btn-confirm-reject">Confirmer le rejet</button>
        <button class="btn btn-ghost" id="btn-cancel-reject">Annuler</button>
      </div>
    </div>
  </div>
`;
renderShell(profile, 'notes_frais', html);

let notes = [];

listenAllNotesFrais((arr) => {
  notes = arr;
  render();
});

document.getElementById('filtre-statut').addEventListener('change', render);
document.getElementById('btn-close-screen').addEventListener('click', () => {
  document.getElementById('modal-screen').classList.add('hidden');
});

function render() {
  const filtre = document.getElementById('filtre-statut').value;
  const filtrees = (filtre === 'all') ? notes : notes.filter(n => n.statut === filtre);

  // KPIs
  const enAttente = notes.filter(n => n.statut === 'en-attente');
  const approuvees = notes.filter(n => n.statut === 'approuvee');
  const remboursees = notes.filter(n => n.statut === 'remboursee');
  const totalEnAttente = enAttente.reduce((s, n) => s + (Number(n.montant) || 0), 0);
  const totalRemboursees = remboursees.reduce((s, n) => s + (Number(n.montant) || 0), 0);

  // Si on a atteint le plafond (200), l'historique est tronque : on affiche
  // "200+" et le delta indique la limite pour ne pas mentir.
  const LIMITE_NOTES = 200;
  const totalTrouve = notes.length >= LIMITE_NOTES;
  const labelTotal  = totalTrouve ? `${LIMITE_NOTES}+` : String(notes.length);
  const deltaTotal  = totalTrouve
    ? `limite affichage ${LIMITE_NOTES} dernieres`
    : 'toutes périodes';

  document.getElementById('kpis-nf').innerHTML = `
    <div class="kpi"><div class="label">En attente</div><div class="value">${enAttente.length}</div><div class="delta">${money(totalEnAttente)} à valider</div></div>
    <div class="kpi"><div class="label">Approuvées</div><div class="value">${approuvees.length}</div><div class="delta">prêtes à rembourser</div></div>
    <div class="kpi kpi-bank"><div class="label">Remboursées</div><div class="value">${remboursees.length}</div><div class="delta">${money(totalRemboursees)} total</div></div>
    <div class="kpi"><div class="label">Total notes</div><div class="value">${labelTotal}</div><div class="delta">${deltaTotal}</div></div>
  `;

  document.getElementById('liste-titre').textContent =
    `Notes de frais — ${filtrees.length} ${filtre === 'all' ? 'au total' : STATUT_LABEL[filtre] || filtre}`;

  const div = document.getElementById('liste');
  if (filtrees.length === 0) {
    div.innerHTML = `<p class="muted">Aucune note ${filtre === 'all' ? '' : 'dans ce statut'}.</p>`;
    return;
  }

  div.innerHTML = `
    <div class="table-scroll" style="max-height:600px;">
      <table class="data">
        <thead><tr>
          <th>Date</th>
          <th>Employé</th>
          <th class="right">Montant</th>
          <th>Description</th>
          <th>Screenshot</th>
          <th>Statut</th>
          <th>Traitée par</th>
          ${canTraiter ? '<th class="center">Actions</th>' : ''}
        </tr></thead>
        <tbody>
          ${filtrees.map(n => {
            const motif = n.motifRejet ? `<div class="muted" style="font-size:0.75rem;">Motif rejet : ${escapeHtml(n.motifRejet)}</div>` : '';
            return `
              <tr>
                <td class="mono" style="font-size:0.82rem;">${datetime(n.timestamp)}</td>
                <td><strong>${escapeHtml(n.employeNom || '?')}</strong><div class="muted" style="font-size:0.72rem;">${escapeHtml(n.employeRole || '')}</div></td>
                <td class="right mono"><strong>${money(n.montant || 0)}</strong></td>
                <td style="max-width:280px;">${escapeHtml(n.description || '—')}${motif}</td>
                <td><button class="btn btn-sm" data-view-screen="${n.id}">Voir</button></td>
                <td><span class="badge ${STATUT_CLASS[n.statut] || 'neutral'}">${STATUT_LABEL[n.statut] || n.statut}</span>${n.dateRemboursement ? `<div class="muted" style="font-size:0.72rem;">${datetime(n.dateRemboursement)}</div>` : ''}</td>
                <td class="muted" style="font-size:0.78rem;">${escapeHtml(n.traiteeParNom || '—')}</td>
                ${canTraiter ? `<td class="center">${renderActions(n)}</td>` : ''}
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Bind actions
  div.querySelectorAll('[data-view-screen]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-view-screen');
      const note = notes.find(x => x.id === id);
      if (!note) return;
      const url = note.screenshotUrl || '';
      const isDataUrl = /^data:/.test(url);
      // Pour les data: URLs (collees Ctrl+V), on affiche juste l'image
      // (pas le lien texte qui ferait des milliers de caracteres). Pour les
      // URLs externes, on affiche aussi le lien cliquable.
      const linkBlock = isDataUrl
        ? `<p class="muted" style="font-size:0.78rem;">Image collée par l'employé (stockée inline).</p>`
        : `<p class="muted" style="font-size:0.82rem;word-break:break-all;">
             <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
           </p>`;
      document.getElementById('modal-screen-body').innerHTML = `
        ${linkBlock}
        <img src="${escapeHtml(url)}" alt="Screenshot" style="max-width:100%;max-height:60vh;border:1px solid var(--color-bone-dark, #444);border-radius:4px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />
        <p class="muted" style="display:none;">Impossible d'afficher l'image. ${isDataUrl ? 'Données corrompues.' : 'Clique sur le lien ci-dessus pour l\'ouvrir.'}</p>
      `;
      document.getElementById('modal-screen').classList.remove('hidden');
    });
  });

  if (canTraiter) {
    div.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => onAction(btn.dataset.id, btn.dataset.action));
    });
  }
}

function renderActions(n) {
  if (!canTraiter) return '';
  switch (n.statut) {
    case 'en-attente':
      return `
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">
          <button class="btn btn-sm" data-action="approuver" data-id="${n.id}" title="Approuver">Approuver</button>
          <button class="btn btn-sm" data-action="rembourser" data-id="${n.id}" title="Marquer remboursée">Rembourser</button>
          <button class="btn btn-sm btn-danger" data-action="rejeter" data-id="${n.id}" title="Rejeter">Rejeter</button>
        </div>
      `;
    case 'approuvee':
      return `<button class="btn btn-sm btn-primary" data-action="rembourser" data-id="${n.id}">Marquer remboursée</button>`;
    default:
      return '<span class="muted" style="font-size:0.78rem;">—</span>';
  }
}

async function onAction(id, action) {
  let motifRejet = '';
  if (action === 'rejeter') {
    // Ouvre le modal de saisie du motif
    const modalReject = document.getElementById('modal-reject');
    const inputMotif = document.getElementById('reject-motif');
    inputMotif.value = '';
    modalReject.classList.remove('hidden');
    motifRejet = await new Promise((resolve) => {
      const onConfirm = () => {
        const m = inputMotif.value.trim();
        if (m.length < 3) { toastError('Motif trop court (min 3 caractères).'); return; }
        modalReject.classList.add('hidden');
        cleanup();
        resolve(m);
      };
      const onCancel = () => {
        modalReject.classList.add('hidden');
        cleanup();
        resolve(null);
      };
      function cleanup() {
        document.getElementById('btn-confirm-reject').removeEventListener('click', onConfirm);
        document.getElementById('btn-cancel-reject').removeEventListener('click', onCancel);
      }
      document.getElementById('btn-confirm-reject').addEventListener('click', onConfirm);
      document.getElementById('btn-cancel-reject').addEventListener('click', onCancel);
    });
    if (motifRejet === null) return; // user annulé
  }
  if (action === 'rembourser') {
    const note = notes.find(n => n.id === id);
    const ok = await confirmCritique({
      titre: 'Marquer cette note remboursée',
      message: `Tu confirmes avoir reversé <strong>${money(note?.montant || 0)}</strong> à <strong>${escapeHtml(note?.employeNom || '')}</strong> ? <br><br>Aucune dépense n'est créée par le site : le versement en jeu remontera automatiquement dans les mouvements bancaires via les logs, où il sera classifié par le cabinet.`,
      btnConfirm: 'Oui, j\'ai remboursé',
      delaiSec: 2
    });
    if (!ok) return;
  }
  try {
    await callFunction('traiterNoteFrais', { noteId: id, action, motifRejet });
    toastSuccess(`Note de frais ${action === 'approuver' ? 'approuvée' : action === 'rembourser' ? 'marquée remboursée' : 'rejetée'}.`);
    logSite('notes-frais', 'Note de frais ' + (action === 'approuver' ? 'approuvée' : action === 'rembourser' ? 'remboursée' : 'rejetée'), [
      { name: 'Note', value: String(id), inline: true },
      ...(motifRejet ? [{ name: 'Motif rejet', value: String(motifRejet).slice(0, 300), inline: false }] : [])
    ]);
  } catch (e) {
    toastError("Échec : " + (e?.message || 'erreur inattendue.'));
  }
}
