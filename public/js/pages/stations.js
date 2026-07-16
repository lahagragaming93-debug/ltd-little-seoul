// ============================================================
// Page : Stations essence (8 stations)
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { listenStations, setStation, listRedistributionsSemaine,
         getConfig, listenConfig, setConfig, doc, deleteDoc,
         callFunction } from '../api.js';
import { db } from '../firebase-config.js';
import { collection, query, where, orderBy, getDocs, Timestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { money, moneyPrecis, num, pct, datetime, escapeHtml,
         startOfWeekRP, endOfWeekRP, durationHM } from '../utils/formatters.js';
import { isDirection, isSuperAdmin, isPompiste } from '../utils/permissions.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { confirmCritique, infoModal } from '../utils/confirmation.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';

const { profile } = await requireAuth('stocks_essence');
// fullEdit  = peut TOUT modifier (prix, capacite, seuil, N° pompe, supprimer, ajouter une station)
// stockOnly = peut UNIQUEMENT toucher stockActuel (pompiste qui ravitaille)
// 2026-05-13 : DRH ajoute dans fullEdit (alignement Direction sur demande patron).
const fullEdit  = isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh';
const stockOnly = !fullEdit && (profile.role === 'responsable-pompiste' || isPompiste(profile.role));
const editable  = fullEdit || stockOnly;

// Charge config en avance pour pouvoir griser le bouton "Declarer caoutchoucs"
// si la dimension est desactivee cette semaine (quotaCaoutchoucs = 0).
let config = await getConfig().catch(() => ({}));
const caoutsActifPage = (config.quotaCaoutchoucs ?? 800) > 0;

const html = `
  <div class="kpi-grid" id="kpis-essence">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div class="page-toolbar">
    ${fullEdit ? '<button class="btn btn-primary" id="btn-ajouter-station" title="Ajouter une station essence" data-tooltip="Ajouter station">+ Ajouter station</button>' : ''}
    ${fullEdit ? '<a class="btn" href="rh.html#panel-quotas-hebdo" title="Quotas hebdomadaires (page RH)" data-tooltip="Quotas hebdo">Quotas hebdo</a>' : ''}
    ${stockOnly ? (caoutsActifPage
      ? '<button class="btn btn-primary btn-compact" id="btn-declarer-caoutchoucs" title="Déclarer le nombre de caoutchoucs fabriqués">Déclarer caoutchoucs</button>'
      : '<button class="btn btn-compact" disabled style="opacity:0.5;cursor:not-allowed;" title="Caoutchoucs non requis cette semaine (quota = 0)">Caoutchoucs — non requis</button>'
    ) : ''}
    <span class="spacer"></span>
    <span class="muted mono" id="stations-count">—</span>
  </div>

  ${stockOnly && caoutsActifPage ? `
    <!-- Modal declaration caoutchoucs -->
    <div id="modal-caoutchoucs" class="modal-backdrop hidden">
      <div class="modal" style="max-width:480px;">
        <h3>Déclarer des caoutchoucs fabriqués</h3>
        <div class="alert info mb-2" style="font-size:0.82rem;">
          <span>Saisis le <strong>nombre de caoutchoucs</strong> que tu viens de fabriquer et de poser dans le coffre dédié. Le site met à jour ton quota immédiatement.</span>
        </div>
        <label>Nombre de caoutchoucs fabriqués</label>
        <input type="number" id="caou-nb" min="1" max="500" step="1" placeholder="ex: 50" />
        <div class="muted mt-1" id="caou-preview" style="font-size:0.82rem;">—</div>
        <div class="row mt-3">
          <button class="btn btn-primary" id="btn-save-caoutchoucs">Valider la déclaration</button>
          <button class="btn btn-ghost" id="btn-cancel-caoutchoucs">Annuler</button>
        </div>
      </div>
    </div>
  ` : ''}

  <div class="panel framed">
    <div class="panel-title"><span>Stations</span></div>
    <div id="stations-grid">Chargement…</div>
  </div>

  <div class="panel">
    <div class="panel-title">
      <span>Redistributions de la semaine</span>
      ${(fullEdit || profile.role === 'responsable-pompiste') ? '<span class="muted" style="font-size:0.78rem;">Suivi déclarations — modifier / supprimer</span>' : ''}
    </div>
    <div id="redistributions">Chargement…</div>
  </div>

  ${(fullEdit || profile.role === 'responsable-pompiste') ? `
  <div class="panel">
    <div class="panel-title">
      <span>Déclarations caoutchoucs de la semaine</span>
      <span class="muted" style="font-size:0.78rem;">Suivi déclarations — modifier / supprimer</span>
    </div>
    <div id="declarations-caoutchoucs">Chargement…</div>
  </div>
  ` : ''}

  <!-- Modal modification declaration (ravitaillement ou caoutchoucs) -->
  ${(fullEdit || profile.role === 'responsable-pompiste') ? `
  <div id="modal-edit-decl" class="modal-backdrop hidden">
    <div class="modal" style="max-width:480px;">
      <h3 id="edit-decl-title">Modifier la déclaration</h3>
      <p class="muted" id="edit-decl-info" style="font-size:0.85rem;">—</p>
      <label id="edit-decl-label">Nouvelle valeur</label>
      <input type="number" id="edit-decl-input" min="1" step="1" />
      <div class="muted mt-1" id="edit-decl-preview" style="font-size:0.78rem;">—</div>
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-edit-decl-save">Enregistrer</button>
        <button class="btn btn-ghost" id="btn-edit-decl-cancel">Annuler</button>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Modal station -->
  <div id="modal-station" class="modal-backdrop hidden">
    <div class="modal">
      <h3 id="modal-station-title">Station</h3>
      ${stockOnly ? `
        <div class="alert info mb-2" style="font-size:0.82rem;">
          <span>Saisis le <strong>nombre de bidons</strong> que tu viens de mettre dans la station (1 bidon = 15 L). Le site met automatiquement à jour le stock, l'historique et ton quota.</span>
        </div>

        <div class="panel" style="margin:0 0 12px 0;background:rgba(0,0,0,0.18);">
          <div class="row between"><span class="muted">Station</span><strong id="ro-nom">—</strong></div>
          <div class="row between"><span class="muted">Stock actuel</span><strong id="ro-stock-actuel">—</strong></div>
          <div class="row between"><span class="muted">Capacité max</span><strong id="ro-stock-max">—</strong></div>
        </div>

        <label>Bidons ajoutés <span class="muted" style="font-size:0.75rem;">— 1 bidon = 15 L</span></label>
        <input type="number" id="st-bidons" min="1" step="1" placeholder="ex: 5" />
        <div class="muted mt-1" id="bidons-preview" style="font-size:0.82rem;">—</div>

        <input type="hidden" id="st-id" />
      ` : `
        <input type="hidden" id="st-id" />
        <label>Nom</label>
        <input type="text" id="st-nom" required />
        <div class="field-row">
          <div><label>Stock actuel (L)</label><input type="number" id="st-stock-actuel" min="0" /></div>
          <div><label>Capacité max (L)</label><input type="number" id="st-stock-max" min="0" /></div>
          <div><label>Seuil alerte (L)</label><input type="number" id="st-seuil" min="0" /></div>
        </div>
        <label>Prix au litre ($)</label>
        <input type="number" id="st-prix" step="0.1" min="0" />
        <label>N° pompe FiveM <span class="muted" style="font-size:0.75rem;">— identifiant in-game qui apparaît dans "Redistribution N°XXXXX" (#logs-ig)</span></label>
        <input type="text" id="st-fivem-pompe" placeholder="ex: 16060" />
      `}
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save-station">${stockOnly ? 'Valider le ravitaillement' : 'Enregistrer'}</button>
        ${fullEdit ? '<button class="btn btn-danger" id="btn-delete-station" style="display:none;" title="Supprimer la station" data-tooltip="Supprimer">Supprimer</button>' : ''}
        <button class="btn btn-ghost" id="btn-cancel-station">Annuler</button>
      </div>
    </div>
  </div>

`;
renderShell(profile, 'stocks_essence', html);

// Listener temps-reel sur /config/global : tablettes in-game (pas de F5).
// Reload des qu'un champ critique change (quotas, prix essence).
const _cfgSigStations = JSON.stringify({
  qB: config.quotaBidons,
  qC: config.quotaCaoutchoucs,
  qCA: config.quotaCAVendeur,
  pE: config.prixEssence
});
listenConfig((newCfg) => {
  const sig = JSON.stringify({
    qB: newCfg.quotaBidons,
    qC: newCfg.quotaCaoutchoucs,
    qCA: newCfg.quotaCAVendeur,
    pE: newCfg.prixEssence
  });
  if (sig !== _cfgSigStations) {
    console.log('[stations] config changee live -> reload');
    window.location.reload();
  }
});

let stations = [];
listenStations(s => {
  stations = s;
  renderStations();
});

function renderStations() {
  const grid = document.getElementById('stations-grid');
  if (stations.length === 0) {
    grid.innerHTML = `<p class="muted">Aucune station configurée. ${editable ? 'Ajoute la première avec le bouton ci-dessus.' : ''}</p>`;
    document.getElementById('stations-count').textContent = '0 stations';
    miseAJourKpis(stations);
    return;
  }
  document.getElementById('stations-count').textContent = `${stations.length} station${stations.length > 1 ? 's' : ''}`;

  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
      ${stations.map(s => {
        const niveau = s.stockMax ? (s.stockActuel / s.stockMax) * 100 : 0;
        const sousAlerte = s.stockActuel < (s.seuilAlerte || 0);
        const cls = sousAlerte ? 'alert-out' : '';
        return `
          <div class="panel" style="margin:0;${sousAlerte ? 'border-color:var(--color-blood);' : ''}">
            <div class="row between">
              <h4 style="margin:0;color:var(--color-sand-light);">${escapeHtml(s.nom)}</h4>
              ${sousAlerte ? '<span class="badge danger">ALERTE</span>' : '<span class="badge ok">OK</span>'}
            </div>
            <div class="progress mt-2" style="height:22px;">
              <div class="fill" style="width:${Math.min(niveau, 100)}%"></div>
              <div class="label">${num(s.stockActuel || 0)} / ${num(s.stockMax || 0)} L</div>
            </div>
            <div class="row between mt-2 muted mono" style="font-size:0.8rem;">
              <span>Prix : ${moneyPrecis(s.prixLitre || 0)}/L</span>
              <span>Seuil : ${num(s.seuilAlerte || 0)} L</span>
            </div>
            ${editable ? `
              <button class="btn btn-sm mt-2" data-edit="${s.id}">Modifier / redistribuer</button>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  grid.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', () => ouvrirStation(b.dataset.edit));
  });

  miseAJourKpis(stations);
}

function miseAJourKpis(stations) {
  const totalActuel = stations.reduce((s, x) => s + (x.stockActuel || 0), 0);
  const totalMax = stations.reduce((s, x) => s + (x.stockMax || 0), 0);
  const enAlerte = stations.filter(x => x.stockActuel < (x.seuilAlerte || 0)).length;
  const niveau = totalMax ? (totalActuel / totalMax) * 100 : 0;
  document.getElementById('kpis-essence').innerHTML = `
    <div class="kpi"><div class="label">Stations</div><div class="value">${stations.length}</div><div class="delta">configurées</div></div>
    <div class="kpi"><div class="label">Stock total</div><div class="value">${num(totalActuel)} L</div><div class="delta">${num(totalMax)} L max (${niveau.toFixed(0)}%)</div></div>
    <div class="kpi"><div class="label">Stations en alerte</div><div class="value">${enAlerte}</div><div class="delta ${enAlerte ? 'down' : 'up'}">sous seuil</div></div>
    <div class="kpi"><div class="label">Quota bidon/sem</div><div class="value">${num(config.quotaBidons ?? 1700)}</div><div class="delta">par pompiste</div></div>
  `;
}

// === Modal station ===
const modal = document.getElementById('modal-station');

if (fullEdit) {
  document.getElementById('btn-ajouter-station').addEventListener('click', () => {
    document.getElementById('st-id').value = '';
    document.getElementById('st-nom').value = '';
    document.getElementById('st-stock-actuel').value = 0;
    document.getElementById('st-stock-max').value = 30000;
    document.getElementById('st-seuil').value = 1000;
    document.getElementById('st-prix').value = 5;
    document.getElementById('st-fivem-pompe').value = '';
    document.getElementById('modal-station-title').textContent = 'Nouvelle station';
    const delBtn = document.getElementById('btn-delete-station');
    if (delBtn) delBtn.style.display = 'none';
    modal.classList.remove('hidden');
  });
}

function ouvrirStation(id) {
  const s = stations.find(x => x.id === id);
  if (!s) return;
  document.getElementById('st-id').value = id;
  document.getElementById('modal-station-title').textContent = s.nom;

  if (stockOnly) {
    document.getElementById('ro-nom').textContent = s.nom || '—';
    document.getElementById('ro-stock-actuel').textContent = `${num(s.stockActuel || 0)} L`;
    document.getElementById('ro-stock-max').textContent = `${num(s.stockMax || 0)} L`;
    document.getElementById('st-bidons').value = '';
    document.getElementById('bidons-preview').textContent = '—';
  } else {
    document.getElementById('st-nom').value = s.nom || '';
    document.getElementById('st-stock-actuel').value = s.stockActuel || 0;
    document.getElementById('st-stock-max').value = s.stockMax || 0;
    document.getElementById('st-seuil').value = s.seuilAlerte || 0;
    document.getElementById('st-prix').value = s.prixLitre || 0;
    document.getElementById('st-fivem-pompe').value = s.fivemPompeId || '';
    const delBtn = document.getElementById('btn-delete-station');
    if (delBtn) delBtn.style.display = 'inline-block';
  }
  modal.classList.remove('hidden');
}

// Preview live + barriere overflow : 1 bidon = 15 L, refuser si depasse stockMax.
const BIDON_L = 15;
if (stockOnly) {
  document.getElementById('st-bidons').addEventListener('input', (e) => {
    const id = document.getElementById('st-id').value;
    const s = stations.find(x => x.id === id);
    if (!s) return;
    const n = parseInt(e.target.value, 10);
    const preview = document.getElementById('bidons-preview');
    if (!Number.isFinite(n) || n <= 0) {
      preview.textContent = '—';
      preview.style.color = '';
      return;
    }
    const ajout = n * BIDON_L;
    const stockFinal = (s.stockActuel || 0) + ajout;
    const stockMax = s.stockMax || 0;
    if (stockMax > 0 && stockFinal > stockMax) {
      const placeRestante = Math.max(0, stockMax - (s.stockActuel || 0));
      const bidonsMax = Math.floor(placeRestante / BIDON_L);
      preview.style.color = 'var(--color-blood, #d33)';
      preview.innerHTML = `Impossible : ${n} bidons = ${num(ajout)} L mais la station n'accepte que <strong>${bidonsMax} bidons max</strong> (${num(placeRestante)} L libres).`;
    } else {
      preview.style.color = '';
      preview.textContent = `${n} bidon${n > 1 ? 's' : ''} = ${num(ajout)} L → stock final : ${num(stockFinal)} L / ${num(stockMax)} L`;
    }
  });
}

