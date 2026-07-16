// ============================================================
// Page : Mon espace (Dashboard employé) — lecture seule
// ============================================================

import { requireAuth, getCurrentUser } from '../auth.js';
import { renderShell } from '../layout.js';
import {
  listVentesSemaine, listVentesSemaineIncluantCachees, listServicesSemaine, listAllServicesEmploye,
  getServiceOuvert, getQuotaPompiste, getQuotaVendeur, getConfig, listenConfig, listenAvertissements,
  getUserDoc, listUsers, listenStations, listRedistributionsSemaine, listAllRedistributionsPompiste,
  listRedistributionsRangeManuel, listAllRedistributionsManuel,
  listenMesNotesFrais, callFunction, logSite
} from '../api.js';
import { ROLE_LABELS, isVendeur, isLivreur, isPompiste, isPompisteRavitailleur, isVendeurDeclarateur,
         isDirection, isSuperAdmin, PLAFOND_SALAIRE,
         QUOTA_CA_VENDEUR_DEFAULT, PLAFOND_CA_VENDEUR,
         BONUS_QUOTA_VENDEUR_MAX, PRODUITS_QUOTA_FAB,
         partVariableVente, LIVREUR_FIXE, LIVREUR_VENTE_VAR_MAX } from '../utils/permissions.js';
import { salaireVendeur, salaireLivreur, salairePompiste, scorePompiste, scoreQuotaFabrication,
         fabricationsFromQuotaDoc } from '../utils/paie.js';
import { nomProduit } from '../data/produits.js';
import { money, moneyPrecis, num, pct, datetime, escapeHtml,
         startOfWeekRP, endOfWeekRP, weekId, durationHM } from '../utils/formatters.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';
import { ouvrirModalNouvelleVente } from '../utils/vente-modal.js';
import { initSemaineSelector } from '../utils/semaine-selector.js';
import { toastSuccess, toastError } from '../utils/toast.js';

const { profile: callerProfile } = await requireAuth('employee');

// === Mode "Voir l'espace de X" : direction/DRH/admin-technique peut consulter
// l'espace personnel de n'importe quel employe (lecture seule) via ?asUser=UID
// Pour debugger ou verifier ce qu'un employe voit en cas de probleme.
// On utilise roleReel pour bypass le mode "Voir le site comme..." (preexistant
// qui peut modifier callerProfile.role si l'admin teste un autre role).
const urlParams = new URLSearchParams(location.search);
const asUserId = urlParams.get('asUser');
const callerRoleReel = callerProfile.roleReel || callerProfile.role;
const canVoirComme = (r) => isDirection(r) || isSuperAdmin(r) || r === 'drh';

let profile = callerProfile;
let viewedUserId = getCurrentUser().uid;
let modeVoirComme = false;

if (asUserId && asUserId !== viewedUserId && canVoirComme(callerRoleReel)) {
  try {
    const target = await getUserDoc(asUserId);
    if (target) {
      profile = target;
      viewedUserId = asUserId;
      modeVoirComme = true;
    } else {
      console.warn('[employee] asUser=', asUserId, 'introuvable');
    }
  } catch (e) {
    console.error('[employee] erreur chargement profil cible:', e);
  }
}
const debut = startOfWeekRP();
const fin   = endOfWeekRP();
const wId   = weekId();

// Charge config en avance pour pouvoir conditionner le rendu HTML
// (boutons "Declarer caoutchoucs" grises si quota=0, etc.)
const config = await getConfig().catch(() => ({}));
const quotaCaoutchoucsActif = (config.quotaCaoutchoucs ?? 800) > 0;
const quotaBidonsActif      = (config.quotaBidons      ?? 1700) > 0;
const quotaFabrication = config.quotaFabrication || {};

// Listener temps-reel : si la direction modifie un quota, les tablettes
// in-game (pas de F5) reloadent automatiquement pour refleter la nouvelle
// valeur dans tous les KPI/boutons/formules. On compare une signature des
// champs critiques pour ignorer les writes sans effet sur l'affichage.
const _cfgSig = JSON.stringify({
  qB: config.quotaBidons,
  qC: config.quotaCaoutchoucs,
  qCA: config.quotaCAVendeur,
  qF: config.quotaFabrication || null,
  pE: config.prixEssence
});
listenConfig((newCfg) => {
  const sig = JSON.stringify({
    qB: newCfg.quotaBidons,
    qC: newCfg.quotaCaoutchoucs,
    qCA: newCfg.quotaCAVendeur,
    qF: newCfg.quotaFabrication || null,
    pE: newCfg.prixEssence
  });
  if (sig !== _cfgSig) {
    console.log('[employee] config changee live -> reload');
    window.location.reload();
  }
});

const html = `
  ${modeVoirComme ? `
    <div class="alert" style="background:rgba(70,130,200,0.18);border:2px solid #4a90e2;margin-bottom:12px;font-size:0.95rem;">
      <strong>Mode débug</strong> — Tu consultes l'espace personnel de
      <strong>${escapeHtml(profile.prenom)} ${escapeHtml(profile.nom)}</strong>
      (${ROLE_LABELS[profile.role] || profile.role}).
      Données en temps réel. <strong>Lecture seule</strong> — aucune action n'est possible depuis cette vue.
      <a href="rh.html" style="margin-left:10px;color:var(--color-bone);text-decoration:underline;">← Retour aux RH</a>
    </div>
  ` : ''}

  <div class="panel framed mb-3" style="text-align:center;">
    <h2 style="margin:0;">${modeVoirComme ? 'Espace de' : 'Salut'} <span style="color:var(--color-blood-light);">${escapeHtml(profile.prenom)}${modeVoirComme ? ' ' + escapeHtml(profile.nom) : ''}</span>${modeVoirComme ? '' : ' !'}</h2>
    <div class="muted" style="margin-top:6px;">
      ${ROLE_LABELS[profile.role]} · Semaine du ${debut.toLocaleDateString('fr-FR')} au ${fin.toLocaleDateString('fr-FR')}
      ${!modeVoirComme ? ' · <a href="tuto.html" style="color:var(--color-sand-light);text-decoration:underline;">Revoir le tutoriel</a>' : ''}
    </div>
    ${!modeVoirComme ? `
      <div class="row center mt-3" style="gap:10px;justify-content:center;flex-wrap:wrap;">
        ${isVendeurDeclarateur(profile.role)
          ? '<button class="btn btn-primary" id="btn-declarer-vente" style="font-size:1.05rem;">Déclarer une vente</button>'
          : ''}
        ${isLivreur(profile.role)
          ? '<a class="btn btn-primary" href="livraisons.html" style="font-size:1.05rem;">Déclarer une livraison</a>'
          : ''}
        ${isPompisteRavitailleur(profile.role)
          ? `${quotaBidonsActif
              ? '<button class="btn btn-primary" id="btn-ravitailler" style="font-size:1.05rem;">Ravitailler une station</button>'
              : '<button class="btn" disabled style="font-size:1.05rem;opacity:0.5;cursor:not-allowed;" title="Bidons désactivés cette semaine (quota = 0)">Ravitailler — désactivé cette semaine</button>'}
             ${quotaCaoutchoucsActif
              ? '<a class="btn btn-primary" href="stations.html#caoutchoucs" style="font-size:1.05rem;">Déclarer des caoutchoucs</a>'
              : '<button class="btn" disabled style="font-size:1.05rem;opacity:0.5;cursor:not-allowed;" title="Caoutchoucs non requis cette semaine (quota = 0)">Caoutchoucs — non requis cette semaine</button>'}
             <button class="btn" id="btn-corriger-stock" style="font-size:0.9rem;" title="Corriger le stock d'une station si écart entre site et IG">Corriger un stock</button>
             <button class="btn" id="btn-note-frais" style="font-size:0.9rem;background:rgba(70,180,90,0.18);border:1px solid #5a8;" title="Déclarer une avance d'essence pour véhicule LTD">Note de frais essence</button>`
          : ''}
      </div>
    ` : ''}
  </div>

  <!-- Modaux pompiste/resp-pompiste — DOIVENT etre hors du .panel parent car
       .panel a backdrop-filter, ce qui contraint position:fixed des enfants au
       panel au lieu du viewport (modal apparait clipped sur les KPI sinon). -->
  ${(!modeVoirComme && isPompisteRavitailleur(profile.role)) ? `
    <div id="modal-ravit" class="modal-backdrop hidden">
      <div class="modal" style="max-width:540px;">
        <h3>Ravitailler une station</h3>
        <div class="alert info mb-2" style="font-size:0.82rem;">
          <span>Choisis la station que tu viens de ravitailler et saisis le <strong>nombre de bidons ajoutés</strong>.
          La conversion en litres (1 bidon = 15 L) est automatique.</span>
        </div>
        <label>Station <span style="color:var(--color-blood-light);">*</span></label>
        <select id="ravit-station" style="width:100%;">
          <option value="">— Sélectionne une station —</option>
        </select>
        <div id="ravit-station-info" class="muted" style="font-size:0.78rem;margin:4px 0 8px;"></div>

        <label>Nombre de bidons ajoutés <span style="color:var(--color-blood-light);">*</span> <span class="muted" style="font-size:0.75rem;">— 1 bidon = 15 L</span></label>
        <input type="number" id="ravit-bidons" min="1" step="1" placeholder="Ex : 5" />
        <div id="ravit-preview" class="muted" style="font-size:0.78rem;margin:4px 0 0;">—</div>

        <div class="row mt-3">
          <button class="btn btn-primary" id="btn-save-ravit">Valider le ravitaillement</button>
          <button class="btn btn-ghost" id="btn-cancel-ravit">Annuler</button>
        </div>
      </div>
    </div>

    <div id="modal-correc" class="modal-backdrop hidden">
      <div class="modal" style="max-width:540px;">
        <h3>Corriger le stock d'une station</h3>
        <div class="alert warn mb-2" style="font-size:0.82rem;">
          <span>À utiliser <strong>uniquement</strong> en cas d'écart entre le stock affiché sur le site
          et le stock réel in-game. Une <strong>alerte est envoyée à la direction</strong> à chaque
          correction (audit obligatoire).</span>
        </div>
        <label>Station <span style="color:var(--color-blood-light);">*</span></label>
        <select id="correc-station" style="width:100%;">
          <option value="">— Sélectionne une station —</option>
        </select>
        <div id="correc-station-info" class="muted" style="font-size:0.78rem;margin:4px 0 8px;"></div>

        <label>Stock réel relevé à la pompe (L) <span style="color:var(--color-blood-light);">*</span></label>
        <input type="number" id="correc-litres" min="0" step="1" placeholder="Saisis la vraie valeur (ex : 2127)" />
        <div id="correc-preview" class="muted" style="font-size:0.78rem;margin:4px 0 8px;">—</div>

        <label>Raison de la correction <span style="color:var(--color-blood-light);">*</span></label>
        <input type="text" id="correc-raison" maxlength="200" placeholder="Ex : écart 2000 L IG vs site, j'ai vérifié à la pompe" />
        <div class="muted" style="font-size:0.72rem;margin:2px 0 0;">Min 5 caractères. Sera visible par la direction dans l'alerte.</div>

        <div class="row mt-3">
          <button class="btn btn-primary" id="btn-save-correc">Valider la correction</button>
          <button class="btn btn-ghost" id="btn-cancel-correc">Annuler</button>
        </div>
      </div>
    </div>

    <div id="modal-note-frais" class="modal-backdrop hidden">
      <div class="modal" style="max-width:540px;">
        <h3>Déclarer une note de frais essence</h3>
        <div class="alert info mb-2" style="font-size:0.82rem;">
          <span>Tu as avancé de ta poche l'essence d'un véhicule LTD ?
          <strong>Procédure</strong> :<br>
          1. Mets l'essence dans le véhicule en jeu<br>
          2. Prends un screenshot (touche Impr écran / F12 / etc.)<br>
          3. Reviens ici → clique dans la zone ci-dessous et fais <strong>Ctrl+V</strong> pour coller<br>
          4. Saisis le montant → le patron valide et te rembourse en fin de semaine.</span>
        </div>
        <label>Montant avancé ($) <span style="color:var(--color-blood-light);">*</span></label>
        <input type="number" id="nf-montant" min="1" step="1" placeholder="Ex : 1200" />

        <label>Screenshot de la confirmation IG <span style="color:var(--color-blood-light);">*</span></label>
        <div id="nf-paste-zone" tabindex="0" style="border:2px dashed var(--color-bone-dark, #666);border-radius:6px;padding:24px;text-align:center;cursor:pointer;background:rgba(0,0,0,0.18);min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;outline:none;">
          <div style="margin-top:6px;"><strong>Clique ici puis Ctrl+V</strong> pour coller le screenshot</div>
          <div class="muted" style="font-size:0.75rem;margin-top:4px;">Image redimensionnée auto (max 1600px, qualité 75%)</div>
        </div>
        <div id="nf-preview-zone" class="hidden" style="margin-top:8px;text-align:center;">
          <img id="nf-preview-img" alt="Preview" style="max-width:100%;max-height:280px;border:1px solid var(--color-bone-dark,#444);border-radius:4px;" />
          <div class="muted mt-1" id="nf-preview-meta" style="font-size:0.75rem;">—</div>
          <button class="btn btn-sm btn-ghost mt-1" id="nf-clear-img">Retirer / recoller un autre</button>
        </div>

        <label>Description / contexte <span class="muted" style="font-size:0.75rem;">— optionnel</span></label>
        <textarea id="nf-desc" rows="2" maxlength="500" placeholder="Ex : essence Bison patron + Sandking"></textarea>

        <div class="row mt-3">
          <button class="btn btn-primary" id="btn-save-note-frais">Envoyer la note</button>
          <button class="btn btn-ghost" id="btn-cancel-note-frais">Annuler</button>
        </div>
      </div>
    </div>
  ` : ''}

  <!-- Bloc ventes IG non declarees (vendeurs uniquement) — affiche apres
       5 min sans declaration. La cloche direction reste alimentee. -->
  <div id="bloc-non-declarees"></div>

  <div class="kpi-grid" id="kpis-emp">
    <div class="kpi"><div class="label">Chargement…</div><div class="value">—</div></div>
  </div>

  <div id="bloc-averts"></div>

  <div class="panel framed" id="panel-detail">
    <div class="panel-title">
      <span id="detail-titre">Détail de ta semaine</span>
      <span style="display:flex;gap:8px;align-items:center;">
        <span id="detail-badge" class="muted" style="font-size:0.82rem;"></span>
        <select id="selecteur-semaine" title="Choisir la semaine" style="min-width:240px;"></select>
      </span>
    </div>
    <div id="detail">Chargement…</div>
  </div>

  <div class="panel">
    <div class="panel-title"><span>${isPompisteRavitailleur(profile.role) ? 'Ravitaillements' : 'Heures de service'}</span></div>
    <div id="services">—</div>
  </div>

  ${isPompisteRavitailleur(profile.role) ? `
    <div class="panel">
      <div class="panel-title"><span>Mes notes de frais essence</span></div>
      <div id="notes-frais-perso">Chargement…</div>
    </div>
  ` : ''}

  <p class="muted text-center mt-3" style="font-size:0.78rem;">
    Données mises à jour en continu via les logs Discord.<br>
    Compteurs remis à zéro à la clôture (lundi 00 h 00, juste après dimanche 23 h 59).
  </p>
`;
renderShell(profile, 'employee', html);
// Note : le portail .modal-backdrop -> document.body est applique
// generiquement dans renderShell (cf. layout.js) depuis v1.13.5.

