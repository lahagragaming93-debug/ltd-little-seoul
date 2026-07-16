// ============================================================
// Page : Administration (Direction, DRH, Responsables)
// Le périmètre des actions est filtré par canManageUser().
// ============================================================

import { requireAuth, creerCompteEmploye, genererMotDePasseProvisoire,
         getViewAsRole, setViewAsRole, clearViewAsRole } from '../auth.js';
import { renderShell } from '../layout.js';
import { listenUsers, updateUser, deleteUser, logSite, getConfig, setConfig, getSecrets, setSecrets, listEmbauchesEnAttente, marquerEmbaucheTraitee,
         listAvertissements, listenAvertissementsActifs, creerAvertissement, retirerAvertissement } from '../api.js';
import { ROLE_LABELS, ROLES, canManageUser, assignableRoles, canEditConfig, canAccess, isDirection, isSuperAdmin } from '../utils/permissions.js';
import { date, escapeHtml, normalizePrenom, normalizeNom, dateKeyLocal } from '../utils/formatters.js';
import { toastSuccess, toastError } from '../utils/toast.js';
import { confirmCritique, infoModal } from '../utils/confirmation.js';
import { wrapScroll, makeSortable } from '../utils/sortable-table.js';

const { profile } = await requireAuth('admin');
const myAssignableRoles = assignableRoles(profile.role);
const canCreate         = myAssignableRoles.length > 0;
const canEditCfg        = canEditConfig(profile.role);

// Périmètre lisible affiché à l'utilisateur
function perimetreText(role) {
  if (role === 'patron')                return 'Tu peux gérer TOUS les comptes.';
  if (role === 'co-patron')             return 'Tu peux gérer tous les comptes sauf le Patron.';
  if (role === 'drh')                   return 'Tu peux gérer tous les comptes sauf le Patron et le Co-Patron.';
  if (role === 'responsable-vente')     return 'Tu peux gérer uniquement les vendeurs (Novice / Intermédiaire / Expérimenté) et les livreurs.';
  if (role === 'responsable-pompiste')  return 'Tu peux gérer uniquement les pompistes (Novice / Intermédiaire / Expérimenté).';
  return 'Aucun périmètre de gestion.';
}