document.getElementById('btn-cancel-station').addEventListener('click', () => modal.classList.add('hidden'));

document.getElementById('btn-save-station').addEventListener('click', async () => {
  const id = document.getElementById('st-id').value || ('station_' + Date.now());

  // Cas pompiste : saisie en bidons. La Cloud Function fait atomiquement :
  // (1) maj stockActuel station, (2) doc /redistributions audit, (3) increment quota.
  if (stockOnly) {
    if (!id) return toastError("Station introuvable.");
    const bidons = parseInt(document.getElementById('st-bidons').value, 10);
    if (!Number.isFinite(bidons) || bidons <= 0) {
      return toastError("Indique un nombre de bidons > 0.");
    }
    // Pre-check overflow cote client (la function refusera aussi server-side).
    const s = stations.find(x => x.id === id);
    if (s && s.stockMax > 0) {
      const stockFinal = (s.stockActuel || 0) + bidons * BIDON_L;
      if (stockFinal > s.stockMax) {
        const placeRestante = Math.max(0, s.stockMax - (s.stockActuel || 0));
        const bidonsMax = Math.floor(placeRestante / BIDON_L);
        await infoModal({
          titre: 'Ravitaillement impossible',
          message: `La station <strong>${escapeHtml(s.nom)}</strong> ne peut pas recevoir <strong>${bidons} bidons</strong> (${num(bidons * BIDON_L)} L).<br><br>
            Stock actuel : <strong>${num(s.stockActuel || 0)} L</strong><br>
            Capacité max : <strong>${num(s.stockMax)} L</strong><br>
            Place restante : <strong>${num(placeRestante)} L</strong> = <strong>${bidonsMax} bidons max</strong>.<br><br>
            Vérifie le nombre que tu viens de mettre. Si tu confirmes avoir mis ${bidons} bidons, contacte la direction.`,
          type: 'danger'
        });
        return;
      }
    }
    try {
      const json = await callFunction('pompisteRavitaillerManuel', { stationId: id, bidons });
      const msg = `Ravitaillement enregistré : ${bidons} bidon${bidons > 1 ? 's' : ''} (+${num(json.litresAjoutes)} L). Stock à ${num(json.stockApres)} L.${json.capped ? ' plafonné capacité max.' : ''}`;
      toastSuccess(msg);
      modal.classList.add('hidden');
      chargerRedistributions();
    } catch (e) {
      console.error('[stations] ravitaillement pompiste FAIL', id, e);
      toastError("Échec : " + (e?.message || e?.code || "erreur inattendue."));
    }
    return;
  }

  // Cas fullEdit : modif silencieuse direction (pas d'alerte)
  // Le tag source 'modal-manuel-direction' override un eventuel tag 'pompiste'
  // anterieur pour eviter que le trigger reste arme.

  // Cas fullEdit : patch complet
  const lirePrix = (sel) => {
    const v = (document.getElementById(sel).value || '').toString().replace(',', '.');
    return Number(v);
  };
  const fivemPompeId = (document.getElementById('st-fivem-pompe').value || '').trim();
  const data = {
    nom: document.getElementById('st-nom').value.trim(),
    stockActuel: Number(document.getElementById('st-stock-actuel').value) || 0,
    stockMax: Number(document.getElementById('st-stock-max').value) || 0,
    seuilAlerte: Number(document.getElementById('st-seuil').value) || 0,
    prixLitre: lirePrix('st-prix') || 0,
    fivemPompeId,
    sourceMajAuto: 'modal-manuel-direction'    // override tag pompiste si present
  };
  if (!data.nom) return toastError("Nom obligatoire.");
  try {
    await setStation(id, data);
    if (fivemPompeId) {
      await setConfig({ fivemPompesMap: { [fivemPompeId]: id } });
    }
    const idx = stations.findIndex(x => x.id === id);
    if (idx >= 0) {
      stations[idx] = { ...stations[idx], ...data };
    } else {
      stations.push({ id, ...data });
    }
    renderStations();
    toastSuccess(`Station "${data.nom}" enregistrée${fivemPompeId ? ` (N°pompe ${fivemPompeId})` : ''}.`);
    modal.classList.add('hidden');
  } catch (e) {
    console.error('[stations] save FAIL', id, e);
    toastError("Échec : " + (e?.message || e?.code || "erreur inattendue. Voir console F12."));
  }
});