const me = getCurrentUser(); // utilisateur connecte (toujours soi-meme, jamais l'employe vise)

// === Donnees fixes (semaine en cours + cumul historique) ===
// Ces requetes restent sur la semaine courante car elles alimentent les blocs
// "Ventes IG non declarees", "Heures de service"/"Ravitaillements" et le service en cours.
// Pompistes : on charge en plus les redistributions (semaine + cumul) pour
// remplacer les KPI heures par des KPI litres ravitailles.
const [ventesAvecCacheesCurr, allServicesCurr, allMyServices, serviceOuvert,
       redistSemaineAll, redistCumul] = await Promise.all([
  listVentesSemaineIncluantCachees(debut, fin).catch(() => []),
  listServicesSemaine(debut, fin).catch(() => []),
  listAllServicesEmploye(viewedUserId).catch(e => { console.error('[employee] listAllServicesEmploye', e); return []; }),
  getServiceOuvert(viewedUserId).catch(() => null),
  isPompisteRavitailleur(profile.role) ? listRedistributionsSemaine(debut, fin).catch(() => []) : Promise.resolve([]),
  isPompisteRavitailleur(profile.role) ? listAllRedistributionsPompiste(viewedUserId).catch(() => []) : Promise.resolve([])
]);

// Filtre ravitaillements pompiste : source manuelle + matchant l'employe vise.
// On utilise litres (pas bidons) pour le KPI car c'est plus parlant (carburant
// effectivement vendu/redistribue).
const myRedistSemaine = redistSemaineAll.filter(r => r.pompisteId === viewedUserId && r.source === 'manuel-pompiste');
const myRedistCumul   = redistCumul.filter(r => r.source === 'manuel-pompiste');

// === Ventes IG (bot Discord) non encore declarees par l'employe ===
// Filtre :
//  - vendeur=moi
//  - source != manuelle (= vente bot in-game)
//  - non cachee
//  - PAS modifiee par admin (modifiePar absent) — sinon admin a deja regularise
//  - age entre 5 min et 24h : on laisse 5 min de battement avant d'alerter
//    (le vendeur peut declarer juste apres la facture in-game sans message)
const il_y_a_24h  = Date.now() - 24 * 3600 * 1000;
const il_y_a_5min = Date.now() - 5 * 60 * 1000;
const nonDeclarees = ventesAvecCacheesCurr.filter(v => {
  const ts = v.timestamp?.toMillis?.() || 0;
  return v.vendeurId === viewedUserId &&
         v.source !== 'manuelle' &&
         !v.cachee &&
         !v.modifiePar &&
         ts >= il_y_a_24h &&
         ts <= il_y_a_5min;
}).sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));

function renderNonDeclarees() {
  const bloc = document.getElementById('bloc-non-declarees');
  // isVendeurDeclarateur : vendeurs + responsable-vente + chef-equipe + livreur.
  // Tous ceux qui peuvent declarer une vente doivent voir l'alerte des factures
  // bot en attente (sinon ils oublient de declarer -> CA/commission non comptes).
  if (!isVendeurDeclarateur(profile.role) || nonDeclarees.length === 0) {
    bloc.innerHTML = '';
    return;
  }
  bloc.innerHTML = `
    <div class="panel framed mb-2" style="border-color:var(--color-warning, #f0a020);">
      <div class="panel-title">
        <span>${nonDeclarees.length} vente${nonDeclarees.length > 1 ? 's' : ''} in-game à déclarer</span>
        <span class="muted" style="font-size:0.78rem;">— moins de 24h</span>
      </div>
      <p class="muted" style="font-size:0.82rem;margin:0 0 8px;">
        Le bot Discord a remonté ${nonDeclarees.length > 1 ? 'ces factures' : 'cette facture'} mais tu n'as pas encore déclaré le détail des produits. <strong>Déclare maintenant</strong> pour que ta commission soit calculée correctement.
      </p>
      <table class="data" style="font-size:0.85rem;">
        <thead><tr>
          <th>Date</th>
          <th>#Facture</th>
          <th>Client</th>
          <th class="right">Montant</th>
          <th>Détail (raison)</th>
          <th class="center">Action</th>
        </tr></thead>
        <tbody>
          ${nonDeclarees.map(v => {
            const ts = v.timestamp?.toDate?.();
            const dt = ts ? ts.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '?';
            return `
              <tr>
                <td class="mono" style="font-size:0.78rem;">${dt}</td>
                <td class="mono">#${escapeHtml(String(v.factureId || ''))}</td>
                <td>${escapeHtml(v.client || '—')}</td>
                <td class="right mono"><strong>${money(v.montant || 0)}</strong></td>
                <td class="muted" style="font-size:0.78rem;">${escapeHtml((v.raison || '').slice(0, 50))}</td>
                <td class="center">
                  ${modeVoirComme
                    ? '<span class="muted" style="font-size:0.78rem;">— vue admin —</span>'
                    : `<button class="btn btn-primary btn-sm" data-declarer-bot="${v.id}">Déclarer</button>`}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  bloc.querySelectorAll('[data-declarer-bot]').forEach(btn => {
    btn.addEventListener('click', () => {
      ouvrirModalNouvelleVente({
        role: profile.role,
        factureBotIdPreset: btn.dataset.declarerBot,
        onSuccess: () => window.location.reload()
      });
    });
  });
}
renderNonDeclarees();

// === Heures de service : 3 KPIs (jour / semaine / cumul depuis embauche) ===
// Toujours sur la semaine COURANTE — independant du selecteur (qui pilote
// uniquement le panel "Detail de ta semaine"). Le service en cours est un
// concept "live" qui n'a de sens que pour la semaine en cours.
const myServicesCurr = allServicesCurr.filter(s => s.employeId === viewedUserId);
const debutOuvert = serviceOuvert?.debut?.toDate?.() || null;
const dureeOuvertMs = debutOuvert ? Math.max(0, Date.now() - debutOuvert.getTime()) : 0;