const html = `
  <div class="alert info mb-2">
    <span>${perimetreText(profile.role)} Les comptes hors de ton périmètre sont visibles en lecture seule (actions grisées).</span>
  </div>

  <div class="page-toolbar">
    ${canCreate ? `<button class="btn btn-primary btn-compact" id="btn-nouveau" title="Créer un compte employé" data-tooltip="Créer un compte">+ Créer un compte</button>` : ''}
    ${canEditCfg ? `<button class="btn" id="btn-config-globale" title="Configuration globale" data-tooltip="Config globale">Config</button>` : ''}
    ${canEditCfg ? `<button class="btn" id="btn-export-sheets" title="Export Google Sheets" data-tooltip="Export Sheets">Export Sheets</button>` : ''}
    ${canEditCfg ? `<a href="decouverte-items.html" class="btn" title="Découverte items FiveM" data-tooltip="Découverte items">Items FiveM</a>` : ''}
    ${['patron', 'co-patron', 'admin-technique'].includes(profile.roleReel) ? `
      <span class="toolbar-sep"></span>
      <select id="select-view-as" title="Voir le site comme un autre rôle (test, ne change rien en base)" style="max-width:240px;">
        <option value="">Voir comme… (${escapeHtml(ROLE_LABELS[profile.roleReel])})</option>
        ${Object.entries(ROLE_LABELS)
          .filter(([r]) => r !== profile.roleReel)
          .map(([r, label]) => `<option value="${escapeHtml(r)}">${escapeHtml(label)}</option>`).join('')}
      </select>
    ` : ''}
  </div>

  <!-- Embauches à traiter (alimentées par #auto-rh) -->
  ${canCreate ? `
    <div class="panel framed" id="panel-embauches" style="border-color:var(--color-gold);display:none;">
      <div class="panel-title">
        <span>Embauches à traiter</span>
        <span class="muted" style="font-size:0.75rem;" id="embauches-count">—</span>
      </div>
      <p class="muted" style="font-size:0.85rem;margin:4px 0 8px;">
        Les embauches détectées dans <code>#auto-rh</code> sont listées ici.
        Clique <strong>« Créer le compte »</strong> pour ouvrir le formulaire pré-rempli avec les IDs déjà capturés.
      </p>
      <div class="table-scroll" style="max-height:400px;">
        <table class="data" id="table-embauches">
          <thead>
            <tr>
              <th data-sort="date">Date détection</th>
              <th data-sort="nom">Nom</th>
              <th data-sort="discord">ID Discord</th>
              <th data-sort="perso">ID Perso</th>
              <th class="center">Actions</th>
            </tr>
          </thead>
          <tbody id="tbody-embauches"><tr><td colspan="5" class="muted text-center">Chargement…</td></tr></tbody>
        </table>
      </div>
    </div>
  ` : ''}

  <div class="panel framed">
    <div class="panel-title"><span>Comptes utilisateurs</span></div>
    <div class="table-scroll">
      <table class="data" id="table-users">
        <thead>
          <tr>
            <th data-sort="nom">Nom</th>
            <th data-sort="username">Identifiant</th>
            <th data-sort="role">Rôle</th>
            <th data-sort="discord">ID Discord</th>
            <th data-sort="perso">ID Perso</th>
            <th data-sort="entree">Entrée</th>
            <th data-sort="statut">Statut</th>
            <th data-sort="averts" class="center">Averts</th>
            <th class="center">Actions</th>
          </tr>
        </thead>
        <tbody id="tbody-users"><tr><td colspan="9" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  ${canEditCfg ? `
  <!-- Mapping fournisseurs déductibilité (direction uniquement) -->
  <div class="panel framed" id="panel-fournisseurs" style="border-color:var(--color-info);">
    <div class="panel-title">
      <span>Mapping fournisseurs (auto-classification dépenses)</span>
      <button class="btn btn-sm" id="btn-nouveau-fournisseur" title="Ajouter un pattern fournisseur" data-tooltip="Ajouter pattern">+ Ajouter</button>
    </div>
    <p class="muted" style="font-size:0.82rem;margin:4px 0 8px;">
      Ces patterns servent à <strong>auto-classer</strong> les dépenses entrantes selon leur fournisseur destinataire. Quand une dépense match un pattern, sa catégorie + déductibilité sont suggérées automatiquement. Le patron valide ensuite chaque dépense dans la <a href="comptabilite.html">page Compta</a>.
    </p>
    <div class="table-scroll">
      <table class="data" id="table-fournisseurs">
        <thead>
          <tr>
            <th>Label</th>
            <th>Type match</th>
            <th>Valeur</th>
            <th>Catégorie</th>
            <th class="center">Déductible</th>
            <th>Justification</th>
            <th class="center">Action</th>
          </tr>
        </thead>
        <tbody id="tbody-fournisseurs"><tr><td colspan="7" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Modal édition pattern fournisseur -->
  <div id="modal-fournisseur" class="modal-backdrop hidden">
    <div class="modal" style="max-width:600px;">
      <h3 id="modal-fournisseur-title">Ajouter un pattern fournisseur</h3>
      <input type="hidden" id="fournisseur-original-id" />

      <label>Label affiché <span class="muted" style="font-size:0.75rem;">— ex : HDM (Heavy Duty Motors)</span></label>
      <input type="text" id="fournisseur-label" required />

      <div class="field-row">
        <div>
          <label>Type de match</label>
          <select id="fournisseur-matchtype">
            <option value="account-id-cible">Account ID compte cible (ex: 67978 pour HDM — recommandé)</option>
            <option value="compte-cible">Nom du compte cible (HDM, Dynasty 8…)</option>
            <option value="boutique-id">Numéro boutique (Achat boutique N°XXX)</option>
            <option value="facture-id">Numéro facture (Paiement facture N°XXXXXXX)</option>
            <option value="raison-regex">Regex sur la raison (ex: ^achat essence$)</option>
          </select>
        </div>
        <div>
          <label>Valeur à matcher <span class="muted" style="font-size:0.7rem;">— plusieurs séparées par virgule (ex: 263,264,266)</span></label>
          <input type="text" id="fournisseur-matchvalue" placeholder="Ex: 263 ou 263,264,266" required />
        </div>
      </div>

      <label>Catégorie</label>
      <select id="fournisseur-categorie">
        <option value="matieres-premieres">Matières premières (déductible)</option>
        <option value="frais-avocat">Frais avocat (déductible jusqu'à 30 000 $, surplus auto en non déd.)</option>
        <option value="frais-comptabilite">Frais comptabilité (déductible jusqu'à 8 000 $, surplus auto en non déd.)</option>
        <option value="entretien-vehicules">Entretien véhicules (déductible)</option>
        <option value="location-vehicule">Location véhicule (déductible)</option>
        <option value="achat-vehicule">Achat véhicule (déductible)</option>
        <option value="frais-vehicule">Frais véhicule / essence (déductible)</option>
        <option value="loyer">Loyer (déductible)</option>
        <option value="nourriture-employes">Nourriture employés (max 750$/employé)</option>
        <option value="don-verse">Don versé</option>
        <option value="subvention">Subvention reçue</option>
        <option value="autre-deductible">Autre déductible</option>
        <option value="decoration-locaux">Décoration locaux (non déductible)</option>
        <option value="non-deductible">Non déductible (autre)</option>
      </select>

      <div class="row" style="gap:8px;margin-top:8px;">
        <label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="fournisseur-deductible" value="true" id="fournisseur-dedu-oui" checked />
          Déductible
        </label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="radio" name="fournisseur-deductible" value="false" id="fournisseur-dedu-non" />
          Non déductible
        </label>
      </div>

      <label class="mt-2">Justification (audit IRS)</label>
      <input type="text" id="fournisseur-justification" placeholder="Ex : Fournisseur matière 1ère revente clients" />

      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save-fournisseur">Enregistrer</button>
        <button class="btn btn-danger" id="btn-delete-fournisseur" style="display:none;">Supprimer</button>
        <button class="btn btn-ghost" id="btn-cancel-fournisseur">Annuler</button>
      </div>
    </div>
  </div>

  <!-- Engagements de remboursement (subventions, dettes…) -->
  <div class="panel framed" id="panel-engagements" style="border-color:var(--color-warning);">
    <div class="panel-title">
      <span>Engagements de remboursement</span>
      <button class="btn btn-sm" id="btn-nouveau-engagement" title="Ajouter un engagement" data-tooltip="Ajouter engagement">+ Ajouter</button>
    </div>
    <p class="muted" style="font-size:0.82rem;margin:4px 0 8px;">
      Subventions reçues à rembourser, dettes contractées, contrats avec échéance. Le système décrémente automatiquement le restant quand une dépense de remboursement est captée (raison contenant "remboursement subvention/essence/dette"). Alerte direction 7 jours avant échéance.
    </p>
    <div class="table-scroll">
      <table class="data" id="table-engagements">
        <thead>
          <tr>
            <th>Bénéficiaire</th>
            <th>Objet</th>
            <th class="right">Montant initial</th>
            <th class="right">Remboursé</th>
            <th class="right">Restant</th>
            <th>Échéance</th>
            <th class="center">Jours</th>
            <th class="center">Statut</th>
            <th class="center">Action</th>
          </tr>
        </thead>
        <tbody id="tbody-engagements"><tr><td colspan="9" class="muted text-center">Chargement…</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Modal édition engagement -->
  <div id="modal-engagement" class="modal-backdrop hidden">
    <div class="modal" style="max-width:680px;max-height:92vh;overflow-y:auto;">
      <h3 id="modal-engagement-title">Ajouter un engagement</h3>
      <input type="hidden" id="engagement-original-id" />

      <div class="field-row">
        <div><label>Bénéficiaire</label><input type="text" id="engagement-beneficiaire" placeholder="Ex : Governor of San Andreas (IRS)" required /></div>
        <div><label>Signataire</label><input type="text" id="engagement-signataire" placeholder="Ex : Abraham THORPE" /></div>
      </div>

      <label>Objet du contrat</label>
      <input type="text" id="engagement-objet" placeholder="Ex : Subvention Essence à rembourser (TTE Art. 4-2.16 sous réserve)" required />

      <div class="field-row">
        <div><label>Type</label>
          <select id="engagement-type">
            <option value="subvention-rembours">Subvention remboursable</option>
            <option value="dette-fournisseur">Dette fournisseur</option>
            <option value="contrat-leasing">Contrat leasing</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <div><label>Montant initial ($)</label><input type="number" id="engagement-montant" min="0" step="1" required /></div>
      </div>

      <div class="field-row">
        <div><label>Date réception</label><input type="date" id="engagement-date-reception" required /></div>
        <div><label>Date échéance</label><input type="date" id="engagement-date-echeance" required /></div>
      </div>

      <div class="field-row" id="engagement-edit-fields" style="display:none;">
        <div><label>Montant déjà remboursé ($)</label><input type="number" id="engagement-montant-rembourse" min="0" step="1" /></div>
        <div><label>Statut</label>
          <select id="engagement-statut">
            <option value="actif">Actif</option>
            <option value="rembourse">Remboursé</option>
            <option value="defaillant">Défaillant</option>
            <option value="annule">Annulé</option>
          </select>
        </div>
      </div>

      <label>Notes / Justification audit IRS</label>
      <textarea id="engagement-notes" rows="3" placeholder="Détails du contrat, conditions, références..."></textarea>

      <div id="engagement-historique-zone" style="display:none;margin-top:12px;padding:8px;background:rgba(0,0,0,0.03);border-radius:4px;">
        <strong style="font-size:0.85rem;">Historique des remboursements</strong>
        <div id="engagement-historique-list" style="font-size:0.78rem;margin-top:4px;"></div>
      </div>

      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save-engagement">Enregistrer</button>
        <button class="btn btn-warning" id="btn-rembourser-engagement" style="display:none;">Ajouter un remboursement</button>
        <button class="btn btn-danger" id="btn-delete-engagement" style="display:none;">Supprimer</button>
        <button class="btn btn-ghost" id="btn-cancel-engagement">Annuler</button>
      </div>
    </div>
  </div>

  <!-- Modal ajout remboursement -->
  <div id="modal-rembours" class="modal-backdrop hidden">
    <div class="modal" style="max-width:480px;">
      <h3>Ajouter un remboursement manuel</h3>
      <p class="muted" style="font-size:0.82rem;">
        Pour les remboursements détectés automatiquement (via dépense Discord avec raison « remboursement subvention »), pas besoin de cette modale.
        Utilise ici uniquement pour les régularisations manuelles.
      </p>
      <label>Montant remboursé ($)</label>
      <input type="number" id="rembours-montant" min="1" step="1" required />
      <label>Raison / Note</label>
      <input type="text" id="rembours-raison" placeholder="Ex : Virement IRS du 15/05/2026" />
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-confirm-rembours">Valider le remboursement</button>
        <button class="btn btn-ghost" id="btn-cancel-rembours">Annuler</button>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Modal création compte -->
  <div id="modal-new" class="modal-backdrop hidden">
    <div class="modal" style="max-width:520px;">
      <h3>Créer un compte</h3>
      <div class="field-row">
        <div><label>Prénom RP</label><input type="text" id="new-prenom" required /></div>
        <div><label>NOM RP</label><input type="text" id="new-nom" required style="text-transform:uppercase;" /></div>
      </div>
      <label>Nom d'utilisateur <span class="muted" style="font-size:0.75rem;">— l'identifiant que l'employé utilisera pour se connecter (3-30 caractères, lettres/chiffres/. _ -)</span></label>
      <input type="text" id="new-username" required placeholder="ex: blake.mars" autocapitalize="off" />
      <div class="field-row">
        <div><label>ID Discord</label><input type="text" id="new-id-discord" /></div>
        <div><label>ID Perso (in-game)</label><input type="text" id="new-id-perso" /></div>
      </div>
      <label>Rôle</label>
      <select id="new-role">
        ${myAssignableRoles.map(k => `<option value="${k}">${ROLE_LABELS[k]}</option>`).join('')}
      </select>
      <label>Mot de passe provisoire</label>
      <div class="row">
        <input type="text" id="new-mdp" style="flex:1;" />
        <button class="btn btn-sm" id="btn-gen-mdp" type="button" title="Générer un mot de passe" data-tooltip="Générer">Générer</button>
      </div>
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-creer">Créer</button>
        <button class="btn btn-ghost" id="btn-cancel-new">Annuler</button>
      </div>
      <div class="alert info mt-3 hidden" id="alert-credentials">
        <div>
          Compte créé. <strong>Transmettre à l'employé :</strong>
          <div class="mono mt-1">Identifiant : <span id="cred-username"></span></div>
          <div class="mono">Mot de passe : <span id="cred-mdp"></span></div>
          <div class="muted mt-1" style="font-size:0.75rem;">À sa première connexion, il devra définir son mot de passe permanent.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal édition compte -->
  <div id="modal-edit" class="modal-backdrop hidden">
    <div class="modal" style="max-width:520px;">
      <h3>Modifier le compte</h3>
      <input type="hidden" id="edit-uid" />
      <p class="muted mono" style="font-size:0.75rem;">Identifiant : <span id="edit-email-readonly">—</span> <em>(non modifiable ici)</em></p>
      <div class="field-row">
        <div><label>Prénom RP</label><input type="text" id="edit-prenom" /></div>
        <div><label>NOM RP</label><input type="text" id="edit-nom" style="text-transform:uppercase;" /></div>
      </div>
      <div class="field-row">
        <div><label>ID Discord</label><input type="text" id="edit-id-discord" /></div>
        <div><label>ID Perso (in-game)</label><input type="text" id="edit-id-perso" /></div>
      </div>
      <label>Date d'entrée</label>
      <input type="date" id="edit-date-entree" />
      <label style="margin-top:12px;">Accès &amp; permissions <span class="muted" style="font-size:0.72rem;">— coche ce que tu veux donner EN PLUS du rôle</span></label>
      <div id="edit-acces" style="display:grid;grid-template-columns:1fr 1fr;gap:3px 16px;background:rgba(0,0,0,0.18);padding:9px 11px;border-radius:6px;max-height:220px;overflow:auto;"></div>
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save-edit">Enregistrer</button>
        <button class="btn btn-ghost" id="btn-cancel-edit">Annuler</button>
      </div>
    </div>
  </div>

  <!-- Modal export Google Sheets -->
  <div id="modal-sheets" class="modal-backdrop hidden">
    <div class="modal" style="max-width: 720px;">
      <h3>Export Google Sheets — Comptabilité temps réel</h3>

      <div class="alert info mb-2" style="font-size:0.85rem;">
        <div>
          La fonction <code>comptaExport</code> sert un CSV temps réel. Tu colles une formule <code>=IMPORTDATA(URL)</code> dans Google Sheets, et le Sheet se met à jour tout seul.<br><br>
          <strong>Le Sheet est en lecture seule</strong> — la modification reste sur le site (autorité de référence).
        </div>
      </div>

      <div id="sheets-token-zone">
        <p class="muted">Chargement…</p>
      </div>

      <div class="row mt-3">
        <button class="btn btn-ghost" id="btn-cancel-sheets">Fermer</button>
      </div>
    </div>
  </div>

  <!-- Modal avertissements -->
  <div id="modal-averts" class="modal-backdrop hidden">
    <div class="modal" style="max-width:680px;">
      <h3>Avertissements de <span id="averts-employe">—</span></h3>
      <div class="alert info mb-2" style="font-size:0.82rem;">
        <span>3 avertissements actifs = compte automatiquement bloqué (peut consulter mais plus aucune écriture). Retirer un avertissement débloque immédiatement le compte.</span>
      </div>
      <div class="row mb-2">
        <button class="btn btn-primary btn-sm" id="btn-nouvel-avert">+ Nouvel avertissement</button>
        <span class="spacer"></span>
        <span class="muted mono" id="averts-count-modal">—</span>
      </div>
      <div id="modal-nouvel-avert" class="hidden" style="background:rgba(0,0,0,0.18);padding:10px;border-radius:6px;margin-bottom:10px;">
        <label>Motif</label>
        <textarea id="nouvel-avert-motif" rows="2" placeholder="ex: Quota bidons non atteint (1200/1700)"></textarea>
        <div class="row mt-2">
          <button class="btn btn-primary btn-sm" id="btn-creer-avert">Créer l'avertissement</button>
          <button class="btn btn-ghost btn-sm" id="btn-annuler-avert">Annuler</button>
        </div>
      </div>
      <div class="table-scroll" style="max-height:380px;">
        <table class="data" id="table-averts">
          <thead>
            <tr>
              <th>Date</th>
              <th>Motif</th>
              <th>Source</th>
              <th>Par</th>
              <th class="center">Statut</th>
              <th class="center">Action</th>
            </tr>
          </thead>
          <tbody id="tbody-averts"><tr><td colspan="6" class="muted text-center">Chargement…</td></tr></tbody>
        </table>
      </div>
      <div class="row mt-3">
        <button class="btn btn-ghost" id="btn-cancel-averts">Fermer</button>
      </div>
    </div>
  </div>

  <!-- Modal config globale -->
  <div id="modal-config" class="modal-backdrop hidden">
    <div class="modal" style="max-width: 580px;">
      <h3>Configuration globale</h3>
      <div class="field-row">
        <div><label>Quota bidons / pompiste / sem</label><input type="number" id="cfg-bidons" /></div>
        <div><label>Quota caoutchoucs / pompiste / sem</label><input type="number" id="cfg-caoutchoucs" /></div>
      </div>
      <div class="field-row">
        <div><label>Prix essence par défaut ($/L)</label><input type="number" id="cfg-prix" step="0.1" /></div>
        <div><label>Seuil alerte essence (L)</label><input type="number" id="cfg-seuil" /></div>
      </div>
      <label>Webhook Discord pour alertes (optionnel)</label>
      <input type="url" id="cfg-webhook" placeholder="https://discord.com/api/webhooks/..." />
      <p class="muted" style="font-size:0.75rem;margin-top:4px;">
        Crée un webhook Discord (paramètres canal → Intégrations → Webhooks) et colle l'URL ici.
        Toutes les alertes (rupture stock, masse > 90 %, etc.) seront postées dans ce canal.
      </p>
      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-save-cfg">Enregistrer</button>
        <button class="btn btn-ghost" id="btn-cancel-cfg">Annuler</button>
      </div>
    </div>
  </div>
`;
renderShell(profile, 'admin', html);

makeSortable(document.getElementById('table-users'));
makeSortable(document.getElementById('table-embauches'));

let users = [];
listenUsers(list => {
  users = list;
  renderUsers();
  appliquerCompteursAverts();
});

// === Compteurs avertissements actifs en temps reel ===
// Maintient un Map uid -> nb d'averts actifs et met a jour les cellules
// .data-averts-cell des lignes users.
let avertsActifsParUser = new Map();
listenAvertissementsActifs(list => {
  const m = new Map();
  for (const a of list) {
    m.set(a.employeId, (m.get(a.employeId) || 0) + 1);
  }
  avertsActifsParUser = m;
  appliquerCompteursAverts();
});

function appliquerCompteursAverts() {
  document.querySelectorAll('[data-averts-cell]').forEach(td => {
    const uid = td.dataset.avertsCell;
    const n = avertsActifsParUser.get(uid) || 0;
    const cls = n === 0 ? 'ok' : n >= 3 ? 'danger' : n === 2 ? 'warn' : 'info';
    const label = n === 0 ? '0' : `${n}`;
    td.innerHTML = `<button class="btn btn-sm" data-averts-btn="${uid}" title="Voir les avertissements"><span class="badge ${cls}">${label}</span></button>`;
  });
  // Re-binder les boutons (le innerHTML les recree)
  document.querySelectorAll('[data-averts-btn]').forEach(btn => {
    btn.addEventListener('click', () => ouvrirAvertissements(btn.dataset.avertsBtn));
  });
}

// === Modal avertissements ===
let avertsCurrentUid = null;
async function ouvrirAvertissements(uid) {
  const u = users.find(x => x.id === uid);
  if (!u) return;
  avertsCurrentUid = uid;
  document.getElementById('averts-employe').textContent = `${u.prenom || ''} ${u.nom || ''}`.trim() || u.username || uid;
  document.getElementById('modal-nouvel-avert').classList.add('hidden');
  document.getElementById('nouvel-avert-motif').value = '';
  document.getElementById('modal-averts').classList.remove('hidden');
  await chargerAvertsModal(uid);
}

async function chargerAvertsModal(uid) {
  const tbody = document.getElementById('tbody-averts');
  tbody.innerHTML = `<tr><td colspan="6" class="muted text-center">Chargement…</td></tr>`;
  let list = [];
  try { list = await listAvertissements(uid); }
  catch (e) { console.error(e); tbody.innerHTML = `<tr><td colspan="6" class="muted text-center">Erreur de chargement.</td></tr>`; return; }
  const actifs = list.filter(a => a.actif).length;
  document.getElementById('averts-count-modal').textContent = `${actifs} actif${actifs > 1 ? 's' : ''} / ${list.length} total`;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted text-center">Aucun avertissement.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(a => {
    const d = a.dateCreation?.toDate ? a.dateCreation.toDate() : null;
    const dRetrait = a.dateRetrait?.toDate ? a.dateRetrait.toDate() : null;
    const dateStr = d ? date(d) : '—';
    const source = a.auto ? '<span class="badge info">auto</span>' : '<span class="badge">manuel</span>';
    const statut = a.actif
      ? '<span class="badge danger">ACTIF</span>'
      : `<span class="badge ok">retiré ${dRetrait ? date(dRetrait) : ''}</span>`;
    const action = a.actif
      ? `<button class="btn btn-sm" data-retirer-avert="${a.id}">Retirer</button>`
      : `<span class="muted mono" style="font-size:0.75rem;">par ${escapeHtml(a.parQuiRetraitNom || '—')}</span>`;
    return `<tr>
      <td class="mono" style="font-size:0.8rem;">${dateStr}</td>
      <td>${escapeHtml(a.motif || '')}</td>
      <td>${source}</td>
      <td>${escapeHtml(a.parQuiNom || '—')}</td>
      <td class="center">${statut}</td>
      <td class="center">${action}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-retirer-avert]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmCritique({
        titre: "Retirer cet avertissement",
        message: "L'avertissement sera marqué comme retiré (audit conservé). Si l'employé était bloqué et passe sous 3 avertissements actifs, son compte sera <strong>débloqué immédiatement</strong>.",
        btnConfirm: "Retirer l'avertissement",
        delaiSec: 2
      });
      if (!ok) return;
      try {
        await retirerAvertissement(btn.dataset.retirerAvert, profile.id, `${profile.prenom || ''} ${profile.nom || ''}`.trim());
        toastSuccess("Avertissement retiré.");
        await chargerAvertsModal(uid);
      } catch (e) { toastError(e?.message || "Erreur."); }
    });
  });
}