const btnDel = document.getElementById('btn-delete-station');
if (btnDel) {
  btnDel.addEventListener('click', async () => {
    const id = document.getElementById('st-id').value;
    if (!id) return;
    const ok = await confirmCritique({
      titre: 'Supprimer cette station',
      message: `La station <strong>${escapeHtml(id)}</strong> sera définitivement retirée du site.<br><br>L'historique de redistributions associé reste consultable mais aucune nouvelle redistribution n'y sera attachée.`,
      btnConfirm: 'Supprimer la station',
      delaiSec: 3,
      requireType: 'SUPPRIMER'
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'stations', id));
      toastSuccess("Station supprimée.");
      modal.classList.add('hidden');
    } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); }
  });
}

// === Modal declaration caoutchoucs (pompiste) ===
// Skip si caoutsActifPage=false : aucun bouton/modal a brancher dans ce cas.
if (stockOnly && caoutsActifPage) {
  const modalCaou = document.getElementById('modal-caoutchoucs');
  const inputCaou = document.getElementById('caou-nb');
  const previewCaou = document.getElementById('caou-preview');
  const quotaC = config.quotaCaoutchoucs ?? 800;

  function ouvrirModalCaou() {
    inputCaou.value = '';
    previewCaou.textContent = `Quota hebdo : ${num(quotaC)} caoutchoucs.`;
    previewCaou.style.color = '';
    modalCaou.classList.remove('hidden');
    setTimeout(() => inputCaou.focus(), 50);
  }
  document.getElementById('btn-declarer-caoutchoucs').addEventListener('click', ouvrirModalCaou);

  // Auto-ouverture si on arrive depuis Mon espace (lien stations.html#caoutchoucs)
  if (location.hash === '#caoutchoucs') {
    setTimeout(ouvrirModalCaou, 100);
  }

  inputCaou.addEventListener('input', () => {
    const n = parseInt(inputCaou.value, 10);
    if (!Number.isFinite(n) || n <= 0) {
      previewCaou.textContent = `Quota hebdo : ${num(quotaC)} caoutchoucs.`;
      previewCaou.style.color = '';
      return;
    }
    if (n > 500) {
      previewCaou.style.color = 'var(--color-blood, #d33)';
      previewCaou.textContent = `Maximum 500 par déclaration. Saisis ${n} en plusieurs fois.`;
      return;
    }
    previewCaou.style.color = '';
    previewCaou.textContent = `+${num(n)} caoutchouc${n > 1 ? 's' : ''} ajoutés à ton quota hebdo (${num(quotaC)} max).`;
  });

  document.getElementById('btn-cancel-caoutchoucs').addEventListener('click', () => {
    modalCaou.classList.add('hidden');
  });

  document.getElementById('btn-save-caoutchoucs').addEventListener('click', async () => {
    const n = parseInt(inputCaou.value, 10);
    if (!Number.isFinite(n) || n <= 0) return toastError("Indique un nombre > 0.");
    if (n > 500) return toastError("Maximum 500 par déclaration.");
    try {
      await callFunction('pompisteDeclarerCaoutchoucs', { caoutchoucs: n });
      toastSuccess(`Déclaration enregistrée : ${n} caoutchouc${n > 1 ? 's' : ''} ajoutés à ton quota.`);
      modalCaou.classList.add('hidden');
    } catch (e) {
      toastError(e?.message || "Erreur inattendue.");
    }
  });
}

