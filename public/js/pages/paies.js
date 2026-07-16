// ============================================================
// Page : Mes paies — historique personnel des paiements reçus
// ============================================================

import { requireAuth, getCurrentUser } from '../auth.js';
import { renderShell } from '../layout.js';
import { listMesPaies } from '../api.js';
import { ROLE_LABELS, PLAFOND_SALAIRE } from '../utils/permissions.js';
import { money, datetime, escapeHtml,
         startOfWeekRP, endOfWeekRP } from '../utils/formatters.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { renderPeriodFilter, getPeriode, getPeriodeLabel, attachPeriodFilter } from '../utils/period-filter.js';

const { profile } = await requireAuth('paies');

const html = `
  <div class="page-toolbar" style="flex-wrap:wrap;gap:8px;">
    ${renderPeriodFilter('semaine')}
    <span class="spacer"></span>
  </div>

  <div class="kpi-grid" id="kpis-paies">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="panel framed">
    <div class="panel-title">
      <span>Historique des paies reçues</span>
      <span class="muted mono" id="paies-count">—</span>
    </div>
    <div class="table-scroll">
      <table class="data" id="table-paies">
        <thead>
          <tr>
            <th data-sort="date">Date</th>
            <th data-sort="payeur">Payeur</th>
            <th class="right" data-sort="montant">Montant</th>
            <th data-sort="periode">Période</th>
          </tr>
        </thead>
        <tbody id="tbody-paies"><tr><td colspan="4" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <p class="muted text-center mt-3" style="font-size:0.78rem;">
    Données issues du canal #paie de Discord, mises à jour automatiquement.<br>
    Si tu vois une paie manquante, vérifie que ton ID Discord et ton ID Perso sont bien renseignés sur ton profil.
  </p>
`;
renderShell(profile, 'paies', html);

makeSortable(document.getElementById('table-paies'));

const me = getCurrentUser();
const paies = await listMesPaies(me.uid, 200).catch(() => []);

// === KPIs (dynamiques selon la période choisie) ===
const plafond = PLAFOND_SALAIRE[profile.role] || 0;

function renderKpis() {
  const { debut, fin, label } = getPeriode();
  const paiesPeriode = paies.filter(p => {
    const t = p.timestamp?.toDate?.();
    if (!t) return false;
    if (debut && t < debut) return false;
    if (fin   && t > fin)   return false;
    return true;
  });
  const totalPeriode = paiesPeriode.reduce((s, p) => s + (p.montant || 0), 0);

  document.getElementById('kpis-paies').innerHTML = `
    <div class="kpi kpi-recette">
      <div class="label">Total reçu <span class="muted" style="font-size:0.7rem;">(${escapeHtml(getPeriodeLabel())})</span></div>
      <div class="value">${money(totalPeriode)}</div>
      <div class="delta">${plafond ? `plafond ${money(plafond)} / semaine` : 'tous versements'}</div>
    </div>
    <div class="kpi">
      <div class="label">Nombre de paies <span class="muted" style="font-size:0.7rem;">(${escapeHtml(label)})</span></div>
      <div class="value">${paiesPeriode.length}</div>
      <div class="delta">${paiesPeriode.length > 0 ? `moyenne ${money(Math.round(totalPeriode / paiesPeriode.length))} / paie` : 'aucune sur la période'}</div>
    </div>
    <div class="kpi">
      <div class="label">Total reçu <span class="muted" style="font-size:0.7rem;">(depuis ouverture)</span></div>
      <div class="value">${money(paies.reduce((s, p) => s + (p.montant || 0), 0))}</div>
      <div class="delta">${paies.length} paie${paies.length > 1 ? 's' : ''} au total</div>
    </div>
    <div class="kpi">
      <div class="label">Rôle</div>
      <div class="value" style="font-size:1.4rem;">${ROLE_LABELS[profile.role] || profile.role}</div>
      <div class="delta">${profile.dateEntree ? `entré ${profile.dateEntree}` : 'actif'}</div>
    </div>
  `;
}
renderKpis();
attachPeriodFilter(renderKpis);

// === Table des paies ===
document.getElementById('paies-count').textContent =
  `${paies.length} paie${paies.length > 1 ? 's' : ''} reçue${paies.length > 1 ? 's' : ''}`;

const tbody = document.getElementById('tbody-paies');
if (paies.length === 0) {
  tbody.innerHTML = `<tr><td colspan="4" class="muted text-center">
    Aucune paie reçue pour le moment.<br>
    <span style="font-size:0.78rem;">Si tu en attends une, vérifie avec la direction que ton compte a bien le bon ID Discord et ID Perso.</span>
  </td></tr>`;
} else {
  tbody.innerHTML = paies.map(p => {
    const t = p.timestamp?.toDate?.();
    const periode = t
      ? `${t.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} (${t.toLocaleDateString('fr-FR', { weekday: 'long' })})`
      : '—';
    return `
      <tr>
        <td class="mono">${datetime(p.timestamp)}</td>
        <td>${escapeHtml(p.payeurNom || p.payeurDiscord || '—')}</td>
        <td class="right mono">${money(p.montant)}</td>
        <td class="muted">${periode}</td>
      </tr>
    `;
  }).join('');
}