document.getElementById('btn-cancel-averts').addEventListener('click', () => {
  document.getElementById('modal-averts').classList.add('hidden');
  avertsCurrentUid = null;
});
document.getElementById('btn-nouvel-avert').addEventListener('click', () => {
  document.getElementById('modal-nouvel-avert').classList.remove('hidden');
  document.getElementById('nouvel-avert-motif').focus();
});
document.getElementById('btn-annuler-avert').addEventListener('click', () => {
  document.getElementById('modal-nouvel-avert').classList.add('hidden');
  document.getElementById('nouvel-avert-motif').value = '';
});
document.getElementById('btn-creer-avert').addEventListener('click', async () => {
  const motif = document.getElementById('nouvel-avert-motif').value.trim();
  if (!motif) return toastError("Indique un motif.");
  if (!avertsCurrentUid) return;
  const u = users.find(x => x.id === avertsCurrentUid);
  try {
    await creerAvertissement({
      employeId: avertsCurrentUid,
      employeNom: `${u?.prenom || ''} ${u?.nom || ''}`.trim(),
      motif,
      parQui: profile.id,
      parQuiNom: `${profile.prenom || ''} ${profile.nom || ''}`.trim(),
      auto: false
    });
    toastSuccess("Avertissement créé.");
    document.getElementById('modal-nouvel-avert').classList.add('hidden');
    document.getElementById('nouvel-avert-motif').value = '';
    await chargerAvertsModal(avertsCurrentUid);
  } catch (e) { toastError(e?.message || "Erreur."); }
});