// Les quotas hebdo (bidons / caoutchoucs / CA vendeur / fabrication) sont
// centralises sur RH > "Quotas hebdomadaires". Le bouton reglages y redirige.

// === Redistributions de la semaine + Déclarations caoutchoucs ===
const debut = startOfWeekRP();
const fin   = endOfWeekRP();
const canModerer = fullEdit || profile.role === 'responsable-pompiste';

async function chargerRedistributions() {
  const listRaw = await listRedistributionsSemaine(debut, fin).catch(() => []);
  // Cache les redistributions supprimees pour les non-direction. Direction
  // les voit grisees (audit). On filtre ici pour eviter de polluer la table.
  const list = canModerer ? listRaw : listRaw.filter(r => !r.supprimee);
  const div = document.getElementById('redistributions');
  if (list.length === 0) {
    div.innerHTML = `<p class="muted">Aucune redistribution cette semaine (logs Discord à venir).</p>`;
    return;
  }
  div.innerHTML = `
    <table class="data" id="table-redistributions">
      <thead><tr>
        <th data-sort="date">Date</th>
        <th data-sort="source">Source</th>
        <th data-sort="station">Station</th>
        <th data-sort="pompiste">Pompiste</th>
        <th class="right" data-sort="litres">Litres</th>
        <th class="right" data-sort="prix">Prix/L</th>
        <th class="right" data-sort="montant">Montant</th>
        <th class="right" data-sort="stockAvant">Stock avant</th>
        <th class="right" data-sort="stockApres">Stock après</th>
        ${canModerer ? '<th class="center">Actions</th>' : ''}
      </tr></thead>
      <tbody>
        ${list.map(r => {
          const manuel = r.source === 'manuel-pompiste';
          const supprimee = r.supprimee === true;
          const modifie = r.modifiePar != null;
          const sourceLabel = manuel
            ? `<span class="badge" style="background:rgba(255,180,0,0.15);color:var(--color-gold);">manuel</span>`
            : `<span class="muted" style="font-size:0.8rem;">FiveM</span>`;
          const pompiste = manuel
            ? escapeHtml(r.pompisteNom || '—')
            : '<span class="muted">—</span>';
          const litresStr = manuel && r.bidons
            ? `${num(r.litres)} <span class="muted" style="font-size:0.75rem;">(${r.bidons} bidon${r.bidons > 1 ? 's' : ''})</span>`
            : num(r.litres);
          const flag = supprimee
            ? '<span class="badge danger" style="font-size:0.7rem;">supprimée</span>'
            : (modifie ? '<span class="badge warn" style="font-size:0.7rem;" title="Modifiée">modifiée</span>' : '');
          let actions = '';
          if (canModerer && manuel && !supprimee) {
            actions = `<div style="display:flex;gap:4px;justify-content:center;">
              <button class="btn btn-sm" data-edit-ravit="${r.id}" title="Modifier le nb de bidons">Modifier</button>
              <button class="btn btn-sm btn-danger" data-del-ravit="${r.id}" title="Supprimer (reverse stock + quota)">Suppr.</button>
            </div>`;
          } else if (canModerer && supprimee) {
            actions = `<span class="muted" style="font-size:0.72rem;" title="Supprimée par ${escapeHtml(r.supprimeeParNom || '?')} — ${escapeHtml(r.raisonSuppression || '')}">supprimée</span>`;
          }
          return `
            <tr style="${supprimee ? 'opacity:0.4;text-decoration:line-through;' : ''}">
              <td>${datetime(r.timestamp)} ${flag}</td>
              <td>${sourceLabel}</td>
              <td>${escapeHtml(r.station || r.stationId || '—')}</td>
              <td>${pompiste}</td>
              <td class="right mono">${litresStr}</td>
              <td class="right mono">${moneyPrecis(r.prixLitre)}</td>
              <td class="right mono">${money(r.montant)}</td>
              <td class="right mono muted">${r.stockAvant != null ? num(r.stockAvant) + ' L' : '—'}</td>
              <td class="right mono">${r.stockApres != null ? num(r.stockApres) + ' L' : '—'}</td>
              ${canModerer ? `<td class="center">${actions}</td>` : ''}
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  const tRedis = document.getElementById('table-redistributions');
  wrapScroll(tRedis, 400);
  makeSortable(tRedis);

  if (canModerer) {
    div.querySelectorAll('[data-edit-ravit]').forEach(b => {
      b.addEventListener('click', () => ouvrirEditRavit(b.dataset.editRavit, list));
    });
    div.querySelectorAll('[data-del-ravit]').forEach(b => {
      b.addEventListener('click', () => onDeleteRavit(b.dataset.delRavit, list));
    });
  }
}
chargerRedistributions();