const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

const heuresMs = myServicesCurr.reduce((s, x) => s + (x.duree || 0), 0)
  + (debutOuvert && debutOuvert >= debut ? dureeOuvertMs : 0);
const cumulMs = allMyServices.reduce((s, x) => s + (x.duree || 0), 0)
  + dureeOuvertMs;
const heuresJourMs = allMyServices.reduce((s, x) => {
  const d = x.debut?.toDate?.();
  return d && d >= startOfDay ? s + (x.duree || 0) : s;
}, 0) + (debutOuvert && debutOuvert >= startOfDay ? dureeOuvertMs : 0);

const plafondSalaire = PLAFOND_SALAIRE[profile.role] || 0;

// ============================================================
// Detail de la semaine — pilote par le selecteur semaine
// ============================================================
// On factorise le rendu pour pouvoir le rappeler quand l'utilisateur
// change de semaine dans le selecteur.

async function chargerEtRendreDetail({ debut: sDebut, fin: sFin, isCurrent, weekKey, statutLabel }) {
  // Met a jour le titre + badge du panel
  const titre = isCurrent ? 'Détail de ta semaine' : 'Détail de la semaine';
  const fmt = d => d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
  document.getElementById('detail-titre').textContent =
    `${titre} (du ${fmt(sDebut)} au ${fmt(sFin)})`;
  document.getElementById('detail-badge').innerHTML = isCurrent
    ? ''
    : `<span class="badge ok">${escapeHtml(statutLabel)}</span>`;

  // Affiche un loading
  document.getElementById('detail').innerHTML = '<p class="muted">Chargement…</p>';

  // Pour le quota pompiste : on utilise le weekId (YYYY-MM-DD du lundi).
  // - semaine en cours : wId calcule plus haut
  // - semaine cloturee : weekKey du selecteur (= id du doc /semaines)
  const wIdCible = isCurrent ? wId : weekKey;

  const [allVentes, allServices, quota, quotaV] = await Promise.all([
    listVentesSemaine(sDebut, sFin).catch(() => []),
    listServicesSemaine(sDebut, sFin).catch(() => []),
    getQuotaPompiste(viewedUserId, wIdCible).catch(() => ({ bidons: 0, caoutchoucs: 0 })),
    getQuotaVendeur(viewedUserId, wIdCible).catch(() => ({}))
  ]);

  const myVentes = allVentes.filter(v => v.vendeurId === viewedUserId);

  if (isVendeur(profile.role)) {
    renderVendeur(myVentes, quotaV, isCurrent);
  } else if (isLivreur(profile.role)) {
    renderLivreur(myVentes, isCurrent);
  } else if (isPompiste(profile.role)) {
    renderPompiste(quota, isCurrent);
  } else {
    renderAutre(myVentes, quota, sDebut, sFin, isCurrent);
  }
}