function renderUsers() {
  const tbody = document.getElementById('tbody-users');
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted text-center">Aucun compte.</td></tr>`;
    return;
  }
  // Patron et Admin Technique peuvent éditer leur propre compte (changer leur rôle).
  // Les autres rôles ne peuvent pas se gérer eux-mêmes (évite l'auto-élévation).
  const canManageSelf = profile.role === 'patron' || isSuperAdmin(profile.role);

  tbody.innerHTML = users.map(u => {
    const isSelf       = u.id === profile.id;
    const canManage    = canManageUser(profile.role, u.role) && (!isSelf || canManageSelf);
    // Liste des rôles assignables : intersect avec ce que je peux gérer
    const roleOptions  = myAssignableRoles
      .map(k => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${ROLE_LABELS[k]}</option>`)
      .join('');
    // Si le rôle actuel n'est pas dans mes assignables, l'ajouter en option désactivée
    const currentRoleHtml = !myAssignableRoles.includes(u.role)
      ? `<option value="${u.role}" selected disabled>${ROLE_LABELS[u.role] || u.role} (hors périmètre)</option>`
      : '';
    const roleSelectAttr = canManage ? '' : 'disabled';
    const tooltipHors    = canManage ? '' : 'title="Hors de ton périmètre de gestion"';

    return `
    <tr ${canManage ? '' : 'class="row-readonly"'}>
      <td><strong>${escapeHtml(u.prenom)} ${escapeHtml(u.nom)}</strong></td>
      <td class="mono">${escapeHtml(u.username || u.email || '—')}</td>
      <td>
        <select data-role="${u.id}" data-old-role="${u.role}" ${roleSelectAttr} ${tooltipHors}>
          ${currentRoleHtml}${roleOptions}
        </select>
      </td>
      <td class="mono">${escapeHtml(u.idDiscord || '—')}</td>
      <td class="mono">${escapeHtml(u.idPerso || '—')}</td>
      <td>${u.dateEntree || '—'}</td>
      <td>
        <span class="badge ${u.statut === 'actif' ? 'ok' : 'warn'}">${u.statut || 'actif'}</span>
      </td>
      <td class="center" data-averts-cell="${u.id}">
        <span class="muted">…</span>
      </td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-ghost" data-edit-user="${u.id}" ${canManage ? '' : 'disabled'} title="Modifier les infos" data-tooltip="Modifier">Modifier</button>
        <button class="btn btn-sm" data-regen-mdp="${u.id}" ${canManage ? '' : 'disabled'} title="Régénérer le mot de passe" data-tooltip="Nouveau MDP">Nouveau MDP</button>
        ${u.statut !== 'suspendu'
          ? `<button class="btn btn-sm" data-suspend="${u.id}" ${(canManage && !isSelf) ? '' : 'disabled'} title="${isSelf ? 'Tu ne peux pas te suspendre toi-même' : 'Suspendre (licenciement)'}" data-tooltip="Suspendre">Suspendre</button>`
          : `<button class="btn btn-sm" data-reactiver="${u.id}" ${canManage ? '' : 'disabled'} title="Réactiver" data-tooltip="Réactiver">Réactiver</button>`}
        <button class="btn btn-sm btn-danger" data-delete="${u.id}" ${(canManage && !isSelf) ? '' : 'disabled'} title="${isSelf ? 'Tu ne peux pas te supprimer toi-même' : 'Supprimer le compte'}" data-tooltip="Supprimer">Supprimer</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-role]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const uid = sel.dataset.role;
      const ancien = sel.dataset.oldRole;
      const nouveau = sel.value;
      // Garde-fou : si quelqu'un bidouille le DOM, refuser un rôle hors périmètre
      if (!canManageUser(profile.role, ancien) || !canManageUser(profile.role, nouveau)) {
        sel.value = ancien;
        toastError("Ce changement de rôle est hors de ton périmètre.");
        return;
      }
      const direction = (r) => r === 'patron' || r === 'co-patron';
      // Confirmation pour tout changement impliquant Patron/Co-Patron
      if (direction(ancien) || direction(nouveau)) {
        const sens = direction(nouveau) && !direction(ancien) ? 'PROMOTION direction'
                   : direction(ancien) && !direction(nouveau) ? 'rétrogradation depuis direction'
                   : 'changement entre rôles direction';
        const ok = await confirmCritique({
          titre: 'Changement de rôle direction',
          message: `<strong>${sens}</strong><br><br>
            Ancien rôle : <strong>${escapeHtml(ROLE_LABELS[ancien] || ancien)}</strong><br>
            Nouveau rôle : <strong>${escapeHtml(ROLE_LABELS[nouveau] || nouveau)}</strong><br><br>
            Ce changement modifie les <strong>droits d'accès complets</strong> de cet utilisateur (admin, comptabilité, configuration globale, suppression de comptes).`,
          btnConfirm: 'Appliquer le changement',
          delaiSec: 3
        });
        if (!ok) {
          sel.value = ancien;
          return;
        }
      }
      try {
        await updateUser(uid, { role: nouveau });
        sel.dataset.oldRole = nouveau;
        toastSuccess("Rôle mis à jour.");
      } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); console.error(e); }
    });
  });
  tbody.querySelectorAll('[data-suspend]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmCritique({
        titre: 'Suspendre le compte',
        message: 'La suspension d\'un compte équivaut à un <strong>licenciement</strong>.<br><br>L\'employé perdra immédiatement l\'accès au site (déconnexion forcée à sa prochaine action). Le compte reste consultable et peut être réactivé.',
        btnConfirm: 'Suspendre le compte',
        delaiSec: 3
      });
      if (!ok) return;
      try {
        await updateUser(btn.dataset.suspend, { statut: 'suspendu' });
        toastSuccess("Compte suspendu.");
      } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); }
    });
  });
  tbody.querySelectorAll('[data-reactiver]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateUser(btn.dataset.reactiver, { statut: 'actif' });
        toastSuccess("Compte réactivé.");
      } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); }
    });
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmCritique({
        titre: 'Supprimer définitivement',
        message: 'Cette action <strong>supprime définitivement</strong> le compte de l\'utilisateur : sa <strong>fiche</strong> ET son <strong>compte de connexion</strong> (login/email) sont supprimés — ce qui libère l\'identifiant pour une éventuelle recréation.<br><br>Les données déjà enregistrées (ventes, paies, services) ne sont PAS supprimées (audit TTE).',
        btnConfirm: 'Supprimer le compte',
        delaiSec: 3,
        requireType: 'SUPPRIMER'
      });
      if (!ok) return;
      try {
        const { auth } = await import('../firebase-config.js');
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net/supprimerEmploye', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
          body: JSON.stringify({ targetUid: btn.dataset.delete })
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
        toastSuccess("Compte supprimé (fiche + login).");
      } catch (e) { toastError(e?.message || e?.code || "Erreur inattendue."); }
    });
  });

  tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
    btn.addEventListener('click', () => ouvrirEdition(btn.dataset.editUser));
  });

  // === Bouton Régénérer mot de passe ===
  tbody.querySelectorAll('[data-regen-mdp]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.regenMdp;
      const u = users.find(x => x.id === uid);
      if (!u) return;
      const ok = await confirmCritique({
        titre: 'Régénérer le mot de passe',
        message: `Un <strong>nouveau mot de passe aléatoire</strong> sera généré pour <strong>${escapeHtml(u.prenom)} ${escapeHtml(u.nom)}</strong>.<br><br>
          L'ancien mot de passe sera <strong>immédiatement invalidé</strong> et tu devras transmettre le nouveau à l'employé (Discord, in-game…).<br>
          À sa prochaine connexion, il sera obligé de choisir son propre mot de passe.`,
        btnConfirm: 'Régénérer le mot de passe',
        delaiSec: 3
      });
      if (!ok) return;

      try {
        const { auth } = await import('../firebase-config.js');
        const idToken = await auth.currentUser.getIdToken();
        const resp = await fetch('https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net/adminResetPassword', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
          body: JSON.stringify({ targetUid: uid })
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
        await infoModal({
          titre: 'Mot de passe régénéré',
          message: `<strong>Transmettre à ${escapeHtml(u.prenom)} ${escapeHtml(u.nom)} :</strong>
            <div class="mono mt-2">Identifiant : <strong>${escapeHtml(u.username || '—')}</strong></div>
            <div class="mono">Mot de passe : <strong>${escapeHtml(json.password)}</strong></div>
            <div class="muted mt-2" style="font-size:0.78rem;">À sa prochaine connexion, il devra définir son mot de passe permanent.</div>`,
          type: 'info'
        });
      } catch (err) {
        console.error('regen-mdp FAIL:', err);
        toastError(err.message || 'Erreur lors de la régénération.');
      }
    });
  });
}

// === Édition d'un compte ===
// Pages dont l'acces peut etre accorde individuellement (en plus du role).
// Cles = celles utilisees par requireAuth de chaque page (cf. pages/*.js).
const PAGES_GERABLES = [
  { key: 'dashboard',         label: 'Dashboard' },
  { key: 'stocks_epicerie',   label: 'Stocks épicerie' },
  { key: 'stocks_essence',    label: 'Stations essence' },
  { key: 'ventes',            label: 'Ventes' },
  { key: 'comptabilite',      label: 'Comptabilité' },
  { key: 'banque',            label: 'Banque LTD' },
  { key: 'rh',                label: 'Ressources humaines' },
  { key: 'revenus_carburant', label: 'Revenus carburant' },
  { key: 'notes_frais',       label: 'Notes de frais' },
  { key: 'admin',             label: 'Administration' }
];