// === Declarations caoutchoucs de la semaine (resp-pompiste + direction) ===
async function chargerCaoutchoucs() {
  if (!canModerer) return;
  const div = document.getElementById('declarations-caoutchoucs');
  if (!div) return;
  const q = query(collection(db, 'declarationsCaoutchouc'),
    where('timestamp', '>=', Timestamp.fromDate(debut)),
    where('timestamp', '<=', Timestamp.fromDate(fin)),
    orderBy('timestamp', 'desc'));
  let listRaw;
  try { const snap = await getDocs(q); listRaw = snap.docs.map(d => ({ id: d.id, ...d.data() })); }
  catch (e) { console.error('[caoutchoucs] load failed', e); listRaw = []; }
  if (listRaw.length === 0) {
    div.innerHTML = `<p class="muted">Aucune déclaration caoutchoucs cette semaine.</p>`;
    return;
  }
  div.innerHTML = `
    <table class="data" id="table-caoutchoucs">
      <thead><tr>
        <th data-sort="date">Date</th>
        <th data-sort="pompiste">Pompiste</th>
        <th class="right" data-sort="caoutchoucs">Caoutchoucs</th>
        <th class="center">Actions</th>
      </tr></thead>
      <tbody>
        ${listRaw.map(d => {
          const supprimee = d.supprimee === true;
          const modifie = d.modifiePar != null;
          const flag = supprimee
            ? '<span class="badge danger" style="font-size:0.7rem;">supprimée</span>'
            : (modifie ? '<span class="badge warn" style="font-size:0.7rem;" title="Modifiée">modifiée</span>' : '');
          let actions = '';
          if (!supprimee) {
            actions = `<div style="display:flex;gap:4px;justify-content:center;">
              <button class="btn btn-sm" data-edit-caou="${d.id}" title="Modifier">Modifier</button>
              <button class="btn btn-sm btn-danger" data-del-caou="${d.id}" title="Supprimer">Suppr.</button>
            </div>`;
          } else {
            actions = `<span class="muted" style="font-size:0.72rem;" title="Supprimée par ${escapeHtml(d.supprimeeParNom || '?')} — ${escapeHtml(d.raisonSuppression || '')}">supprimée</span>`;
          }
          return `
            <tr style="${supprimee ? 'opacity:0.4;text-decoration:line-through;' : ''}">
              <td>${datetime(d.timestamp)} ${flag}</td>
              <td>${escapeHtml(d.pompisteNom || '?')}</td>
              <td class="right mono">${num(d.caoutchoucs || 0)}</td>
              <td class="center">${actions}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  const t = document.getElementById('table-caoutchoucs');
  wrapScroll(t, 400);
  makeSortable(t);

  div.querySelectorAll('[data-edit-caou]').forEach(b => {
    b.addEventListener('click', () => ouvrirEditCaou(b.dataset.editCaou, listRaw));
  });
  div.querySelectorAll('[data-del-caou]').forEach(b => {
    b.addEventListener('click', () => onDeleteCaou(b.dataset.delCaou, listRaw));
  });
}
chargerCaoutchoucs();