function renderVendeur(myVentes, quotaV, isCurrent) {
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente'; // don/subvention hors CA & hors commission
  const ca = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montant || 0) : 0), 0);
  const caParticulier = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0);
  const caPro = ca - caParticulier;

  // Fabrications de la semaine (cumul par produit) + score quota
  const fabrications = fabricationsFromQuotaDoc(quotaV);
  const scoreFab = scoreQuotaFabrication(fabrications, quotaFabrication);
  const bonusFab = Math.round(scoreFab * BONUS_QUOTA_VENDEUR_MAX);
  // Cible CA hebdo (panel RH > Quotas hebdo). Fallback sur le defaut courant.
  const quotaCA = Number(config.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);
  const salaireEst = salaireVendeur(profile.role, caParticulier, fabrications, quotaFabrication, quotaCA);

  // Part CA pure (pour afficher la decomposition au vendeur)
  const plafondCAVendeur = PLAFOND_CA_VENDEUR[profile.role] || 0;
  const salaireCAPart = Math.round(
    (quotaCA > 0 ? Math.min(1, caParticulier / quotaCA) : 0) * plafondCAVendeur
  );

  // Plafond CA et barres = quotaCAVendeur courant
  const plafondCAAffiche = quotaCA;
  const progressionCA = plafondCAAffiche > 0 ? Math.min(100, (caParticulier / plafondCAAffiche) * 100) : 0;
  const pctQuotaCA = quotaCA > 0 ? Math.min(100, (caParticulier / quotaCA) * 100) : 0;

  const produitsActifs = PRODUITS_QUOTA_FAB.filter(id => Number(quotaFabrication[id] || 0) > 0);

  document.getElementById('kpis-emp').innerHTML = `
    <div class="kpi"><div class="label">${isCurrent ? 'Ton CA' : 'CA de la semaine'}</div><div class="value">${money(ca)}</div><div class="delta">${myVentes.length} ventes${caPro > 0 ? ` · ${money(caPro)} hors commission` : ''}</div></div>
    <div class="kpi"><div class="label">CA commissionnable</div><div class="value">${money(caParticulier)}</div><div class="delta">base du salaire CA</div></div>
    ${produitsActifs.length > 0
      ? `<div class="kpi"><div class="label">Score quota fab</div><div class="value">${pct(scoreFab*100, 0)}</div><div class="delta ${scoreFab>=1?'up':'down'}">bonus ${money(bonusFab)} / ${money(BONUS_QUOTA_VENDEUR_MAX)}</div></div>`
      : `<div class="kpi"><div class="label">Quota CA hebdo</div><div class="value">${pct(pctQuotaCA, 0)}</div><div class="delta ${caParticulier >= quotaCA ? 'up' : 'down'}">${money(caParticulier)} / ${money(quotaCA)}</div></div>`}
    <div class="kpi"><div class="label">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'}</div><div class="value">${money(salaireEst)}</div><div class="delta">CA ${money(salaireCAPart)} + bonus ${money(bonusFab)} · plafond ${money(plafondSalaire)}</div></div>
  `;

  // Section "Declarer fabrication" : visible UNIQUEMENT semaine en cours +
  // au moins un produit actif + pas en mode "voir comme"
  const blocDeclarerFab = (isCurrent && !modeVoirComme && produitsActifs.length > 0) ? `
    <div class="panel-title mt-3" style="margin-bottom:6px;"><span>Déclarer une fabrication</span><span class="muted" style="font-size:0.78rem;">cumul de la semaine — saisie libre par produit</span></div>
    <div class="row" style="gap:10px;flex-wrap:wrap;">
      ${produitsActifs.map(id => `
        <div class="panel" style="flex:1 1 240px;min-width:220px;padding:10px;">
          <div class="mono" style="font-size:0.92rem;margin-bottom:4px;">${escapeHtml(nomProduit(id))}</div>
          <div class="muted" style="font-size:0.78rem;margin-bottom:6px;">Quota : ${num(quotaFabrication[id])} · fait : ${num(fabrications[id])}</div>
          <div class="row" style="gap:6px;">
            <input type="number" min="1" step="1" placeholder="+ qté" data-fab-qte="${id}" style="flex:1;min-width:80px;" />
            <button class="btn btn-primary btn-sm" data-fab-valider="${id}">Valider</button>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  document.getElementById('detail').innerHTML = `
    <div class="row" style="gap:14px;flex-direction:column;align-items:stretch;">
      <div>
        <div class="muted mono mb-1">Quota CA hebdo (sur CA commissionnable — avert auto si non atteint à la clôture)</div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${pctQuotaCA}%;${caParticulier >= quotaCA ? 'background:var(--color-cactus,#5a8);' : ''}"></div>
          <div class="label">${money(caParticulier)} / ${money(quotaCA)} (${pct(pctQuotaCA, 0)})</div>
        </div>
      </div>
      <div>
        <div class="muted mono mb-1">Progression vers plafond part CA (${money(quotaCA)} = plafond part CA ${money(plafondCAVendeur)})</div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${progressionCA}%"></div>
          <div class="label">${money(caParticulier)} / ${money(plafondCAAffiche)}</div>
        </div>
      </div>
      ${produitsActifs.length > 0 ? `
        <div>
          <div class="muted mono mb-1">Quotas de fabrication (bonus jusqu'à ${money(BONUS_QUOTA_VENDEUR_MAX)} · score moyen des produits actifs)</div>
          ${produitsActifs.map(id => {
            const fait = fabrications[id];
            const q = quotaFabrication[id];
            const pctP = q > 0 ? Math.min(100, (fait / q) * 100) : 0;
            return `
              <div class="row" style="align-items:center;gap:8px;margin-bottom:4px;">
                <div class="mono" style="min-width:200px;font-size:0.85rem;">${escapeHtml(nomProduit(id))}</div>
                <div class="progress" style="flex:1;height:20px;">
                  <div class="fill" style="width:${pctP}%;${fait>=q?'background:var(--color-cactus,#5a8);':''}"></div>
                  <div class="label">${num(fait)} / ${num(q)} (${pct(pctP,0)})</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      ` : ''}
      <div>
        <div class="muted mono mb-1">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'} / plafond — part CA ${money(salaireCAPart)} + bonus quota ${money(bonusFab)}</div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${plafondSalaire ? (salaireEst/plafondSalaire)*100 : 0}%"></div>
          <div class="label">${money(salaireEst)} / ${money(plafondSalaire)}</div>
        </div>
      </div>
    </div>

    ${blocDeclarerFab}

    <div class="panel-title mt-3" style="margin-bottom:6px;"><span>Mes factures de la semaine</span><span class="muted" style="font-size:0.78rem;">${myVentes.length} vente${myVentes.length>1?'s':''}</span></div>
    <div class="table-scroll" style="max-height:400px;">
      <table class="data" id="table-mes-ventes">
        <thead><tr>
          <th data-sort="date">Date</th>
          <th data-sort="facture">#Facture</th>
          <th data-sort="client">Client</th>
          <th data-sort="paiement">Paiement</th>
          <th class="right" data-sort="montant">Montant</th>
          <th class="right" data-sort="benefice">Bénéfice</th>
        </tr></thead>
        <tbody>
          ${myVentes.length === 0 ? '<tr><td colspan="6" class="muted text-center">Aucune vente sur cette semaine.</td></tr>' :
            myVentes.map(v => `
              <tr>
                <td>${datetime(v.timestamp)}</td>
                <td class="mono">#${escapeHtml(v.factureId || v.id)}</td>
                <td>${escapeHtml(v.client || '—')}</td>
                <td><span class="badge neutral">${escapeHtml(v.paiement || '—')}</span></td>
                <td class="right mono">${money(v.montant)}</td>
                <td class="right mono">${money(v.benefice || 0)}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (myVentes.length > 0) makeSortable(document.getElementById('table-mes-ventes'));

  // Branche les boutons "Valider" de declaration fabrication
  if (isCurrent && !modeVoirComme && produitsActifs.length > 0) {
    document.querySelectorAll('[data-fab-valider]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.fabValider;
        const input = document.querySelector(`[data-fab-qte="${pid}"]`);
        const qte = Number(input?.value || 0);
        if (!qte || qte <= 0 || !Number.isInteger(qte)) {
          toastError('Saisis un nombre entier > 0.');
          input?.focus();
          return;
        }
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await callFunction('vendeurDeclarerFabrication', { produitId: pid, quantite: qte });
          toastSuccess(`+${qte} ${nomProduit(pid)} déclaré(s)`);
          // Re-fetch cible : nouveau doc quotasVendeur + re-render KPI/barres.
          // Evite un full reload (= refetch ventes/services/etc inchanges).
          const nouveauQuotaV = await getQuotaVendeur(viewedUserId, wId).catch(() => quotaV);
          renderVendeur(myVentes, nouveauQuotaV, isCurrent);
        } catch (e) {
          console.error('[employee] vendeurDeclarerFabrication', e);
          toastError(e.message || 'Erreur lors de la déclaration.');
          btn.disabled = false;
          btn.textContent = 'Valider';
        }
      });
    });
  }
}

// Livreur (revision 2026-07-02) : PAS un salaire fixe. Paye = 5 000 fixe pour
// les livraisons + part variable sur ses VENTES declarees (taux vendeur exp,
// plafonnee a 10 000) => plafond total 15 000. On lui montre donc son salaire
// ESTIME live, pas un "plafond fixe" comme la direction.
function renderLivreur(myVentes, isCurrent) {
  const estVenteCA = (v) => !v.categorieFiscale || v.categorieFiscale === 'vente'; // don/subvention hors CA & hors commission
  const ca = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montant || 0) : 0), 0);
  const caParticulier = myVentes.reduce((s, v) => s + (estVenteCA(v) ? (v.montantParticulier ?? v.montant ?? 0) : 0), 0);
  const caPro = ca - caParticulier;
  const quotaCA = Number(config.quotaCAVendeur ?? QUOTA_CA_VENDEUR_DEFAULT);

  const variable   = partVariableVente(caParticulier, quotaCA, LIVREUR_VENTE_VAR_MAX);
  const salaireEst = salaireLivreur(caParticulier, quotaCA); // min(fixe + variable, plafond)
  const pctCA      = quotaCA > 0 ? Math.min(100, (caParticulier / quotaCA) * 100) : 0;

  document.getElementById('kpis-emp').innerHTML = `
    <div class="kpi kpi-salaire"><div class="label">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'}</div><div class="value">${money(salaireEst)}</div><div class="delta">${money(LIVREUR_FIXE)} fixe + ${money(variable)} ventes · plafond ${money(plafondSalaire)}</div></div>
    <div class="kpi"><div class="label">Part fixe livraisons</div><div class="value">${money(LIVREUR_FIXE)}</div><div class="delta">honorée dès que tu livres</div></div>
    <div class="kpi"><div class="label">CA commissionnable</div><div class="value">${money(caParticulier)}</div><div class="delta">${myVentes.length} vente${myVentes.length>1?'s':''}${caPro > 0 ? ` · ${money(caPro)} hors commission` : ''}</div></div>
    <div class="kpi"><div class="label">Part variable ventes</div><div class="value">${money(variable)}</div><div class="delta ${variable >= LIVREUR_VENTE_VAR_MAX ? 'up' : ''}">/ ${money(LIVREUR_VENTE_VAR_MAX)} max</div></div>
  `;

  document.getElementById('detail').innerHTML = `
    <p class="muted mb-2">
      En tant que <strong>Livreur</strong>, ta paye = <strong>${money(LIVREUR_FIXE)} fixe</strong> pour honorer tes livraisons de la semaine
      + une <strong>part variable</strong> sur tes <strong>ventes déclarées</strong> (même taux qu'un vendeur expérimenté), plafonnée à ${money(LIVREUR_VENTE_VAR_MAX)}.
      Total maximum <strong>${money(plafondSalaire)}</strong>. Les livraisons elles-mêmes ne génèrent pas de CA : déclare-les sur la page « Livraisons ».
    </p>
    <div class="row" style="gap:14px;flex-direction:column;align-items:stretch;">
      <div>
        <div class="muted mono mb-1">Part variable sur tes ventes (CA commissionnable ${money(caParticulier)} / ${money(quotaCA)} = part variable au plafond)</div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${pctCA}%;${caParticulier >= quotaCA ? 'background:var(--color-cactus,#5a8);' : ''}"></div>
          <div class="label">${money(variable)} / ${money(LIVREUR_VENTE_VAR_MAX)}</div>
        </div>
      </div>
      <div>
        <div class="muted mono mb-1">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'} / plafond — ${money(LIVREUR_FIXE)} fixe + part variable ${money(variable)}</div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${plafondSalaire ? (salaireEst/plafondSalaire)*100 : 0}%"></div>
          <div class="label">${money(salaireEst)} / ${money(plafondSalaire)}</div>
        </div>
      </div>
    </div>

    <div class="panel-title mt-3" style="margin-bottom:6px;"><span>Mes factures de la semaine</span><span class="muted" style="font-size:0.78rem;">${myVentes.length} vente${myVentes.length>1?'s':''}</span></div>
    <div class="table-scroll" style="max-height:400px;">
      <table class="data" id="table-mes-ventes">
        <thead><tr>
          <th data-sort="date">Date</th>
          <th data-sort="facture">#Facture</th>
          <th data-sort="client">Client</th>
          <th data-sort="paiement">Paiement</th>
          <th class="right" data-sort="montant">Montant</th>
          <th class="right" data-sort="benefice">Bénéfice</th>
        </tr></thead>
        <tbody>
          ${myVentes.length === 0 ? '<tr><td colspan="6" class="muted text-center">Aucune vente sur cette semaine.</td></tr>' :
            myVentes.map(v => `
              <tr>
                <td>${datetime(v.timestamp)}</td>
                <td class="mono">#${escapeHtml(v.factureId || v.id)}</td>
                <td>${escapeHtml(v.client || '—')}</td>
                <td><span class="badge neutral">${escapeHtml(v.paiement || '—')}</span></td>
                <td class="right mono">${money(v.montant)}</td>
                <td class="right mono">${money(v.benefice || 0)}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;
  if (myVentes.length > 0) makeSortable(document.getElementById('table-mes-ventes'));
}

function renderPompiste(quota, isCurrent) {
  const bidons = quota?.bidons || 0;
  const caoutchoucs = quota?.caoutchoucs || 0;
  // Quota a 0 = dimension desactivee cette semaine. ?? au lieu de || pour
  // distinguer "non configure" (defaut) de "configure a 0" (desactive).
  const qB = config.quotaBidons      ?? 1700;
  const qC = config.quotaCaoutchoucs ??  800;
  const bidonsActif = qB > 0;
  const caoutsActif = qC > 0;
  const nbActif = (bidonsActif ? 1 : 0) + (caoutsActif ? 1 : 0);

  const score = scorePompiste(bidons, caoutchoucs, qB, qC);
  const salaireEst = salairePompiste(profile.role, bidons, caoutchoucs, qB, qC);
  const pctB = bidonsActif ? Math.min(100, (bidons / qB) * 100) : 0;
  const pctC = caoutsActif ? Math.min(100, (caoutchoucs / qC) * 100) : 0;

  // Le plafond est ventile uniquement entre dimensions actives. Si une
  // dimension est desactivee (quota=0), l'autre porte la totalite.
  const partPlafond = nbActif > 0 ? plafondSalaire / nbActif : 0;
  const partBidons  = bidonsActif ? Math.min(partPlafond, (bidons / qB) * partPlafond) : 0;
  const partCaouts  = caoutsActif ? Math.min(partPlafond, (caoutchoucs / qC) * partPlafond) : 0;
  const valeurUnitBidon = bidonsActif ? partPlafond / qB : 0;
  const valeurUnitCaout = caoutsActif ? partPlafond / qC : 0;

  // KPI score : libelle dynamique selon les quotas actifs
  const scoreLabel = nbActif === 2 ? 'moyenne des 2 quotas'
                    : (bidonsActif ? 'sur quota bidons (caoutchoucs désactivé)'
                    : (caoutsActif ? 'sur quota caoutchoucs (bidons désactivé)'
                    : 'aucun quota actif'));

  document.getElementById('kpis-emp').innerHTML = `
    <div class="kpi"><div class="label">Bidons ravitaillés</div><div class="value">${num(bidons)}</div><div class="delta">${bidonsActif ? `/ ${num(qB)} (${pct(pctB,0)})` : 'quota désactivé'}</div></div>
    <div class="kpi"><div class="label">Caoutchoucs produits</div><div class="value">${num(caoutchoucs)}</div><div class="delta">${caoutsActif ? `/ ${num(qC)} (${pct(pctC,0)})` : 'quota désactivé'}</div></div>
    <div class="kpi"><div class="label">Score global</div><div class="value">${pct(score,1)}</div><div class="delta">${scoreLabel}</div></div>
    <div class="kpi kpi-salaire"><div class="label">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'}</div><div class="value">${money(salaireEst)}</div><div class="delta">/ ${money(plafondSalaire)} max</div></div>
  `;

  // Texte explicatif dynamique selon les quotas actifs
  let explicSalaire;
  if (nbActif === 2) {
    explicSalaire = `moitié sur les bidons + moitié sur les caoutchoucs. Atteindre les 2 quotas (${num(qB)} bidons + ${num(qC)} caoutchoucs) = plafond ${money(plafondSalaire)}. Tu touches déjà même si tu n'as fait qu'un seul des deux — chaque bidon et chaque caoutchouc compte.`;
  } else if (bidonsActif) {
    explicSalaire = `uniquement sur les bidons cette semaine (caoutchoucs désactivés). Atteindre le quota (${num(qB)} bidons) = plafond ${money(plafondSalaire)}.`;
  } else if (caoutsActif) {
    explicSalaire = `uniquement sur les caoutchoucs cette semaine (bidons désactivés). Atteindre le quota (${num(qC)} caoutchoucs) = plafond ${money(plafondSalaire)}.`;
  } else {
    explicSalaire = `tous les quotas sont désactivés cette semaine. Contacte la direction.`;
  }

  document.getElementById('detail').innerHTML = `
    <div style="display:grid;gap:14px;">
      ${bidonsActif ? `
      <div>
        <div class="muted mono mb-1">Bidons d'essence ravitaillés <span style="float:right;color:var(--color-cactus,#5a8);">+${moneyPrecis(valeurUnitBidon)}/bidon</span></div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${pctB}%"></div>
          <div class="label">${num(bidons)} / ${num(qB)} bidons → ${money(partBidons)}</div>
        </div>
      </div>
      ` : ''}
      ${caoutsActif ? `
      <div>
        <div class="muted mono mb-1">Caoutchoucs produits <span style="float:right;color:var(--color-cactus,#5a8);">+${moneyPrecis(valeurUnitCaout)}/caoutchouc</span></div>
        <div class="progress" style="height:24px;">
          <div class="fill" style="width:${pctC}%"></div>
          <div class="label">${num(caoutchoucs)} / ${num(qC)} unités → ${money(partCaouts)}</div>
        </div>
      </div>
      ` : ''}
      <div>
        <div class="muted mono mb-1">${isCurrent ? 'Salaire estimé' : 'Salaire calculé'} / plafond ${ROLE_LABELS[profile.role]}</div>
        <div class="progress" style="height:28px;">
          <div class="fill" style="width:${plafondSalaire ? (salaireEst/plafondSalaire)*100 : 0}%;background:linear-gradient(90deg,#ffd24a,#ffac1a);"></div>
          <div class="label" style="font-weight:bold;">${money(salaireEst)} / ${money(plafondSalaire)}</div>
        </div>
      </div>
      ${isCurrent ? `
      <div class="alert info" style="font-size:0.82rem;margin-top:4px;">
        <strong>Comment ton salaire est calculé</strong> : ${explicSalaire}
      </div>

      <!-- État des stations en temps réel -->
      <div>
        <div class="muted mono mb-1">État des stations en temps réel</div>
        <div id="pompiste-stations">Chargement…</div>
      </div>

      <!-- Classement ravitaillement (live, indep. de la semaine consultee) -->
      <div id="classement-pompiste">Chargement du classement…</div>
      ` : `
      <div class="alert" style="background:rgba(70,130,200,0.10);border:1px solid #4a90e2;font-size:0.82rem;margin-top:4px;">
        Semaine clôturée — chiffres figés. Bascule sur « Semaine en cours » pour les actions du moment.
      </div>
      `}
    </div>
  `;

  // Le listener stations + modals ravitaillement/correction ne sont brancher
  // que sur la semaine en cours (sinon UI confusante : "ravitaille" dans le passe ?).
  if (isCurrent) {
    initPompisteActions();
    renderClassementPompiste();
  }
}

// Classement ravitaillement (semaine / mois / depuis embauche).
// Live, independant de la semaine consultee dans le selecteur — c'est un
// outil de motivation, pas une vue historique.
async function renderClassementPompiste() {
  const container = document.getElementById('classement-pompiste');
  if (!container) return;

  const now = new Date();
  const weekStart = startOfWeekRP(now);
  const weekEnd   = endOfWeekRP(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const logErr = (label) => (e) => { console.error(`[classement] ${label}:`, e); return []; };
  const [users, rSem, rMois, rAll] = await Promise.all([
    listUsers().catch(logErr('listUsers')),
    listRedistributionsRangeManuel(weekStart, weekEnd).catch(logErr('semaine')),
    listRedistributionsRangeManuel(monthStart, monthEnd).catch(logErr('mois')),
    listAllRedistributionsManuel().catch(logErr('total'))
  ]);
  console.log('[classement] semaine docs:', rSem.length, '· mois docs:', rMois.length, '· total docs:', rAll.length);

  // Pompistes ravitailleurs = pompiste-* + responsable-pompiste (peu importe statut
  // pour que les ex-pompistes apparaissent encore dans 'depuis embauche').
  const pompistes = users.filter(u =>
    /^pompiste-/.test(u.role) || u.role === 'responsable-pompiste'
  );

  const aggregate = (redists) => {
    const m = new Map();
    for (const r of redists) {
      if (!r.pompisteId) continue;
      const cur = m.get(r.pompisteId) || { litres: 0, bidons: 0 };
      cur.litres += Number(r.litres || 0);
      cur.bidons += Number(r.bidons || 0);
      m.set(r.pompisteId, cur);
    }
    return m;
  };

  // Filtre uniformément : on n'affiche que ceux qui ont ravitaillé sur la
  // periode. Un pompiste a 0 litres n'a pas sa place dans un classement.
  const classer = (agg) => pompistes
    .map(p => ({
      uid:    p.id,
      nom:    `${p.prenom || ''} ${p.nom || ''}`.trim() || p.username || p.id,
      role:   p.role,
      statut: p.statut || 'actif',
      ...(agg.get(p.id) || { litres: 0, bidons: 0 })
    }))
    .filter(p => p.litres > 0)
    .sort((a, b) => b.litres - a.litres);

  const periodes = {
    semaine: { label: 'Semaine', list: classer(aggregate(rSem)) },
    mois:    { label: 'Mois',    list: classer(aggregate(rMois)) },
    total:   { label: 'Depuis embauche', list: classer(aggregate(rAll)) }
  };

  const rangBadge = (i) => `#${i + 1}`;
  const renderList = (list) => {
    if (list.length === 0) return '<p class="muted text-center">Aucun ravitaillement sur cette période.</p>';
    return `
      <ol style="list-style:none;padding:0;margin:0;">
        ${list.map((p, i) => {
          const isMe = p.uid === viewedUserId;
          const inactif = p.statut !== 'actif';
          return `
            <li style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;${isMe ? 'background:rgba(255,180,80,0.18);font-weight:bold;' : ''}${inactif ? 'opacity:0.6;' : ''}">
              <span style="width:36px;text-align:center;font-size:1.05rem;">${rangBadge(i)}</span>
              <span style="flex:1;">${escapeHtml(p.nom)}${isMe ? ' (toi)' : ''}${inactif ? ' <span class="muted" style="font-size:0.72rem;">(inactif)</span>' : ''}</span>
              <span class="mono" style="text-align:right;">${num(Math.round(p.litres))} L <span class="muted" style="font-size:0.78rem;">· ${num(p.bidons)} bidons</span></span>
            </li>
          `;
        }).join('')}
      </ol>
    `;
  };

  container.innerHTML = `
    <div class="panel" style="padding:12px;margin-top:6px;">
      <div class="panel-title" style="margin-bottom:8px;"><span>Classement ravitaillement</span><span class="muted" style="font-size:0.78rem;">les ravitaillements au-delà du quota comptent aussi</span></div>
      <div class="row" style="gap:6px;margin-bottom:10px;">
        <button class="btn btn-sm btn-primary" data-cl-period="semaine">Semaine</button>
        <button class="btn btn-sm" data-cl-period="mois">Mois</button>
        <button class="btn btn-sm" data-cl-period="total">Depuis embauche</button>
      </div>
      <div id="cl-list">${renderList(periodes.semaine.list)}</div>
    </div>
  `;

  container.querySelectorAll('[data-cl-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-cl-period]').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      const key = btn.dataset.clPeriod;
      document.getElementById('cl-list').innerHTML = renderList(periodes[key].list);
    });
  });
}

function renderAutre(myVentes, quota, sDebut, sFin, isCurrent) {
  // Direction / Resp / DRH / Admin Tech : salaire FIXE, mais peuvent aussi
  // vendre / ravitailler. On affiche leurs stats personnelles a titre INFO
  // (sans impact sur leur paye fixe).
  // Cas responsable-pompiste  : peut ravitailler
  // les stations comme les pompistes classiques. On lui affiche l'etat des
  // stations en temps reel pour qu'il sache ou intervenir (listener
  // pompiste-stations branche par initPompisteActions).
  const estRespPompiste = profile.role === 'responsable-pompiste';
  const ca = myVentes.reduce((s, v) => s + (v.montant || 0), 0);
  const benefice = myVentes.reduce((s, v) => s + (v.benefice || 0), 0);
  const bidons = quota?.bidons ?? 0;
  const caoutchoucs = quota?.caoutchoucs ?? 0;
  const aFaitDeLaCo = ca > 0 || bidons > 0 || caoutchoucs > 0;

  // Pour heures : on utilise la semaine en cours uniquement (les heures
  // figees d'une semaine passee sont visibles dans le bloc Services).
  const heuresAffichees = isCurrent ? heuresMs : 0;
  const nbServicesAffiches = isCurrent ? myServicesCurr.length : 0;

  document.getElementById('kpis-emp').innerHTML = `
    <div class="kpi"><div class="label">Plafond salaire</div><div class="value">${money(plafondSalaire)}</div><div class="delta">salaire fixe (TTE)</div></div>
    <div class="kpi"><div class="label">Heures cette semaine</div><div class="value">${durationHM(heuresAffichees)}</div><div class="delta">${nbServicesAffiches} sessions${isCurrent ? '' : ' (cf. cumul)'}</div></div>
    <div class="kpi"><div class="label">${aFaitDeLaCo ? 'CA bonus généré' : 'Statut'}</div><div class="value">${aFaitDeLaCo ? money(ca) : ROLE_LABELS[profile.role]}</div><div class="delta">${aFaitDeLaCo ? myVentes.length + ' ventes (info, sans impact paye)' : (profile.statut || 'actif')}</div></div>
    <div class="kpi"><div class="label">Date d'entrée</div><div class="value mono" style="font-size:1.2rem;">${profile.dateEntree || '—'}</div><div class="delta">au LTD</div></div>
  `;

  let detailHtml = `
    <p class="muted mb-2">
      En tant que ${ROLE_LABELS[profile.role]}, ton salaire est <strong>fixé</strong> par la direction (${money(plafondSalaire)} max).
      ${aFaitDeLaCo ? "Tes ventes et ravitaillements ci-dessous comptent pour le CA global du LTD mais <strong>n'impactent pas ta paye</strong>." : "Utilise les autres modules pour piloter l'activité."}
    </p>
  `;
  if (aFaitDeLaCo) {
    detailHtml += `
      <div class="kpi-grid mb-2">
        ${ca > 0 ? `<div class="kpi"><div class="label">CA généré</div><div class="value">${money(ca)}</div><div class="delta">${myVentes.length} ventes</div></div>` : ''}
        ${benefice !== 0 ? `<div class="kpi"><div class="label">Bénéfice généré</div><div class="value">${money(benefice)}</div><div class="delta">pour le LTD</div></div>` : ''}
        ${bidons > 0 ? `<div class="kpi"><div class="label">Bidons d'essence</div><div class="value">${num(bidons)}</div><div class="delta">produits</div></div>` : ''}
        ${caoutchoucs > 0 ? `<div class="kpi"><div class="label">Caoutchoucs</div><div class="value">${num(caoutchoucs)}</div><div class="delta">produits</div></div>` : ''}
      </div>
      ${myVentes.length > 0 ? `
        <div class="panel-title mt-2" style="margin-bottom:6px;"><span>Mes factures</span><span class="muted" style="font-size:0.78rem;">${myVentes.length} vente${myVentes.length>1?'s':''}</span></div>
        <div class="table-scroll" style="max-height:300px;">
          <table class="data">
            <thead><tr><th>Date</th><th>#Facture</th><th>Client</th><th>Paiement</th><th class="right">Montant</th><th class="right">Bénéfice</th></tr></thead>
            <tbody>
              ${myVentes.map(v => `
                <tr>
                  <td class="mono">${datetime(v.timestamp)}</td>
                  <td class="mono">#${escapeHtml(v.factureId || v.id)}</td>
                  <td>${escapeHtml(v.client || '—')}</td>
                  <td><span class="badge neutral">${escapeHtml(v.paiement || '—')}</span></td>
                  <td class="right mono">${money(v.montant)}</td>
                  <td class="right mono ${(v.benefice||0) >= 0 ? '' : 'muted'}">${money(v.benefice || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;
  }
  // Pour le responsable-pompiste : on injecte la div #pompiste-stations
  // (remplie en live par initPompisteActions/listenStations). Indispensable
  // pour qu'il voie l'etat des stations et sache laquelle ravitailler en
  // priorite. Affiche uniquement sur semaine courante (les anciennes semaines
  // n'ont plus de sens pour un suivi live des stations).
  if (estRespPompiste && isCurrent) {
    detailHtml += `
      <div class="mt-3">
        <div class="muted mono mb-1">État des stations en temps réel</div>
        <div id="pompiste-stations">Chargement…</div>
      </div>
    `;
  }
  document.getElementById('detail').innerHTML = detailHtml;
}

// ============================================================
// Selecteur semaine — branche le rechargement du detail
// ============================================================
await initSemaineSelector('#selecteur-semaine', {
  storageKey: 'employee-semaine-selectionnee',
  onChange: (payload) => {
    chargerEtRendreDetail(payload).catch(err => {
      console.error('[employee] chargerEtRendreDetail', err);
      document.getElementById('detail').innerHTML =
        '<p class="alert warn">Erreur de chargement de la semaine.</p>';
    });
  }
});

// ============================================================
// Actions pompiste (ravitailler / corriger stock) — semaine en cours uniquement
// ============================================================
let stationsCacheLocale = [];
let _pompisteActionsInit = false;

function initPompisteActions() {
  if (!isPompisteRavitailleur(profile.role) || modeVoirComme) return;

  // Listener stations en temps reel (toujours initialise une fois)
  if (!_pompisteActionsInit) {
    listenStations(stations => {
      stationsCacheLocale = stations;
      const div = document.getElementById('pompiste-stations');
      if (!div) return;
      if (stations.length === 0) {
        div.innerHTML = '<p class="muted">Aucune station configurée.</p>';
        return;
      }
      const sorted = [...stations].sort((a, b) => {
        const pctA = a.stockMax ? (a.stockActuel / a.stockMax) * 100 : 0;
        const pctB = b.stockMax ? (b.stockActuel / b.stockMax) * 100 : 0;
        return pctA - pctB;
      });
      div.innerHTML = sorted.map(s => {
        const niveau = s.stockMax ? (s.stockActuel / s.stockMax) * 100 : 0;
        const sousAlerte = s.stockActuel < (s.seuilAlerte || 0);
        const cls = sousAlerte ? 'alerte-fort' : (niveau < 30 ? 'gold' : '');
        const badge = sousAlerte
          ? '<span class="badge danger">ALERTE</span>'
          : (niveau < 30 ? '<span class="badge warn">BAS</span>' : '<span class="badge ok">OK</span>');
        return `
          <div class="row" style="margin-bottom:6px;gap:10px;align-items:center;">
            <div style="flex:1;min-width:0;">
              <div style="font-family:var(--font-heading);font-size:0.85rem;display:flex;justify-content:space-between;gap:8px;">
                <span>${escapeHtml(s.nom)}</span>
                ${badge}
              </div>
              <div class="progress" style="height:14px;">
                <div class="fill" style="width:${Math.min(niveau, 100)}%;${sousAlerte ? 'background:var(--color-blood);' : ''}"></div>
                <div class="label ${cls}">${num(s.stockActuel || 0)} / ${num(s.stockMax || 0)} L (${pct(niveau, 0)})</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    });
    _pompisteActionsInit = true;
  } else {
    // Si on revient sur la semaine en cours apres un detour : reinjecter
    // l'affichage stations (le DOM a ete reconstruit par renderPompiste).
    const div = document.getElementById('pompiste-stations');
    if (div && stationsCacheLocale.length > 0) {
      const sorted = [...stationsCacheLocale].sort((a, b) => {
        const pctA = a.stockMax ? (a.stockActuel / a.stockMax) * 100 : 0;
        const pctB = b.stockMax ? (b.stockActuel / b.stockMax) * 100 : 0;
        return pctA - pctB;
      });
      div.innerHTML = sorted.map(s => {
        const niveau = s.stockMax ? (s.stockActuel / s.stockMax) * 100 : 0;
        const sousAlerte = s.stockActuel < (s.seuilAlerte || 0);
        const cls = sousAlerte ? 'alerte-fort' : (niveau < 30 ? 'gold' : '');
        const badge = sousAlerte
          ? '<span class="badge danger">ALERTE</span>'
          : (niveau < 30 ? '<span class="badge warn">BAS</span>' : '<span class="badge ok">OK</span>');
        return `
          <div class="row" style="margin-bottom:6px;gap:10px;align-items:center;">
            <div style="flex:1;min-width:0;">
              <div style="font-family:var(--font-heading);font-size:0.85rem;display:flex;justify-content:space-between;gap:8px;">
                <span>${escapeHtml(s.nom)}</span>
                ${badge}
              </div>
              <div class="progress" style="height:14px;">
                <div class="fill" style="width:${Math.min(niveau, 100)}%;${sousAlerte ? 'background:var(--color-blood);' : ''}"></div>
                <div class="label ${cls}">${num(s.stockActuel || 0)} / ${num(s.stockMax || 0)} L (${pct(niveau, 0)})</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// === Bindings modaux pompiste (pompistes + responsable-pompiste, semaine en cours) ===
// Bindings une seule fois au chargement, pas lies au selecteur.
if (isPompisteRavitailleur(profile.role) && !modeVoirComme) {
  const BIDON_L = 15;
  const btnRavit  = document.getElementById('btn-ravitailler');
  const modalRav  = document.getElementById('modal-ravit');
  const selStat   = document.getElementById('ravit-station');
  const inBidons  = document.getElementById('ravit-bidons');
  const elInfo    = document.getElementById('ravit-station-info');
  const elPrev    = document.getElementById('ravit-preview');

  function refreshStationInfo() {
    const sid = selStat.value;
    const s = stationsCacheLocale.find(x => x.id === sid);
    if (!s) { elInfo.textContent = ''; refreshPreview(); return; }
    const libre = Math.max(0, (s.stockMax || 0) - (s.stockActuel || 0));
    elInfo.innerHTML = `Stock actuel : <strong>${num(s.stockActuel || 0)} L</strong> / ${num(s.stockMax || 0)} L
      · <strong>${num(libre)} L libres</strong> (${Math.floor(libre / BIDON_L)} bidons max)`;
    refreshPreview();
  }
  function refreshPreview() {
    const sid = selStat.value;
    const s = stationsCacheLocale.find(x => x.id === sid);
    const n = parseInt(inBidons.value, 10);
    if (!Number.isFinite(n) || n <= 0) {
      elPrev.innerHTML = '—';
      elPrev.style.color = '';
      return;
    }
    const ajout = n * BIDON_L;
    let html = `${n} bidon${n > 1 ? 's' : ''} = <strong>${num(ajout)} L</strong>`;
    if (s) {
      const apres = (s.stockActuel || 0) + ajout;
      const max = s.stockMax || 0;
      if (max > 0 && apres > max) {
        const libre = Math.max(0, max - (s.stockActuel || 0));
        const bidonsMax = Math.floor(libre / BIDON_L);
        html = `<strong>Dépassement</strong> : la station n'accepte que ${bidonsMax} bidons max (${num(libre)} L libres). Saisis moins.`;
        elPrev.style.color = 'var(--color-blood-light)';
      } else {
        html += ` · stock après : <strong>${num(apres)} L</strong>${max ? ` / ${num(max)} L` : ''}`;
        elPrev.style.color = '';
      }
    }
    elPrev.innerHTML = html;
  }

  if (btnRavit) {
    btnRavit.addEventListener('click', () => {
      selStat.innerHTML = '<option value="">— Sélectionne une station —</option>' +
        stationsCacheLocale.map(s => {
          return `<option value="${s.id}">${escapeHtml(s.nom)} (${num(s.stockActuel || 0)}/${num(s.stockMax || 0)} L)</option>`;
        }).join('');
      inBidons.value = '';
      elInfo.textContent = '';
      elPrev.innerHTML = '—';
      elPrev.style.color = '';
      modalRav.classList.remove('hidden');
      setTimeout(() => selStat.focus(), 50);
    });
    selStat.addEventListener('change', refreshStationInfo);
    inBidons.addEventListener('input', refreshPreview);
    document.getElementById('btn-cancel-ravit').addEventListener('click', () => {
      modalRav.classList.add('hidden');
    });
    document.getElementById('btn-save-ravit').addEventListener('click', async () => {
      const stationId = selStat.value;
      const bidons = parseInt(inBidons.value, 10);
      if (!stationId) return alert('Sélectionne une station.');
      if (!Number.isFinite(bidons) || bidons <= 0) return alert('Saisis un nombre de bidons > 0.');
      const btn = document.getElementById('btn-save-ravit');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        await callFunction('pompisteRavitaillerManuel', { stationId, bidons });
        modalRav.classList.add('hidden');
        window.location.reload();
      } catch (e) {
        alert('Échec : ' + (e?.message || 'erreur inattendue.'));
        btn.disabled = false; btn.textContent = 'Valider le ravitaillement';
      }
    });
  }

  // === Modal Corriger le stock (incoherence) ===
  const btnCorrec  = document.getElementById('btn-corriger-stock');
  const modalCor   = document.getElementById('modal-correc');
  const selCorStat = document.getElementById('correc-station');
  const inCorLitres= document.getElementById('correc-litres');
  const inCorRaison= document.getElementById('correc-raison');
  const elCorInfo  = document.getElementById('correc-station-info');
  const elCorPrev  = document.getElementById('correc-preview');

  function refreshCorrecInfo() {
    const sid = selCorStat.value;
    const s = stationsCacheLocale.find(x => x.id === sid);
    if (!s) { elCorInfo.textContent = ''; refreshCorrecPreview(); return; }
    elCorInfo.innerHTML = `Stock actuel sur le site : <strong>${num(s.stockActuel || 0)} L</strong> / ${num(s.stockMax || 0)} L`;
    // Ne PAS pré-remplir avec le stock du site : sinon le pompiste laisse la
    // valeur en place et la correction devient un no-op (écart nul, aucun
    // changement). Il doit saisir la valeur réelle relevée à la pompe. (v1.28.4)
    inCorLitres.value = '';
    refreshCorrecPreview();
  }
  function refreshCorrecPreview() {
    const sid = selCorStat.value;
    const s = stationsCacheLocale.find(x => x.id === sid);
    const v = Number(inCorLitres.value);
    if (!s || !Number.isFinite(v) || v < 0) { elCorPrev.textContent = '—'; elCorPrev.style.color = ''; return; }
    if (s.stockMax > 0 && v > s.stockMax) {
      elCorPrev.innerHTML = `<strong>Dépasse la capacité max</strong> (${num(s.stockMax)} L)`;
      elCorPrev.style.color = 'var(--color-blood-light)';
      return;
    }
    const ecart = v - (s.stockActuel || 0);
    elCorPrev.innerHTML = `Écart : <strong>${ecart > 0 ? '+' : ''}${num(ecart)} L</strong> ${ecart === 0 ? '(aucun changement)' : (ecart > 0 ? '(stock ajouté)' : '(stock retiré)')}`;
    elCorPrev.style.color = ecart === 0 ? 'var(--color-sand)' : '';
  }

  if (btnCorrec) {
    btnCorrec.addEventListener('click', () => {
      selCorStat.innerHTML = '<option value="">— Sélectionne une station —</option>' +
        stationsCacheLocale.map(s => `<option value="${s.id}">${escapeHtml(s.nom)} (${num(s.stockActuel || 0)} L)</option>`).join('');
      inCorLitres.value = '';
      inCorRaison.value = '';
      elCorInfo.textContent = '';
      elCorPrev.textContent = '—';
      elCorPrev.style.color = '';
      modalCor.classList.remove('hidden');
      setTimeout(() => selCorStat.focus(), 50);
    });
    selCorStat.addEventListener('change', refreshCorrecInfo);
    inCorLitres.addEventListener('input', refreshCorrecPreview);
    document.getElementById('btn-cancel-correc').addEventListener('click', () => {
      modalCor.classList.add('hidden');
    });
    document.getElementById('btn-save-correc').addEventListener('click', async () => {
      const stationId = selCorStat.value;
      const rawVal = inCorLitres.value.trim();
      const nouveauStock = Number(rawVal);
      const raison = inCorRaison.value.trim();
      if (!stationId) return alert('Sélectionne une station.');
      if (rawVal === '' || !Number.isFinite(nouveauStock) || nouveauStock < 0) {
        return alert('Saisis la valeur réelle du stock relevée à la pompe.');
      }
      const sCur = stationsCacheLocale.find(x => x.id === stationId);
      if (sCur && nouveauStock === Number(sCur.stockActuel || 0)) {
        return alert('Cette valeur est identique au stock actuel du site : rien à corriger. Saisis la valeur réelle relevée à la pompe.');
      }
      if (raison.length < 5) return alert('Raison obligatoire (min 5 caractères).');
      const btn = document.getElementById('btn-save-correc');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        await callFunction('pompisteCorrigerStock', { stationId, nouveauStock, raison });
        modalCor.classList.add('hidden');
        window.location.reload();
      } catch (e) {
        alert('Échec : ' + (e?.message || 'erreur inattendue.'));
        btn.disabled = false; btn.textContent = 'Valider la correction';
      }
    });
  }

  // === Modal Note de frais essence (pompiste avance des frais perso) ===
  // Le screenshot est colle directement via Ctrl+V dans la dropzone. On
  // resize l'image (max 1600px) + compress JPEG 75% pour rester sous la
  // limite Firestore (1 MB par doc, on vise ~700 KB max en base64).
  const btnNoteFrais = document.getElementById('btn-note-frais');
  const modalNF = document.getElementById('modal-note-frais');
  if (btnNoteFrais && modalNF) {
    let screenshotDataUrl = null;

    const pasteZone = document.getElementById('nf-paste-zone');
    const previewZone = document.getElementById('nf-preview-zone');
    const previewImg = document.getElementById('nf-preview-img');
    const previewMeta = document.getElementById('nf-preview-meta');
    const clearImgBtn = document.getElementById('nf-clear-img');

    function resetImage() {
      screenshotDataUrl = null;
      previewImg.src = '';
      previewMeta.textContent = '—';
      previewZone.classList.add('hidden');
      pasteZone.classList.remove('hidden');
    }

    // Resize + compress un Blob/File image en JPEG dataURL.
    // maxDim: dimension max longue (px) — 1600 par defaut pour rester lisible
    // sans exploser la taille. quality 0.75 = bon compromis.
    function resizeImageToDataUrl(blob, maxDim = 1600, quality = 0.75) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            let { width: w, height: h } = img;
            if (w > maxDim || h > maxDim) {
              if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
              else        { w = Math.round(w * maxDim / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            try {
              const url = canvas.toDataURL('image/jpeg', quality);
              resolve({ url, w, h });
            } catch (e) { reject(e); }
          };
          img.onerror = () => reject(new Error('Image illisible'));
          img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('Lecture image impossible'));
        reader.readAsDataURL(blob);
      });
    }

    async function handlePastedBlob(blob) {
      try {
        const { url, w, h } = await resizeImageToDataUrl(blob);
        // base64 ~ 4/3 de la taille binaire. On vise sous 700 KB pour avoir
        // de la marge sous la limite Firestore (1 MB par doc).
        const sizeKb = Math.round(url.length / 1024);
        if (sizeKb > 900) {
          // Tente une compression plus aggressive
          const { url: url2 } = await resizeImageToDataUrl(blob, 1280, 0.65);
          const sizeKb2 = Math.round(url2.length / 1024);
          if (sizeKb2 > 900) {
            toastError(`Image trop lourde (${sizeKb2} KB). Essaie un screenshot plus petit.`);
            return;
          }
          screenshotDataUrl = url2;
          previewImg.src = url2;
          previewMeta.textContent = `${w}×${h}px · ${sizeKb2} KB (recompresse)`;
        } else {
          screenshotDataUrl = url;
          previewImg.src = url;
          previewMeta.textContent = `${w}×${h}px · ${sizeKb} KB`;
        }
        previewZone.classList.remove('hidden');
        pasteZone.classList.add('hidden');
      } catch (e) {
        toastError('Impossible de lire l\'image : ' + (e?.message || e));
      }
    }

    // Consume une image collee depuis l'event paste. Retourne true si trouvee.
    async function tryConsumePastedImage(e) {
      const items = (e.clipboardData || window.clipboardData)?.items;
      if (!items) return false;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) await handlePastedBlob(blob);
          return true;
        }
      }
      return false;
    }

    pasteZone.addEventListener('click', () => pasteZone.focus());
    pasteZone.addEventListener('paste', async (e) => {
      const ok = await tryConsumePastedImage(e);
      if (!ok) toastError('Aucune image trouvee dans le presse-papier.');
    });
    // Fallback : capture le paste tant que le modal est ouvert et que la
    // dropzone est encore visible, meme si le focus est ailleurs dans le
    // modal — sauf input/textarea (l'utilisateur veut coller du texte).
    modalNF.addEventListener('paste', async (e) => {
      if (modalNF.classList.contains('hidden')) return;
      if (pasteZone.classList.contains('hidden')) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      await tryConsumePastedImage(e);
    });

    clearImgBtn.addEventListener('click', () => resetImage());

    btnNoteFrais.addEventListener('click', () => {
      if ((profile.avertsActifs || 0) >= 3 && !['patron', 'co-patron', 'admin-technique'].includes(profile.role)) {
        alert('Compte bloqué (3 avertissements actifs). Contacte la direction pour déclarer une note de frais.');
        return;
      }
      document.getElementById('nf-montant').value = '';
      document.getElementById('nf-desc').value = '';
      resetImage();
      modalNF.classList.remove('hidden');
      setTimeout(() => document.getElementById('nf-montant').focus(), 50);
    });
    document.getElementById('btn-cancel-note-frais').addEventListener('click', () => {
      modalNF.classList.add('hidden');
    });
    document.getElementById('btn-save-note-frais').addEventListener('click', async () => {
      const montant = Number(document.getElementById('nf-montant').value);
      const description = document.getElementById('nf-desc').value.trim();
      if (!Number.isFinite(montant) || montant <= 0) return alert('Montant invalide.');
      if (!screenshotDataUrl) return alert('Colle le screenshot de la confirmation IG (Ctrl+V dans la zone).');
      const btn = document.getElementById('btn-save-note-frais');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        await callFunction('creerNoteFrais', { montant, screenshotUrl: screenshotDataUrl, description });
        modalNF.classList.add('hidden');
        toastSuccess('Note de frais envoyée à la direction.');
        logSite('notes-frais', 'Note de frais créée', [
          { name: 'Montant', value: String(montant), inline: true },
          { name: 'Description', value: (description || '—').slice(0, 300), inline: false }
        ]);
      } catch (e) {
        alert('Échec : ' + (e?.message || 'erreur inattendue.'));
      } finally {
        btn.disabled = false; btn.textContent = 'Envoyer la note';
      }
    });
  }
}

// === Bouton "Declarer une vente" ===
// Bloque si compte bloque (>= 3 averts), sinon ouvre le modal.
const btnVente = document.getElementById('btn-declarer-vente');
if (btnVente) {
  btnVente.addEventListener('click', () => {
    if ((profile.avertsActifs || 0) >= 3 && !['patron', 'co-patron', 'admin-technique'].includes(profile.role)) {
      alert('Compte bloqué (3 avertissements actifs). Contacte la direction pour qu\'elle retire un avertissement avant de pouvoir déclarer une vente.');
      return;
    }
    ouvrirModalNouvelleVente({
      role: profile.role,
      onSuccess: () => {
        window.location.reload();
      }
    });
  });
}

// === Sorties en cours non regularisees (anti-vol 30min) ===
// Bloc retire de l'espace employe sur demande patron 2026-05-14 :
// les alertes etaient persistantes et difficiles a faire disparaitre.
// La cloche direction continue de recevoir les alertes via la cron
// `verifierSortiesExpirees` cote serveur. L'employe est juste pas notifie ici.

// === Avertissements (temps reel) ===
// Affiche UNIQUEMENT les avertissements actifs (les retires sont caches).
// 3 actifs = compte bloque (banniere rouge).
listenAvertissements(viewedUserId, (list) => {
  const div = document.getElementById('bloc-averts');
  const actifs = list.filter(a => a.actif);
  const n = actifs.length;
  if (n === 0) { div.innerHTML = ''; return; }

  const banniere = n >= 3 ? `
    <div class="alert" style="background:rgba(220,40,40,0.18);border:2px solid var(--color-blood);font-weight:bold;margin-bottom:8px;">
      <strong>COMPTE BLOQUÉ</strong> — tu as ${n} avertissements actifs (max 3). Tu peux consulter le site mais aucune écriture ni déclaration n'est possible. Contacte la direction pour qu'elle retire un avertissement.
    </div>` : n === 2 ? `
    <div class="alert" style="background:rgba(220,140,40,0.18);border:1px solid #d88;margin-bottom:8px;">
      <strong>${n} avertissements actifs</strong> — au prochain, ton compte sera bloqué.
    </div>` : `
    <div class="alert" style="background:rgba(220,180,40,0.12);border:1px solid #c93;margin-bottom:8px;">
      <strong>1 avertissement actif</strong> — fais attention.
    </div>`;

  const detail = `
    <div class="panel mb-3" style="margin:0 0 12px 0;">
      <div class="panel-title"><span>Mes avertissements actifs</span><span class="muted mono">${n} actif${n > 1 ? 's' : ''}</span></div>
      <table class="data" style="margin-top:6px;">
        <thead><tr><th>Date</th><th>Motif</th><th>Source</th></tr></thead>
        <tbody>${actifs.map(a => {
          const d = a.dateCreation?.toDate ? a.dateCreation.toDate() : null;
          const dateStr = d ? d.toLocaleDateString('fr-FR') : '—';
          const source = a.auto ? '<span class="badge info">auto</span>' : '<span class="badge">manuel</span>';
          return `<tr>
            <td class="mono" style="font-size:0.8rem;">${dateStr}</td>
            <td>${escapeHtml(a.motif || '')}</td>
            <td>${source}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  div.innerHTML = banniere + detail;
});

// === Bloc bas : Heures de service (vendeurs/direction) OU Ravitaillements (pompistes + responsable-pompiste) ===
const sDiv = document.getElementById('services');

if (isPompisteRavitailleur(profile.role)) {
  // Pompistes : pas de service (logique RP). On affiche les litres
  // ravitailles : jour / semaine / cumul depuis embauche.
  const startOfDayMs = startOfDay.getTime();
  const litresJour = myRedistCumul
    .filter(r => (r.timestamp?.toMillis?.() || 0) >= startOfDayMs)
    .reduce((s, r) => s + (Number(r.litres) || 0), 0);
  const bidonsJour = litresJour / 15;
  const litresSemaine = myRedistSemaine.reduce((s, r) => s + (Number(r.litres) || 0), 0);
  const bidonsSemaine = litresSemaine / 15;
  const litresCumul = myRedistCumul.reduce((s, r) => s + (Number(r.litres) || 0), 0);
  const bidonsCumul = litresCumul / 15;

  const ravitStatsHtml = `
    <div class="kpi-grid mb-2">
      <div class="kpi"><div class="label">Aujourd'hui</div><div class="value">${num(Math.round(litresJour))} L</div><div class="delta">${bidonsJour.toFixed(1)} bidons · depuis 00h00</div></div>
      <div class="kpi"><div class="label">Semaine en cours</div><div class="value">${num(Math.round(litresSemaine))} L</div><div class="delta">${bidonsSemaine.toFixed(1)} bidons · ${myRedistSemaine.length} ravitaillement${myRedistSemaine.length>1?'s':''}</div></div>
      <div class="kpi"><div class="label">Cumul depuis embauche</div><div class="value">${num(Math.round(litresCumul))} L</div><div class="delta">${bidonsCumul.toFixed(1)} bidons · ${myRedistCumul.length} ravitaillement${myRedistCumul.length>1?'s':''} total</div></div>
    </div>
  `;
  if (myRedistSemaine.length === 0) {
    sDiv.innerHTML = ravitStatsHtml + `<p class="muted">Aucun ravitaillement déclaré cette semaine.</p>`;
  } else {
    const tri = [...myRedistSemaine].sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
    sDiv.innerHTML = ravitStatsHtml + `
      <div class="table-scroll" style="max-height:400px;">
        <table class="data" id="table-mes-ravits">
          <thead><tr>
            <th data-sort="date">Date</th>
            <th data-sort="station">Station</th>
            <th class="right" data-sort="litres">Litres</th>
            <th class="right" data-sort="bidons">Bidons</th>
          </tr></thead>
          <tbody>
            ${tri.map(r => `
              <tr>
                <td>${datetime(r.timestamp)}</td>
                <td>${escapeHtml(r.station || r.stationId || '—')}</td>
                <td class="right mono">${num(Math.round(r.litres || 0))} L</td>
                <td class="right mono">${(Number(r.bidons) || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted mono mt-2" style="font-size:0.78rem;">
        Total semaine : ${num(Math.round(litresSemaine))} L (${bidonsSemaine.toFixed(1)} bidons)
      </p>
    `;
    makeSortable(document.getElementById('table-mes-ravits'));
  }
} else {
  // Vendeurs / direction / DRH / responsables : KPI heures de service classique.
  const enServiceBadge = serviceOuvert
    ? `<div class="alert" style="background:rgba(70,180,90,0.18);border:1px solid #5a8;font-size:0.85rem;margin-bottom:8px;">
         <span class="badge ok">En service</span> depuis ${debutOuvert.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}
         (${durationHM(dureeOuvertMs)} écoulées). Les compteurs ci-dessous incluent ce service en cours.
       </div>`
    : '';
  const heuresStatsHtml = enServiceBadge + `
    <div class="kpi-grid mb-2">
      <div class="kpi"><div class="label">Aujourd'hui</div><div class="value">${durationHM(heuresJourMs)}</div><div class="delta">depuis 00h00</div></div>
      <div class="kpi"><div class="label">Semaine en cours</div><div class="value">${durationHM(heuresMs)}</div><div class="delta">${myServicesCurr.length} session${myServicesCurr.length>1?'s':''} terminée${myServicesCurr.length>1?'s':''}${serviceOuvert ? ' + 1 en cours' : ''}</div></div>
      <div class="kpi"><div class="label">Cumul depuis embauche</div><div class="value">${durationHM(cumulMs)}</div><div class="delta">${allMyServices.length} sessions total</div></div>
    </div>
  `;
  if (myServicesCurr.length === 0) {
    sDiv.innerHTML = heuresStatsHtml + `<p class="muted">Aucune session enregistrée cette semaine.</p>`;
  } else {
    sDiv.innerHTML = heuresStatsHtml + `
      <div class="table-scroll" style="max-height:400px;">
        <table class="data" id="table-mes-services">
          <thead><tr>
            <th data-sort="debut">Début</th>
            <th data-sort="fin">Fin</th>
            <th class="right" data-sort="duree">Durée</th>
          </tr></thead>
          <tbody>
            ${myServicesCurr.map(s => `
              <tr>
                <td>${datetime(s.debut)}</td>
                <td>${datetime(s.fin)}</td>
                <td class="right mono" data-sort-value="${s.duree || 0}">${durationHM(s.duree || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted mono mt-2" style="font-size:0.78rem;">
        Total semaine : ${durationHM(heuresMs)} ${heuresMs >= 7*3600*1000 ? '≥ 7h' : '— moins de 7h (info uniquement, non bloquant)'}
      </p>
    `;
    makeSortable(document.getElementById('table-mes-services'));
  }
}

// ============================================================
// Bloc Mes notes de frais (pompistes + responsable-pompiste, mode live)
// ============================================================
if (isPompisteRavitailleur(profile.role) && !modeVoirComme) {
  const STATUT = {
    'en-attente': { label: 'En attente', cls: 'warn' },
    'approuvee':  { label: 'Approuvée',  cls: 'neutral' },
    'remboursee': { label: 'Remboursée', cls: 'ok' },
    'rejetee':    { label: 'Rejetée',    cls: 'danger' }
  };
  listenMesNotesFrais(viewedUserId, (mesNotes) => {
    const div = document.getElementById('notes-frais-perso');
    if (!div) return;
    if (mesNotes.length === 0) {
      div.innerHTML = `<p class="muted">Aucune note de frais déclarée. Clique sur "Note de frais essence" en haut de la page pour en créer une.</p>`;
      return;
    }
    const totalAttente   = mesNotes.filter(n => n.statut === 'en-attente').reduce((s, n) => s + (Number(n.montant) || 0), 0);
    const totalRemb      = mesNotes.filter(n => n.statut === 'remboursee').reduce((s, n) => s + (Number(n.montant) || 0), 0);
    div.innerHTML = `
      <div class="kpi-grid mb-2">
        <div class="kpi"><div class="label">En attente</div><div class="value">${money(totalAttente)}</div><div class="delta">${mesNotes.filter(n => n.statut === 'en-attente').length} note(s)</div></div>
        <div class="kpi kpi-bank"><div class="label">Déjà remboursé</div><div class="value">${money(totalRemb)}</div><div class="delta">${mesNotes.filter(n => n.statut === 'remboursee').length} note(s)</div></div>
      </div>
      <div class="table-scroll" style="max-height:300px;">
        <table class="data">
          <thead><tr>
            <th>Date</th>
            <th class="right">Montant</th>
            <th>Description</th>
            <th>Screenshot</th>
            <th>Statut</th>
            <th>Traitée le</th>
          </tr></thead>
          <tbody>
            ${mesNotes.map(n => {
              const st = STATUT[n.statut] || { label: n.statut, cls: 'neutral' };
              const dateTraitee = n.dateRemboursement || n.traiteeAt;
              const motifLine = n.motifRejet
                ? `<div class="muted" style="font-size:0.72rem;color:var(--color-blood-light, #d88);">Motif : ${escapeHtml(n.motifRejet)}</div>`
                : '';
              return `
                <tr>
                  <td class="mono" style="font-size:0.78rem;">${datetime(n.timestamp)}</td>
                  <td class="right mono"><strong>${money(n.montant || 0)}</strong></td>
                  <td style="max-width:240px;">${escapeHtml(n.description || '—')}${motifLine}</td>
                  <td><a href="${escapeHtml(n.screenshotUrl || '#')}" target="_blank" rel="noopener" class="btn btn-sm">Voir</a></td>
                  <td><span class="badge ${st.cls}">${st.label}</span></td>
                  <td class="muted" style="font-size:0.78rem;">${dateTraitee ? datetime(dateTraitee) : '—'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  });
}