// Permissions de MODIFICATION accordables individuellement (au-delà de la simple
// consultation d'une page). Même mécanique additive que les accès (champ accesSupp).
const PERMS_GERABLES = [
  { key: 'stocks_edit', label: 'Modifier les stocks (quantités, produits)' },
  { key: 'livraisons_declare', label: 'Déclarer une livraison (sans CA ni salaire)' }
];

function ouvrirEdition(uid) {
  const u = users.find(x => x.id === uid);
  if (!u) return;
  document.getElementById('edit-uid').value = uid;
  document.getElementById('edit-email-readonly').textContent = u.email || '—';
  document.getElementById('edit-prenom').value = u.prenom || '';
  document.getElementById('edit-nom').value = u.nom || '';
  document.getElementById('edit-id-discord').value = u.idDiscord || '';
  document.getElementById('edit-id-perso').value = u.idPerso || '';
  document.getElementById('edit-date-entree').value = u.dateEntree || '';
  // Accès au site : pages déjà données par le rôle = cochées + grisées ;
  // les autres = cochables (deviennent des accès supplémentaires individuels).
  const supp = Array.isArray(u.accesSupp) ? u.accesSupp : [];
  const renderCb = (p) => {
    const parRole = canAccess(u.role, p.key);
    const coche = parRole || supp.includes(p.key);
    return `<label style="display:flex;align-items:center;gap:7px;font-size:0.85rem;cursor:${parRole ? 'default' : 'pointer'};">
      <input type="checkbox" class="edit-acces-cb" value="${p.key}" ${coche ? 'checked' : ''} ${parRole ? 'disabled' : ''}>
      <span>${p.label}${parRole ? ' <span class="muted" style="font-size:0.7rem;">(via le rôle)</span>' : ''}</span>
    </label>`;
  };
  const titreGrp = (t) => `<div class="muted" style="grid-column:1/-1;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;margin:4px 0 1px;">${t}</div>`;
  document.getElementById('edit-acces').innerHTML =
    titreGrp('Accès aux pages') + PAGES_GERABLES.map(renderCb).join('') +
    titreGrp('Permissions de modification') + PERMS_GERABLES.map(renderCb).join('');
  document.getElementById('modal-edit').classList.remove('hidden');
}

document.getElementById('btn-cancel-edit').addEventListener('click', () => {
  document.getElementById('modal-edit').classList.add('hidden');
});

document.getElementById('btn-save-edit').addEventListener('click', async () => {
  const uid = document.getElementById('edit-uid').value;
  const patch = {
    prenom:    normalizePrenom(document.getElementById('edit-prenom').value),
    nom:       normalizeNom(document.getElementById('edit-nom').value),
    idDiscord: document.getElementById('edit-id-discord').value.trim(),
    idPerso:   document.getElementById('edit-id-perso').value.trim(),
    dateEntree:document.getElementById('edit-date-entree').value || null,
    // Accès supplémentaires = cases cochées NON grisées (les grisées viennent du rôle)
    accesSupp: Array.from(document.querySelectorAll('.edit-acces-cb:checked:not(:disabled)')).map(cb => cb.value)
  };
  if (!patch.prenom || !patch.nom) return toastError("Prénom et NOM obligatoires.");
  try {
    await updateUser(uid, patch);
    logSite('comptes-acces', 'Compte modifié', [
      { name: 'Compte', value: `${patch.prenom} ${patch.nom}`, inline: true },
      { name: 'Accès / permissions', value: (patch.accesSupp && patch.accesSupp.length) ? patch.accesSupp.join(', ') : 'aucun (rôle seul)', inline: false }
    ]);
    toastSuccess("Compte modifié.");
    document.getElementById('modal-edit').classList.add('hidden');
  } catch (e) { toastError(e?.message || e?.code || "Erreur."); console.error(e); }
});

// === Selecteur "Voir le site comme..." (admin reel uniquement) ===
const selectViewAs = document.getElementById('select-view-as');
if (selectViewAs) {
  selectViewAs.value = getViewAsRole();
  selectViewAs.addEventListener('change', () => {
    const v = selectViewAs.value;
    if (v) setViewAsRole(v);
    else clearViewAsRole();
    // Reload : la garde requireAuth va appliquer / retirer la surcharge
    window.location.reload();
  });
}