// === Modal edition (ravitaillement ou caoutchoucs) ===
let editCtx = null; // { type:'ravit'|'caou', id, original }
function ouvrirEditRavit(id, list) {
  const r = list.find(x => x.id === id);
  if (!r) return;
  editCtx = { type: 'ravit', id, original: r };
  document.getElementById('edit-decl-title').textContent = `Modifier ravitaillement`;
  document.getElementById('edit-decl-info').innerHTML =
    `<strong>${escapeHtml(r.pompisteNom || '?')}</strong> · ${escapeHtml(r.station || r.stationId)}<br>Valeur actuelle : <strong>${r.bidons || '?'} bidon(s)</strong> = ${num(r.litres || 0)} L`;
  document.getElementById('edit-decl-label').textContent = 'Nouvelle valeur en bidons (1 bidon = 15 L)';
  const input = document.getElementById('edit-decl-input');
  input.value = r.bidons || '';
  input.min = '1'; input.step = '1';
  refreshEditPreview();
  document.getElementById('modal-edit-decl').classList.remove('hidden');
}
function ouvrirEditCaou(id, list) {
  const d = list.find(x => x.id === id);
  if (!d) return;
  editCtx = { type: 'caou', id, original: d };
  document.getElementById('edit-decl-title').textContent = `Modifier déclaration caoutchoucs`;
  document.getElementById('edit-decl-info').innerHTML =
    `<strong>${escapeHtml(d.pompisteNom || '?')}</strong><br>Valeur actuelle : <strong>${d.caoutchoucs || 0} caoutchoucs</strong>`;
  document.getElementById('edit-decl-label').textContent = 'Nouvelle valeur en caoutchoucs';
  const input = document.getElementById('edit-decl-input');
  input.value = d.caoutchoucs || '';
  input.min = '1'; input.step = '1';
  refreshEditPreview();
  document.getElementById('modal-edit-decl').classList.remove('hidden');
}
function refreshEditPreview() {
  if (!editCtx) return;
  const n = parseInt(document.getElementById('edit-decl-input').value, 10);
  const p = document.getElementById('edit-decl-preview');
  if (!Number.isFinite(n) || n <= 0) { p.textContent = '—'; return; }
  if (editCtx.type === 'ravit') {
    const original = editCtx.original;
    const diffBidons = n - (original.bidons || 0);
    const diffLitres = diffBidons * 15;
    p.innerHTML = `${n} bidon(s) = ${num(n * 15)} L · diff : ${diffBidons >= 0 ? '+' : ''}${diffBidons} bidons (${diffLitres >= 0 ? '+' : ''}${num(diffLitres)} L sur le stock station)`;
  } else {
    const diff = n - (editCtx.original.caoutchoucs || 0);
    p.innerHTML = `${n} caoutchoucs · diff : ${diff >= 0 ? '+' : ''}${diff} sur le quota pompiste`;
  }
}
if (canModerer) {
  const editInput = document.getElementById('edit-decl-input');
  if (editInput) editInput.addEventListener('input', refreshEditPreview);
  const cancelBtn = document.getElementById('btn-edit-decl-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    document.getElementById('modal-edit-decl').classList.add('hidden');
    editCtx = null;
  });
  const saveBtn = document.getElementById('btn-edit-decl-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (!editCtx) return;
    const n = parseInt(document.getElementById('edit-decl-input').value, 10);
    if (!Number.isFinite(n) || n <= 0) return toastError('Valeur invalide.');
    saveBtn.disabled = true; saveBtn.textContent = 'Envoi…';
    try {
      const fnName = editCtx.type === 'ravit' ? 'modifierRavitaillement' : 'modifierDeclarationCaoutchoucs';
      const body = editCtx.type === 'ravit'
        ? { redistributionId: editCtx.id, nouveauxBidons: n }
        : { declarationId: editCtx.id, nouveauxCaoutchoucs: n };
      await callFunction(fnName, body);
      toastSuccess(`Déclaration modifiée (stock et quota mis à jour automatiquement).`);
      document.getElementById('modal-edit-decl').classList.add('hidden');
      editCtx = null;
      chargerRedistributions();
      chargerCaoutchoucs();
      chargerPilotagePompistes();
    } catch (e) {
      toastError('Échec : ' + (e?.message || 'erreur inattendue.'));
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer';
    }
  });
}