// === Création de compte ===
document.getElementById('btn-nouveau').addEventListener('click', () => {
  ['new-prenom','new-nom','new-username','new-id-discord','new-id-perso','new-mdp'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-role').value = 'vendeur-novice';
  document.getElementById('new-mdp').value = genererMotDePasseProvisoire();
  document.getElementById('alert-credentials').classList.add('hidden');
  document.getElementById('modal-new').classList.remove('hidden');
});
document.getElementById('btn-cancel-new').addEventListener('click', () => {
  document.getElementById('modal-new').classList.add('hidden');
});
document.getElementById('btn-gen-mdp').addEventListener('click', () => {
  document.getElementById('new-mdp').value = genererMotDePasseProvisoire();
});

// Auto-suggest username quand prenom+nom sont remplis (si l'admin n'a pas encore tape)
const slugRp = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');
function autoSuggestUsername() {
  const usernameInput = document.getElementById('new-username');
  if (usernameInput.dataset.userTyped === '1') return;
  const p = slugRp(document.getElementById('new-prenom').value);
  const n = slugRp(document.getElementById('new-nom').value);
  const suggestion = (p && n) ? `${p}.${n}` : (p || n);
  usernameInput.value = suggestion;
}
document.getElementById('new-prenom').addEventListener('input', autoSuggestUsername);
document.getElementById('new-nom').addEventListener('input', autoSuggestUsername);
document.getElementById('new-username').addEventListener('input', (e) => {
  // marque que l'admin a tape manuellement pour ne plus surcharger automatiquement
  e.target.dataset.userTyped = e.target.value ? '1' : '';
});

document.getElementById('btn-creer').addEventListener('click', async () => {
  const username = document.getElementById('new-username').value.trim().toLowerCase();
  const data = {
    prenom: normalizePrenom(document.getElementById('new-prenom').value),
    nom: normalizeNom(document.getElementById('new-nom').value),
    username,
    idDiscord: document.getElementById('new-id-discord').value.trim(),
    idPerso: document.getElementById('new-id-perso').value.trim(),
    role: document.getElementById('new-role').value,
    motDePasse: document.getElementById('new-mdp').value,
    creePar: profile.prenom + ' ' + profile.nom
  };
  if (!data.prenom || !data.nom || !data.username || !data.motDePasse) {
    return toastError("Champs prénom, nom, identifiant et mot de passe obligatoires.");
  }
  if (!/^[a-z0-9._-]{3,30}$/.test(data.username)) {
    return toastError("Identifiant : 3-30 caractères, lettres/chiffres/. _ - uniquement.");
  }
  // Unicité côté client
  if (users.some(u => (u.username || '').toLowerCase() === data.username)) {
    return toastError(`Identifiant "${data.username}" déjà pris.`);
  }
  // Garde-fou : refuser la création d'un rôle hors périmètre
  if (!canManageUser(profile.role, data.role)) {
    return toastError("Ce rôle est hors de ton périmètre de création.");
  }
  if (data.role === ROLES.PATRON || data.role === ROLES.CO_PATRON) {
    const ok = await confirmCritique({
      titre: `Créer un compte ${ROLE_LABELS[data.role]}`,
      message: `Tu vas créer un compte avec le rôle <strong>${escapeHtml(ROLE_LABELS[data.role])}</strong>.<br><br>
        Ce compte aura <strong>TOUS les droits</strong> sur la plateforme :
        <ul style="margin:8px 0 8px 20px;">
          <li>Administration (créer, modifier, supprimer des comptes)</li>
          <li>Comptabilité (ajout de dépenses, conformité TTE)</li>
          <li>Configuration globale (quotas, prix essence, webhook)</li>
          <li>Suppression d'autres comptes direction</li>
        </ul>
        Ce choix est <strong>irréversible</strong> sans intervention technique.`,
      btnConfirm: 'Créer ce compte direction',
      delaiSec: 3
    });
    if (!ok) return;
  }
  if (data.motDePasse.length < 8) return toastError("Mot de passe ≥ 8 caractères.");
  try {
    await creerCompteEmploye(data);
    toastSuccess("Compte créé.");
    document.getElementById('cred-username').textContent = data.username;
    document.getElementById('cred-mdp').textContent = data.motDePasse;
    document.getElementById('alert-credentials').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    if (err.code === 'auth/email-already-in-use') {
      toastError(`L'identifiant "${data.username}" est déjà pris par un compte de connexion existant (parfois un ancien compte non listé ici). Choisis un autre identifiant, ou supprime l'ancien compte avant de recréer.`);
    } else {
      toastError(err.message || "Erreur lors de la création.");
    }
  }
});

// === Configuration globale ===
document.getElementById('btn-config-globale').addEventListener('click', async () => {
  const c = await getConfig().catch(() => ({}));
  document.getElementById('cfg-bidons').value = c.quotaBidons ?? 1700;
  document.getElementById('cfg-caoutchoucs').value = c.quotaCaoutchoucs ?? 800;
  document.getElementById('cfg-prix').value = c.prixEssence ?? 5;
  document.getElementById('cfg-seuil').value = c.seuilAlerteEssence ?? 1000;
  document.getElementById('cfg-webhook').value = c.discordWebhookAlertes ?? '';
  document.getElementById('modal-config').classList.remove('hidden');
});
document.getElementById('btn-cancel-cfg').addEventListener('click', () => {
  document.getElementById('modal-config').classList.add('hidden');
});
document.getElementById('btn-save-cfg').addEventListener('click', async () => {
  const quotaBidons = Number(document.getElementById('cfg-bidons').value);
  const quotaCaoutchoucs = Number(document.getElementById('cfg-caoutchoucs').value);
  const prixEssence = Number(document.getElementById('cfg-prix').value);
  const seuilAlerteEssence = Number(document.getElementById('cfg-seuil').value);

  // Validation : 0 est valide (= dimension desactivee cette semaine). Refuser
  // negatif, NaN, et le cas "les 2 quotas a 0" qui rend le salaire pompiste
  // toujours 0 (probable erreur de saisie).
  if (!Number.isFinite(quotaBidons)      || quotaBidons < 0)       return toastError("Quota bidons doit être ≥ 0 (0 = désactivé).");
  if (!Number.isFinite(quotaCaoutchoucs) || quotaCaoutchoucs < 0)  return toastError("Quota caoutchoucs doit être ≥ 0 (0 = désactivé).");
  if (quotaBidons === 0 && quotaCaoutchoucs === 0)                 return toastError("Au moins un des deux quotas pompiste doit être > 0.");
  if (!Number.isFinite(prixEssence)      || prixEssence < 0)       return toastError("Prix essence doit être ≥ 0.");
  if (!Number.isFinite(seuilAlerteEssence)|| seuilAlerteEssence < 0) return toastError("Seuil doit être ≥ 0.");

  const discordWebhookAlertes = document.getElementById('cfg-webhook').value.trim();
  if (discordWebhookAlertes && !/^https:\/\/discord\.com\/api\/webhooks\//.test(discordWebhookAlertes)) {
    return toastError("URL webhook invalide (doit commencer par https://discord.com/api/webhooks/).");
  }

  try {
    await setConfig({ quotaBidons, quotaCaoutchoucs, prixEssence, seuilAlerteEssence, discordWebhookAlertes });
    toastSuccess("Configuration enregistrée.");
    document.getElementById('modal-config').classList.add('hidden');
  } catch (e) { toastError(e.message || "Erreur."); console.error(e); }
});

// === Export Google Sheets (modale dédiée, direction uniquement) ===
const COMPTA_EXPORT_URL = 'https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net/comptaExport';

const btnExportSheets = document.getElementById('btn-export-sheets');
if (btnExportSheets) {
  btnExportSheets.addEventListener('click', async () => {
    const zone = document.getElementById('sheets-token-zone');
    zone.innerHTML = '<p class="muted">Lecture du token…</p>';
    document.getElementById('modal-sheets').classList.remove('hidden');

    let secrets = {};
    try { secrets = await getSecrets(); }
    catch (e) {
      console.error(e);
      zone.innerHTML = `<div class="alert danger">Impossible de lire les secrets : ${escapeHtml(e.message || e.code)}</div>`;
      return;
    }
    renderSheetsZone(zone, secrets.comptaExportToken || null);
  });
}

function renderSheetsZone(zone, token) {
  if (!token) {
    zone.innerHTML = `
      <div class="alert warn mb-2">
        <span>Aucun token configuré. Colle ci-dessous le token généré côté serveur (donné par la direction technique).</span>
      </div>
      <label>Token <code>LTD_COMPTA_EXPORT_TOKEN</code></label>
      <input type="text" id="sheets-token-input" placeholder="64 caractères hexadécimaux" style="font-family:monospace;" />
      <div class="row mt-2">
        <button class="btn btn-primary" id="btn-save-sheets-token">Sauvegarder le token</button>
      </div>
    `;
    document.getElementById('btn-save-sheets-token').addEventListener('click', async () => {
      const v = document.getElementById('sheets-token-input').value.trim();
      if (!/^[a-f0-9]{32,128}$/i.test(v)) return toastError("Token invalide (doit être hex, 32-128 chars).");
      try {
        await setSecrets({ comptaExportToken: v });
        toastSuccess("Token enregistré.");
        renderSheetsZone(zone, v);
      } catch (e) { toastError(e.message || "Erreur."); console.error(e); }
    });
    return;
  }

  // Token présent : afficher les 4 formules à coller dans Google Sheets
  const masque = token.slice(0, 6) + '…' + token.slice(-4);
  const types = [
    { type: 'resume',   label: 'Résumé hebdo',  hint: '1 ligne par semaine clôturée (52 max)' },
    { type: 'depenses', label: 'Dépenses',      hint: 'Toutes les dépenses (2 000 max)' },
    { type: 'ventes',   label: 'Ventes',        hint: 'Toutes les ventes (2 000 max)' },
    { type: 'paies',    label: 'Paies',         hint: 'Toutes les paies versées (2 000 max)' },
    { type: 'banque',   label: 'Banque LTD',    hint: 'Tous mouvements (entrées + sorties) avec solde' }
  ];

  zone.innerHTML = `
    <div class="alert ok mb-2"><span>Token configuré (<code>${masque}</code>)</span></div>

    <h4 style="margin-top:12px;">Setup Google Sheets — pas à pas</h4>
    <ol style="font-size:0.88rem;line-height:1.55;">
      <li>Depuis <strong>ton ordinateur</strong> (pas la tablette FiveM) : ouvre <code>https://sheets.new</code> pour créer un Sheet vierge</li>
      <li>Crée 5 onglets : <code>Resume</code>, <code>Depenses</code>, <code>Ventes</code>, <code>Paies</code>, <code>Banque</code> (sans accents — l'Apps Script renomme automatiquement les anciens si présents)</li>
      <li>Dans la cellule <code>A1</code> de chaque onglet, colle la formule correspondante ci-dessous</li>
      <li>Sheets remplit automatiquement — refresh ~1h (Google force, pas modifiable)</li>
      <li>Partage le Sheet avec qui tu veux (staff serveur, etc.) en lecture seule</li>
    </ol>

    <div class="alert warn mb-2" style="font-size:0.78rem;">
      <span><strong>Sécurité</strong> : ne diffuse pas le token. Le Sheet final (lecture seule) peut être partagé sans risque, mais quiconque a le token peut télécharger toutes les données compta. Garde-le confidentiel comme un mot de passe.</span>
    </div>

    <h4>Formules à copier-coller</h4>
    ${types.map(t => `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>${t.label}</strong>
          <span class="muted" style="font-size:0.75rem;">${t.hint}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:stretch;">
          <input type="text" readonly value='=IMPORTDATA("${COMPTA_EXPORT_URL}?type=${t.type}&token=${token}")'
                 class="mono sheets-formula" style="flex:1;font-size:0.78rem;" />
          <button class="btn btn-sm" data-copy="${t.type}">Copier</button>
        </div>
      </div>
    `).join('')}

    <details style="margin-top:14px;">
      <summary style="cursor:pointer;font-family:var(--font-heading);font-size:0.85rem;">Régénérer le token (en cas de fuite)</summary>
      <div class="alert info mt-2" style="font-size:0.78rem;">
        <div>
          La régénération passe par Firebase CLI (côté serveur, pas depuis l'app). Procédure :
          <ol style="margin:6px 0 0 18px;padding:0;">
            <li><code>node -e "require('fs').writeFileSync('t.tmp', require('crypto').randomBytes(32).toString('hex'),'utf8')"</code></li>
            <li><code>firebase functions:secrets:set LTD_COMPTA_EXPORT_TOKEN --data-file t.tmp</code></li>
            <li><code>firebase deploy --only functions:comptaExport</code></li>
            <li>Lis le contenu de <code>t.tmp</code>, copie-le ici dans le champ ci-dessus, supprime le fichier</li>
          </ol>
          Toutes les anciennes formules dans Google Sheets cesseront de fonctionner — il faudra les mettre à jour.
        </div>
      </div>
    </details>
  `;

  // Boutons "Copier"
  zone.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const formula = btn.previousElementSibling.value;
      try {
        await navigator.clipboard.writeText(formula);
        toastSuccess("Formule copiée dans le presse-papiers.");
      } catch (e) {
        // Fallback : sélection manuelle
        btn.previousElementSibling.select();
        toastError("Copie auto refusée (vieux navigateur). Sélection faite — fais Ctrl+C.");
      }
    });
  });
}

document.getElementById('btn-cancel-sheets').addEventListener('click', () => {
  document.getElementById('modal-sheets').classList.add('hidden');
});

// === Embauches à traiter (alimentées par #auto-rh Discord) ===
async function chargerEmbauches() {
  const panel = document.getElementById('panel-embauches');
  if (!panel) return;
  let embauches = [];
  try {
    embauches = await listEmbauchesEnAttente();
  } catch (e) {
    console.error('embauches', e);
    return;
  }
  // Filtrer : exclure celles déjà traitées + celles pour qui un user existe déjà
  const usersById = users.reduce((m, u) => {
    if (u.idDiscord) m[u.idDiscord] = u;
    if (u.idPerso) m[u.idPerso] = u;
    return m;
  }, {});
  const enAttente = embauches.filter(e => {
    if (e.traitee) return false;
    if (e.idDiscord && usersById[e.idDiscord]) return false;
    if (e.idPerso && usersById[e.idPerso]) return false;
    return true;
  });

  if (enAttente.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  document.getElementById('embauches-count').textContent =
    `${enAttente.length} en attente`;

  const tbody = document.getElementById('tbody-embauches');
  tbody.innerHTML = enAttente.map(e => `
    <tr>
      <td class="mono" style="font-size:0.78rem;">${escapeHtml(date(e.timestamp) || '—')}</td>
      <td><strong>${escapeHtml(e.prenom || '')} ${escapeHtml(e.nom || '')}</strong></td>
      <td class="mono">${escapeHtml(e.idDiscord || '—')}</td>
      <td class="mono">${escapeHtml(e.idPerso || '—')}</td>
      <td class="actions-cell">
        <button class="btn btn-sm btn-primary" data-creer-embauche="${e.id}" title="Créer le compte (formulaire pré-rempli)" data-tooltip="Créer le compte">Créer</button>
        <button class="btn btn-sm btn-ghost" data-marquer-traitee="${e.id}" title="Marquer comme traité (sans créer)" data-tooltip="Marquer traité">Traité</button>
      </td>
    </tr>
  `).join('');

  // Bouton Créer le compte → ouvre la modale Nouveau compte avec champs pré-remplis
  tbody.querySelectorAll('[data-creer-embauche]').forEach(btn => {
    btn.addEventListener('click', () => {
      const emb = enAttente.find(x => x.id === btn.dataset.creerEmbauche);
      if (!emb) return;
      // Reset puis pré-remplit
      ['new-prenom','new-nom','new-email','new-id-discord','new-id-perso','new-mdp']
        .forEach(id => document.getElementById(id).value = '');
      document.getElementById('new-prenom').value = emb.prenom || '';
      document.getElementById('new-nom').value = (emb.nom || '').toUpperCase();
      document.getElementById('new-id-discord').value = emb.idDiscord || '';
      document.getElementById('new-id-perso').value = emb.idPerso || '';
      document.getElementById('new-role').value = 'vendeur-novice';
      document.getElementById('new-mdp').value = genererMotDePasseProvisoire();
      document.getElementById('alert-credentials').classList.add('hidden');
      // Mémorise l'id de l'embauche pour la marquer traitée à la création
      document.getElementById('modal-new').dataset.embaucheId = emb.id;
      document.getElementById('modal-new').classList.remove('hidden');
    });
  });

  // Bouton Marquer comme traité (sans créer le compte)
  tbody.querySelectorAll('[data-marquer-traitee]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await marquerEmbaucheTraitee(btn.dataset.marquerTraitee);
        toastSuccess('Embauche marquée traitée.');
        chargerEmbauches();
      } catch (e) { toastError(e?.message || 'Erreur.'); }
    });
  });
}

// Recharge à chaque mise à jour de users (1er chargement + temps réel)
const _chargerEmbauchesQuandUsersPrets = () => {
  // attend que la liste users soit chargée (via listenUsers)
  setTimeout(() => { if (users.length > 0) chargerEmbauches(); }, 800);
};
_chargerEmbauchesQuandUsersPrets();
setInterval(_chargerEmbauchesQuandUsersPrets, 60000); // refresh chaque minute

// Hook : à la création réussie d'un compte depuis l'embauche, marquer traitée
const observer = new MutationObserver(async (mutations) => {
  for (const m of mutations) {
    if (m.target.id === 'alert-credentials' && !m.target.classList.contains('hidden')) {
      const embId = document.getElementById('modal-new').dataset.embaucheId;
      if (embId) {
        try {
          await marquerEmbaucheTraitee(embId);
          delete document.getElementById('modal-new').dataset.embaucheId;
          chargerEmbauches();
        } catch (e) { console.error(e); }
      }
    }
  }
});
const alertCred = document.getElementById('alert-credentials');
if (alertCred) observer.observe(alertCred, { attributes: true, attributeFilter: ['class'] });

// ============================================================
// MAPPING FOURNISSEURS — CRUD direction
// ============================================================
// Stocké dans /config/global.fournisseurs (array). Pas de Cloud Function
// dédiée — on lit/écrit le doc directement via setConfig() (les rules
// Firestore restreignent l'écriture à la direction).
const CATEGORIES_LABELS = {
  'matieres-premieres': 'Matières premières',
  'frais-avocat': 'Frais avocat (≤ 30k)',
  'frais-comptabilite': 'Frais comptabilité (≤ 8k)',
  'entretien-vehicules': 'Entretien véhicules',
  'location-vehicule': 'Location véhicule',
  'achat-vehicule': 'Achat véhicule',
  'frais-vehicule': 'Frais véhicule / essence',
  'loyer': 'Loyer',
  'nourriture-employes': 'Nourriture employés (max 750$/emp)',
  'don-verse': 'Don versé',
  'subvention': 'Subvention reçue',
  'autre-deductible': 'Autre déductible',
  'decoration-locaux': 'Décoration locaux',
  'non-deductible': 'Non déductible'
};