async function onDeleteRavit(id, list) {
  const r = list.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmCritique({
    titre: 'Supprimer ce ravitaillement',
    message: `<strong>${escapeHtml(r.pompisteNom || '?')}</strong> · ${escapeHtml(r.station || r.stationId)}<br>
      ${r.bidons || '?'} bidon(s) = ${num(r.litres || 0)} L<br><br>
      La suppression va <strong>retirer ${num(r.litres || 0)} L du stock de la station</strong> et <strong>retirer ${r.bidons || 0} bidons du quota du pompiste</strong>. Une raison obligatoire sera demandée.`,
    btnConfirm: 'Continuer',
    delaiSec: 2
  });
  if (!ok) return;
  const raison = prompt('Raison de la suppression (min 3 caractères) :');
  if (!raison || raison.trim().length < 3) return toastError('Raison obligatoire.');
  try {
    await callFunction('supprimerRavitaillement', { redistributionId: id, raison: raison.trim() });
    toastSuccess(`Ravitaillement supprimé (stock et quota corrigés).`);
    chargerRedistributions();
    chargerPilotagePompistes();
  } catch (e) {
    toastError('Échec : ' + (e?.message || 'erreur inattendue.'));
  }
}

async function onDeleteCaou(id, list) {
  const d = list.find(x => x.id === id);
  if (!d) return;
  const ok = await confirmCritique({
    titre: 'Supprimer cette déclaration caoutchoucs',
    message: `<strong>${escapeHtml(d.pompisteNom || '?')}</strong><br>
      ${d.caoutchoucs || 0} caoutchoucs<br><br>
      La suppression va <strong>retirer ${d.caoutchoucs || 0} caoutchoucs du quota du pompiste</strong>. Raison obligatoire.`,
    btnConfirm: 'Continuer',
    delaiSec: 2
  });
  if (!ok) return;
  const raison = prompt('Raison de la suppression (min 3 caractères) :');
  if (!raison || raison.trim().length < 3) return toastError('Raison obligatoire.');
  try {
    await callFunction('supprimerDeclarationCaoutchoucs', { declarationId: id, raison: raison.trim() });
    toastSuccess(`Déclaration caoutchoucs supprimée (quota corrigé).`);
    chargerCaoutchoucs();
    chargerPilotagePompistes();
  } catch (e) {
    toastError('Échec : ' + (e?.message || 'erreur inattendue.'));
  }
}