async function chargerFournisseurs() {
  if (!canEditCfg) return;
  const tbody = document.getElementById('tbody-fournisseurs');
  if (!tbody) return;
  try {
    const cfg = await getConfig();
    const patterns = cfg.fournisseurs || [];
    if (patterns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted text-center">Aucun pattern fournisseur. Lance d'abord le script d'init ou ajoute-en un.</td></tr>`;
      return;
    }
    tbody.innerHTML = patterns.map(p => `
      <tr>
        <td><strong>${escapeHtml(p.label || p.id)}</strong></td>
        <td><code style="font-size:0.78rem;">${escapeHtml(p.matchType)}</code></td>
        <td class="mono">${escapeHtml(p.matchValue)}</td>
        <td>${escapeHtml(CATEGORIES_LABELS[p.categorie] || p.categorie)}</td>
        <td class="center">${p.deductible ? '<span class="badge ok">OUI</span>' : '<span class="badge neutral">NON</span>'}</td>
        <td class="muted" style="font-size:0.78rem;">${escapeHtml(p.raisonClassification || '')}</td>
        <td class="center"><button class="btn btn-sm" data-edit-fournisseur="${escapeHtml(p.id)}">Modifier</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-edit-fournisseur]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pat = patterns.find(x => x.id === btn.dataset.editFournisseur);
        if (pat) ouvrirModalFournisseur(pat);
      });
    });
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted text-center">Erreur chargement : ${escapeHtml(e.message || '')}</td></tr>`;
  }
}

function ouvrirModalFournisseur(pat = null) {
  document.getElementById('modal-fournisseur-title').textContent = pat ? 'Modifier le pattern fournisseur' : 'Ajouter un pattern fournisseur';
  document.getElementById('fournisseur-original-id').value = pat?.id || '';
  document.getElementById('fournisseur-label').value = pat?.label || '';
  document.getElementById('fournisseur-matchtype').value = pat?.matchType || 'boutique-id';
  document.getElementById('fournisseur-matchvalue').value = pat?.matchValue || '';
  document.getElementById('fournisseur-categorie').value = pat?.categorie || 'matieres-premieres';
  document.getElementById(pat?.deductible !== false ? 'fournisseur-dedu-oui' : 'fournisseur-dedu-non').checked = true;
  document.getElementById('fournisseur-justification').value = pat?.raisonClassification || '';
  document.getElementById('btn-delete-fournisseur').style.display = pat ? 'inline-block' : 'none';
  document.getElementById('modal-fournisseur').classList.remove('hidden');
}

document.getElementById('btn-nouveau-fournisseur')?.addEventListener('click', () => ouvrirModalFournisseur(null));
document.getElementById('btn-cancel-fournisseur')?.addEventListener('click', () => {
  document.getElementById('modal-fournisseur').classList.add('hidden');
});

document.getElementById('btn-save-fournisseur')?.addEventListener('click', async () => {
  const originalId = document.getElementById('fournisseur-original-id').value;
  const label = document.getElementById('fournisseur-label').value.trim();
  const matchType = document.getElementById('fournisseur-matchtype').value;
  const matchValue = document.getElementById('fournisseur-matchvalue').value.trim();
  const categorie = document.getElementById('fournisseur-categorie').value;
  const deductible = document.getElementById('fournisseur-dedu-oui').checked;
  const justif = document.getElementById('fournisseur-justification').value.trim();

  if (!label || !matchValue) {
    toastError('Label et valeur à matcher requis');
    return;
  }

  // Récupère la config AVANT de décider l'id : si on a modifié un pattern
  // existant ET changé son label, c'est qu'on veut créer un nouveau pattern
  // (pas écraser l'ancien). Régénère l'id depuis le nouveau label dans ce cas.
  const cfg = await getConfig();
  const patterns = cfg.fournisseurs || [];
  let id;
  if (originalId) {
    const originalPattern = patterns.find(p => p.id === originalId);
    const originalLabel = originalPattern?.label || '';
    if (label !== originalLabel) {
      // Le label a changé → nouveau pattern, nouvel id
      id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      // Si collision avec un autre id existant, suffix horodaté
      if (patterns.some(p => p.id === id)) id = `${id}-${Date.now()}`;
    } else {
      id = originalId; // édition simple, conserver l'id
    }
  } else {
    id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (patterns.some(p => p.id === id)) id = `${id}-${Date.now()}`;
  }

  try {
    const idx = patterns.findIndex(p => p.id === id);
    const nouveauPattern = {
      id, label, matchType, matchValue, categorie, deductible,
      raisonClassification: justif,
      ajoutePar: profile.uid || 'patron',
      dateAjout: new Date().toISOString()
    };
    let merged;
    if (idx >= 0) {
      merged = [...patterns];
      merged[idx] = { ...patterns[idx], ...nouveauPattern };
    } else {
      merged = [...patterns, nouveauPattern];
    }
    await setConfig({ fournisseurs: merged });
    toastSuccess(idx >= 0 ? 'Pattern modifié' : 'Pattern ajouté');
    document.getElementById('modal-fournisseur').classList.add('hidden');
    chargerFournisseurs();
  } catch (e) {
    toastError(e.message || 'Erreur sauvegarde pattern');
  }
});

document.getElementById('btn-delete-fournisseur')?.addEventListener('click', async () => {
  const id = document.getElementById('fournisseur-original-id').value;
  if (!id) return;
  const ok = await confirmCritique({
    titre: 'Supprimer ce pattern ?',
    message: `Les futures dépenses similaires ne seront plus auto-classées. Les dépenses passées déjà classifiées ne sont pas affectées.`,
    confirmer: 'Supprimer'
  });
  if (!ok) return;
  try {
    const cfg = await getConfig();
    const patterns = (cfg.fournisseurs || []).filter(p => p.id !== id);
    await setConfig({ fournisseurs: patterns });
    toastSuccess('Pattern supprimé');
    document.getElementById('modal-fournisseur').classList.add('hidden');
    chargerFournisseurs();
  } catch (e) {
    toastError(e.message || 'Erreur suppression pattern');
  }
});

chargerFournisseurs();

// ============================================================
// ENGAGEMENTS DE REMBOURSEMENT — CRUD direction
// ============================================================
const FUNCTIONS_BASE_ADMIN = 'https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net';

async function callGererEngagement(action, data) {
  const { auth } = await import('../firebase-config.js');
  const idToken = await auth.currentUser.getIdToken();
  const resp = await fetch(`${FUNCTIONS_BASE_ADMIN}/gererEngagement`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify({ action, ...data })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

async function chargerEngagements() {
  if (!canEditCfg) return;
  const tbody = document.getElementById('tbody-engagements');
  if (!tbody) return;
  try {
    const res = await callGererEngagement('list', {});
    const engagements = res.engagements || [];
    if (engagements.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted text-center">Aucun engagement enregistré.</td></tr>`;
      return;
    }
    tbody.innerHTML = engagements.map(e => {
      const ech = e.dateEcheance ? new Date(e.dateEcheance) : null;
      const joursRest = ech ? Math.ceil((ech.getTime() - Date.now()) / (24*3600*1000)) : null;
      let statutBadge = '<span class="badge ok">OK</span>';
      if (e.statut === 'rembourse') statutBadge = '<span class="badge ok">Remboursé</span>';
      else if (e.statut === 'defaillant') statutBadge = '<span class="badge danger">Défaillant</span>';
      else if (e.statut === 'annule') statutBadge = '<span class="badge neutral">Annulé</span>';
      else if (joursRest != null && joursRest < 0) statutBadge = '<span class="badge danger">EN RETARD</span>';
      else if (joursRest != null && joursRest <= 7) statutBadge = '<span class="badge warn">ÉCHÉANCE PROCHE</span>';
      return `
        <tr>
          <td><strong>${escapeHtml(e.beneficiaire || '—')}</strong>${e.signataire ? `<br><small class="muted">${escapeHtml(e.signataire)}</small>` : ''}</td>
          <td>${escapeHtml(e.objet || '—')}</td>
          <td class="right mono">${(e.montantInitial || 0).toLocaleString('fr-FR')} $</td>
          <td class="right mono">${(e.montantRembourse || 0).toLocaleString('fr-FR')} $</td>
          <td class="right mono"><strong>${(e.montantRestant || 0).toLocaleString('fr-FR')} $</strong></td>
          <td>${ech ? ech.toLocaleDateString('fr-FR') : '—'}</td>
          <td class="center mono">${joursRest != null ? joursRest + ' j' : '—'}</td>
          <td class="center">${statutBadge}</td>
          <td class="center"><button class="btn btn-sm" data-edit-engagement="${escapeHtml(e.id)}">Modifier</button></td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('[data-edit-engagement]').forEach(btn => {
      btn.addEventListener('click', () => {
        const eng = engagements.find(x => x.id === btn.dataset.editEngagement);
        if (eng) ouvrirModalEngagement(eng);
      });
    });
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="9" class="muted text-center">Erreur : ${escapeHtml(e.message || '')}</td></tr>`;
  }
}

let engagementEnEdition = null;

function ouvrirModalEngagement(eng) {
  engagementEnEdition = eng;
  document.getElementById('modal-engagement-title').textContent = eng ? 'Modifier l\'engagement' : 'Ajouter un engagement';
  document.getElementById('engagement-original-id').value = eng?.id || '';
  document.getElementById('engagement-beneficiaire').value = eng?.beneficiaire || '';
  document.getElementById('engagement-signataire').value = eng?.signataire || '';
  document.getElementById('engagement-objet').value = eng?.objet || '';
  document.getElementById('engagement-type').value = eng?.type || 'subvention-rembours';
  document.getElementById('engagement-montant').value = eng?.montantInitial ?? '';
  document.getElementById('engagement-date-reception').value = eng?.dateReception ? dateKeyLocal(new Date(eng.dateReception)) : '';
  document.getElementById('engagement-date-echeance').value = eng?.dateEcheance ? dateKeyLocal(new Date(eng.dateEcheance)) : '';
  document.getElementById('engagement-montant-rembourse').value = eng?.montantRembourse ?? 0;
  document.getElementById('engagement-statut').value = eng?.statut || 'actif';
  document.getElementById('engagement-notes').value = eng?.notes || '';
  document.getElementById('engagement-edit-fields').style.display = eng ? 'flex' : 'none';
  document.getElementById('btn-delete-engagement').style.display = eng ? 'inline-block' : 'none';
  document.getElementById('btn-rembourser-engagement').style.display = (eng && eng.statut === 'actif') ? 'inline-block' : 'none';
  const histZone = document.getElementById('engagement-historique-zone');
  const histList = document.getElementById('engagement-historique-list');
  if (eng && Array.isArray(eng.historiqueRemboursements) && eng.historiqueRemboursements.length > 0) {
    histZone.style.display = 'block';
    histList.innerHTML = eng.historiqueRemboursements.map(h => {
      const d = h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : '?';
      return `<div>• ${d} — <strong>${(h.montant || 0).toLocaleString('fr-FR')} $</strong> ${h.raison ? `(${escapeHtml(h.raison)})` : ''}${h.utilisateur ? ` par ${escapeHtml(h.utilisateur)}` : ''}</div>`;
    }).join('');
  } else {
    histZone.style.display = 'none';
  }
  document.getElementById('modal-engagement').classList.remove('hidden');
}

document.getElementById('btn-nouveau-engagement')?.addEventListener('click', () => ouvrirModalEngagement(null));
document.getElementById('btn-cancel-engagement')?.addEventListener('click', () => {
  document.getElementById('modal-engagement').classList.add('hidden');
});

document.getElementById('btn-save-engagement')?.addEventListener('click', async () => {
  const data = {
    id: document.getElementById('engagement-original-id').value || null,
    beneficiaire: document.getElementById('engagement-beneficiaire').value.trim(),
    signataire: document.getElementById('engagement-signataire').value.trim(),
    objet: document.getElementById('engagement-objet').value.trim(),
    type: document.getElementById('engagement-type').value,
    montantInitial: Number(document.getElementById('engagement-montant').value) || 0,
    dateReception: document.getElementById('engagement-date-reception').value,
    dateEcheance: document.getElementById('engagement-date-echeance').value,
    notes: document.getElementById('engagement-notes').value.trim()
  };
  if (engagementEnEdition) {
    data.montantRembourse = Number(document.getElementById('engagement-montant-rembourse').value) || 0;
    data.statut = document.getElementById('engagement-statut').value;
  }
  if (!data.beneficiaire || !data.objet || !data.montantInitial || !data.dateReception || !data.dateEcheance) {
    toastError('Tous les champs requis doivent être remplis');
    return;
  }
  try {
    await callGererEngagement(engagementEnEdition ? 'update' : 'create', data);
    toastSuccess(engagementEnEdition ? 'Engagement modifié' : 'Engagement créé');
    document.getElementById('modal-engagement').classList.add('hidden');
    chargerEngagements();
  } catch (e) {
    toastError(e.message || 'Erreur sauvegarde');
  }
});

document.getElementById('btn-delete-engagement')?.addEventListener('click', async () => {
  if (!engagementEnEdition) return;
  const ok = await confirmCritique({
    titre: 'Supprimer cet engagement ?',
    message: `Bénéficiaire : ${engagementEnEdition.beneficiaire}\nMontant : ${engagementEnEdition.montantInitial} $`,
    confirmer: 'Supprimer'
  });
  if (!ok) return;
  try {
    await callGererEngagement('delete', { id: engagementEnEdition.id });
    toastSuccess('Engagement supprimé');
    document.getElementById('modal-engagement').classList.add('hidden');
    chargerEngagements();
  } catch (e) {
    toastError(e.message || 'Erreur suppression');
  }
});

document.getElementById('btn-rembourser-engagement')?.addEventListener('click', () => {
  document.getElementById('rembours-montant').value = '';
  document.getElementById('rembours-raison').value = '';
  document.getElementById('modal-rembours').classList.remove('hidden');
});

document.getElementById('btn-cancel-rembours')?.addEventListener('click', () => {
  document.getElementById('modal-rembours').classList.add('hidden');
});

document.getElementById('btn-confirm-rembours')?.addEventListener('click', async () => {
  if (!engagementEnEdition) return;
  const montant = Number(document.getElementById('rembours-montant').value) || 0;
  const raison = document.getElementById('rembours-raison').value.trim();
  if (montant <= 0) { toastError('Montant invalide'); return; }
  try {
    await callGererEngagement('rembourser', { id: engagementEnEdition.id, montant, raison });
    toastSuccess(`Remboursement de ${montant} $ enregistré`);
    document.getElementById('modal-rembours').classList.add('hidden');
    document.getElementById('modal-engagement').classList.add('hidden');
    chargerEngagements();
  } catch (e) {
    toastError(e.message || 'Erreur remboursement');
  }
});

chargerEngagements();
