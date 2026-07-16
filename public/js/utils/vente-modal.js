// ============================================================
// Modal Declaration de vente — utilisable employe (creation) + admin (edition).
// ============================================================
// Source de verite : la Cloud Function declarerVente / modifierVente.
// Le prixAchat affiche cote client est INDICATIF — recalcul serveur.
// ============================================================

import { listProduits, listVentesSemaineIncluantCachees, logSite } from '../api.js';
import { money, moneyPrecis, escapeHtml, datetime, startOfWeekRP, endOfWeekRP } from './formatters.js';
import { toastSuccess, toastError } from './toast.js';
import { auth } from '../firebase-config.js';
import { isVendeur, isLivreur } from './permissions.js';

const FUNCTIONS_BASE = 'https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net';

const MODAL_HTML = `
  <div id="modal-vente" class="modal-backdrop hidden">
    <div class="modal" style="max-width:780px;max-height:92vh;overflow-y:auto;">
      <h3 id="modal-vente-title">Déclarer une vente</h3>

      <div class="alert info mb-2" style="font-size:0.82rem;" id="modal-vente-info-bloc">
        <span id="modal-vente-info">
          Saisis chaque produit vendu et la quantité. Le <strong>prix de vente</strong>
          et le <strong>bénéfice</strong> sont calculés automatiquement depuis le catalogue.
          La vente sera <strong>verrouillée</strong> après validation.
        </span>
      </div>

      <input type="hidden" id="vente-id" />
      <input type="hidden" id="vente-mode" value="create" />
      <input type="hidden" id="vente-facture-bot-id" />

      <!-- Etape 1 (mode employe vendeur) : selectionner la facture bot a declarer -->
      <div id="vente-select-bot-bloc" class="hidden">
        <label>Facture in-game à déclarer <span style="color:var(--color-blood-light);">*</span></label>
        <select id="vente-select-bot" style="width:100%;">
          <option value="">— Sélectionne la facture —</option>
        </select>
        <p class="muted" style="font-size:0.78rem;margin:4px 0 8px;">
          Seules les factures in-game <strong>de moins de 24h non encore déclarées</strong> sont listées.
          Si la tienne n'apparaît pas : fais-la d'abord en jeu et reviens ici (le bot doit la remonter).
        </p>
        <div id="vente-bot-info" class="hidden alert info" style="font-size:0.82rem;margin-bottom:8px;"></div>
      </div>

      <label>Lignes de produits</label>
      <div id="vente-lignes" style="display:flex;flex-direction:column;gap:6px;"></div>
      <button class="btn btn-ghost mt-1" id="btn-vente-add-ligne" type="button" style="width:fit-content;">+ Ajouter un produit</button>

      <!-- Champs admin (caches en mode create employe) -->
      <div id="vente-admin-fields" class="hidden">
        <div class="field-row mt-3">
          <div>
            <label>Montant encaissé ($)<span class="muted" style="font-size:0.75rem;"> — laisser vide = prix catalogue</span></label>
            <input type="number" id="vente-montant" min="0" step="0.01" placeholder="auto" />
          </div>
          <div>
            <label>Moyen de paiement</label>
            <select id="vente-paiement">
              <option value="">— défaut (espèces) —</option>
              <option value="especes">Espèces</option>
              <option value="carte">Carte / Virement</option>
              <option value="autre">Autre</option>
            </select>
          </div>
        </div>

        <label class="mt-2">Nom du client</label>
        <input type="text" id="vente-client" placeholder="Client comptoir (par défaut)" maxlength="120" />
      </div>

      <div id="vente-motif-bloc" class="hidden mt-2">
        <label>Motif de modification<span style="color:var(--color-blood-light);">*</span></label>
        <input type="text" id="vente-motif" placeholder="ex: correction prix unitaire, ajout ligne oubliée, etc." maxlength="240" />
      </div>

      <div class="panel mt-3" style="margin:0;background:rgba(0,0,0,0.18);">
        <div class="row between"><span class="muted">Prix de vente total (catalogue)</span><strong id="vente-ca">$0</strong></div>
        <div class="row between"><span class="muted">Coût total (prix achat)</span><strong id="vente-cout">$0</strong></div>
        <div class="row between" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-top:4px;">
          <span class="muted"><strong>Bénéfice pour le LTD</strong></span>
          <strong id="vente-benefice" style="font-size:1.1rem;">$0</strong>
        </div>
      </div>

      <div class="row mt-3">
        <button class="btn btn-primary" id="btn-vente-valider" type="button">Valider la vente</button>
        <button class="btn btn-ghost" id="btn-vente-annuler" type="button">Annuler</button>
      </div>
    </div>
  </div>
`;

let produitsCache = null;
let produitsVisibles = null; // sous-ensemble filtre selon le role caller
let modalInjected = false;
let onSuccessCb = null;
let venteBotChoisie = null;  // vente bot selectionnee pour declaration (mode vendeur)

function injectModalIfNeeded() {
  if (modalInjected) return;
  const div = document.createElement('div');
  div.innerHTML = MODAL_HTML;
  document.body.appendChild(div.firstElementChild);
  modalInjected = true;
  document.getElementById('btn-vente-annuler').addEventListener('click', () => fermerModal());
  document.getElementById('btn-vente-add-ligne').addEventListener('click', () => ajouterLigne());
  document.getElementById('btn-vente-valider').addEventListener('click', () => soumettre());
  const elMontant = document.getElementById('vente-montant');
  if (elMontant) elMontant.addEventListener('input', recalculer);
}

function fermerModal() {
  document.getElementById('modal-vente').classList.add('hidden');
}

// Normalise une chaine pour la recherche (lowercase + sans accents)
function normSearch(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function trouverProduitsParTexte(texte, max = 20) {
  const q = normSearch(texte);
  if (!q) return [];
  const startsWith = [];
  const contains = [];
  const source = produitsVisibles || produitsCache || [];
  for (const p of source) {
    const n = normSearch(p.nom || p.id);
    if (n.startsWith(q)) startsWith.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  // Tri alpha dans chaque groupe, startsWith d'abord
  startsWith.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  contains.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  return [...startsWith, ...contains].slice(0, max);
}

function ajouterLigne(preset = null) {
  const wrap = document.getElementById('vente-lignes');
  const idx = wrap.children.length;
  const row = document.createElement('div');
  row.className = 'row vente-ligne';
  row.style.cssText = 'gap:8px;align-items:flex-start;';
  row.innerHTML = `
    <div class="vente-autocomplete" style="flex:1;min-width:200px;position:relative;">
      ${idx === 0 ? '<label style="font-size:0.78rem;">Produit (tape une lettre)</label>' : ''}
      <input type="text" class="vente-prod-input" placeholder="ex: F, bonbon, ticket…"
             data-product-id="" data-achat="0" data-vente="0" autocomplete="off"
             style="width:100%;" />
      <div class="vente-prod-list hidden" style="position:absolute;top:100%;left:0;right:0;z-index:2000;background:var(--color-bg-elev,#222);border:1px solid #555;max-height:240px;overflow-y:auto;border-radius:4px;margin-top:2px;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>
    </div>
    <div style="width:90px;">
      ${idx === 0 ? '<label style="font-size:0.78rem;">Quantité</label>' : ''}
      <input type="number" class="vente-qte" min="1" step="1" value="1" />
    </div>
    <div style="width:120px;text-align:right;">
      ${idx === 0 ? '<label style="font-size:0.78rem;">Total ligne</label>' : ''}
      <div class="vente-total-ligne mono" style="padding:8px 0;">$0</div>
    </div>
    <button class="btn btn-danger btn-vente-del" type="button" title="Supprimer la ligne" style="padding:6px 10px;${idx === 0 ? 'margin-top:18px;' : ''}">×</button>
  `;
  wrap.appendChild(row);

  const input = row.querySelector('.vente-prod-input');
  const liste = row.querySelector('.vente-prod-list');
  const qteEl = row.querySelector('.vente-qte');

  function applyProduit(p) {
    input.value = p.nom || p.id;
    input.dataset.productId = p.id;
    input.dataset.achat = Number(p.prixAchat || 0);
    input.dataset.vente = Number(p.prixVente || 0);
    liste.classList.add('hidden');
    recalculer();
  }

  function renderListe(items) {
    if (items.length === 0) {
      liste.innerHTML = `<div style="padding:8px 12px;color:#999;font-size:0.85rem;">Aucun produit trouvé.</div>`;
    } else {
      liste.innerHTML = items.map(p => {
        const vente = Number(p.prixVente || 0);
        const badge = p.pourPro ? ' <span class="badge neutral" style="font-size:0.65rem;">PRO</span>' : '';
        return `<div class="vente-prod-opt" data-pid="${escapeHtml(p.id)}" style="padding:6px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(255,255,255,0.05);">
          <span>${escapeHtml(p.nom || p.id)}${badge}</span>
          <span class="muted mono" style="font-size:0.78rem;">${vente ? moneyPrecis(vente) : ''}</span>
        </div>`;
      }).join('');
      // Hover + click
      liste.querySelectorAll('.vente-prod-opt').forEach(el => {
        el.addEventListener('mouseenter', () => { el.style.background = 'rgba(220,40,40,0.18)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => {
          const pid = el.dataset.pid;
          const prod = produitsCache.find(x => x.id === pid);
          if (prod) applyProduit(prod);
        });
      });
    }
    liste.classList.remove('hidden');
  }

  input.addEventListener('input', () => {
    // Si l'utilisateur modifie le texte apres avoir choisi -> reset selection
    input.dataset.productId = '';
    input.dataset.achat = '0';
    input.dataset.vente = '0';
    const items = trouverProduitsParTexte(input.value);
    renderListe(items);
    recalculer();
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) {
      renderListe(trouverProduitsParTexte(input.value));
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') liste.classList.add('hidden');
    else if (e.key === 'Enter') {
      e.preventDefault();
      const items = trouverProduitsParTexte(input.value);
      if (items.length === 1) applyProduit(items[0]);
    }
  });
  // Click ailleurs -> ferme la liste
  document.addEventListener('click', (e) => {
    if (!row.contains(e.target)) liste.classList.add('hidden');
  });

  qteEl.addEventListener('input', recalculer);
  row.querySelector('.btn-vente-del').addEventListener('click', () => { row.remove(); recalculer(); });

  if (preset?.produitId) {
    const prod = (produitsCache || []).find(p => p.id === preset.produitId);
    if (prod) applyProduit(prod);
    if (preset.quantite) qteEl.value = preset.quantite;
  }
  recalculer();
}

function recalculer() {
  let coutTotal = 0;
  let prixVenteTotal = 0;
  document.querySelectorAll('.vente-ligne').forEach(row => {
    const input = row.querySelector('.vente-prod-input');
    const pid = input?.dataset.productId || '';
    const qte = Number(row.querySelector('.vente-qte').value) || 0;
    const achat = pid ? Number(input.dataset.achat || 0) : 0;
    const vente = pid ? Number(input.dataset.vente || 0) : 0;
    const totalLigne = vente * qte;
    row.querySelector('.vente-total-ligne').textContent = moneyPrecis(totalLigne);
    coutTotal += achat * qte;
    prixVenteTotal += totalLigne;
  });
  // En mode edit, si l'admin saisit un montant, prend le sien. Sinon prixVenteTotal.
  const montantSaisi = Number(document.getElementById('vente-montant')?.value) || 0;
  const montantEffectif = montantSaisi > 0 ? montantSaisi : prixVenteTotal;
  document.getElementById('vente-ca').textContent = moneyPrecis(prixVenteTotal);
  document.getElementById('vente-cout').textContent = moneyPrecis(coutTotal);
  const benefice = montantEffectif - coutTotal;
  const el = document.getElementById('vente-benefice');
  el.textContent = moneyPrecis(benefice);
  el.style.color = benefice >= 0 ? 'var(--color-cactus,#5a8)' : 'var(--color-blood-light)';

  // Validation temps reel vs montant facture bot (mode vendeur)
  const botIdSel = document.getElementById('vente-facture-bot-id')?.value;
  if (botIdSel && venteBotChoisie) {
    const cible = Number(venteBotChoisie.montant || 0);
    const ecart = montantEffectif - cible;
    const info = document.getElementById('vente-bot-info');
    const btnValider = document.getElementById('btn-vente-valider');
    if (Math.abs(ecart) < 0.01) {
      info.className = 'alert info';
      info.innerHTML = `<strong>Montant correspond</strong> à la facture in-game #${escapeHtml(String(venteBotChoisie.factureId))} (${moneyPrecis(cible)}). Tu peux valider.`;
      btnValider.disabled = false;
    } else if (montantEffectif === 0) {
      info.className = 'alert info';
      info.innerHTML = `Cible : <strong>${moneyPrecis(cible)}</strong> — facture #${escapeHtml(String(venteBotChoisie.factureId))}.<br>Ajoute les produits que tu as vendus.`;
      btnValider.disabled = true;
    } else {
      info.className = 'alert warn';
      info.innerHTML = `<strong>Écart : ${ecart > 0 ? '+' : ''}${moneyPrecis(ecart)}</strong> — il faut atteindre <strong>${moneyPrecis(cible)}</strong> (facture in-game). Vérifie les produits/quantités.`;
      btnValider.disabled = true;
    }
    info.classList.remove('hidden');
  }
}

async function soumettre() {
  const mode = document.getElementById('vente-mode').value;
  const venteId = document.getElementById('vente-id').value;
  const clientNom = document.getElementById('vente-client')?.value.trim() || '';
  const moyenPaiement = document.getElementById('vente-paiement')?.value || '';
  const montantSaisi = Number(document.getElementById('vente-montant')?.value);
  const montantEncaisse = Number.isFinite(montantSaisi) && montantSaisi > 0 ? montantSaisi : null;
  const motifModification = document.getElementById('vente-motif').value.trim();

  if (mode === 'edit' && !motifModification) {
    return toastError("Motif de modification obligatoire.");
  }

  const lignes = [];
  let erreur = null;
  document.querySelectorAll('.vente-ligne').forEach(row => {
    const pid = row.querySelector('.vente-prod-input')?.dataset.productId || '';
    const qte = Number(row.querySelector('.vente-qte').value);
    if (!pid) { erreur = "Sélectionne un produit dans toutes les lignes (clique sur un résultat de la liste)."; return; }
    if (!Number.isFinite(qte) || qte <= 0) { erreur = "Quantité invalide dans une ligne."; return; }
    lignes.push({ produitId: pid, quantite: qte });
  });
  if (erreur) return toastError(erreur);
  if (lignes.length === 0) return toastError("Ajoute au moins une ligne de produit.");

  const btn = document.getElementById('btn-vente-valider');
  btn.disabled = true; btn.textContent = 'Envoi…';

  try {
    const idToken = await auth.currentUser.getIdToken();
    const url = mode === 'edit'
      ? `${FUNCTIONS_BASE}/modifierVente`
      : `${FUNCTIONS_BASE}/declarerVente`;
    const factureBotId = document.getElementById('vente-facture-bot-id')?.value || undefined;
    const body = mode === 'edit'
      ? { venteId, clientNom, moyenPaiement, montantEncaisse: montantEncaisse || 0, lignes, motifModification }
      : { lignes, clientNom: clientNom || undefined, moyenPaiement: moyenPaiement || undefined, montantEncaisse: montantEncaisse || undefined, factureBotId };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify(body)
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);

    const msg = mode === 'edit'
      ? `Vente modifiée : ${money(json.montant)} (bénéfice ${money(json.benefice)}).`
      : `Vente #${json.factureId} enregistrée : ${money(json.montant)} encaissés, bénéfice ${money(json.benefice)}.`;
    toastSuccess(msg);
    logSite('ventes', mode === 'edit' ? 'Vente modifiée' : 'Vente déclarée', [
      { name: 'Montant', value: money(json.montant), inline: true },
      { name: 'Bénéfice', value: money(json.benefice), inline: true },
      ...(json.factureId ? [{ name: 'Facture', value: '#' + json.factureId, inline: true }] : []),
      ...(clientNom ? [{ name: 'Client', value: clientNom, inline: true }] : []),
      { name: 'Produits', value: lignes.map(l => l.quantite + '× ' + ((produitsCache || []).find(p => p.id === l.produitId)?.nom || l.produitId)).join(', ').slice(0, 900) || '—', inline: false },
      ...(mode === 'edit' && motifModification ? [{ name: 'Motif modif', value: motifModification.slice(0, 300), inline: false }] : [])
    ]);
    fermerModal();
    if (typeof onSuccessCb === 'function') onSuccessCb(json);
  } catch (e) {
    console.error('[vente-modal]', e);
    toastError("Échec : " + (e?.message || "erreur inattendue."));
  } finally {
    btn.disabled = false;
    btn.textContent = mode === 'edit' ? 'Enregistrer la modification' : 'Valider la vente';
  }
}

// ============================================================
// API publique
// ============================================================

export async function ouvrirModalNouvelleVente({ onSuccess, role, factureBotIdPreset } = {}) {
  injectModalIfNeeded();
  if (!produitsCache) produitsCache = await listProduits().catch(() => []);
  // Filtre les produits visibles selon le role :
  // - On exclut TOUJOURS les intrants (matiere premiere achetee, jamais revendue)
  // - Vendeur (Novice/Inter/Exp) ne voit QUE les produits particulier (pourPro=false)
  //   et les produits de fabrication (enFabrication=true)
  // - Direction/DRH/Resp Vente/admin-technique voit tout (sauf intrants)
  const nonIntrant = produitsCache.filter(p => !p.intrant);
  // Vendeur ET livreur : uniquement les produits particulier (pourPro=false).
  produitsVisibles = (isVendeur(role) || isLivreur(role) || role === 'chef-equipe')
    ? nonIntrant.filter(p => !p.pourPro)
    : nonIntrant;
  onSuccessCb = onSuccess || null;
  venteBotChoisie = null;

  document.getElementById('modal-vente-title').textContent = 'Déclarer une vente';
  document.getElementById('vente-mode').value = 'create';
  document.getElementById('vente-id').value = '';
  document.getElementById('vente-facture-bot-id').value = '';
  document.getElementById('vente-client').value = '';
  document.getElementById('vente-paiement').value = '';
  document.getElementById('vente-montant').value = '';
  document.getElementById('vente-motif').value = '';
  document.getElementById('vente-motif-bloc').classList.add('hidden');
  // Mode employe : on cache les champs admin (montant/client/paiement)
  document.getElementById('vente-admin-fields').classList.add('hidden');
  document.getElementById('btn-vente-valider').textContent = 'Valider la vente';
  document.getElementById('vente-lignes').innerHTML = '';

  // === Mode vendeur : doit choisir une facture bot avant de saisir ===
  const blocSelect = document.getElementById('vente-select-bot-bloc');
  const selectBot  = document.getElementById('vente-select-bot');
  const infoBot    = document.getElementById('vente-bot-info');
  if (isVendeur(role) || isLivreur(role) || role === 'chef-equipe') {
    blocSelect.classList.remove('hidden');
    selectBot.innerHTML = '<option value="">Chargement…</option>';
    infoBot.classList.add('hidden');

    // Charge les ventes bot non declarees du vendeur (semaine en cours)
    const debut = startOfWeekRP();
    const fin   = endOfWeekRP();
    const ventes = await listVentesSemaineIncluantCachees(debut, fin).catch(() => []);
    const uid = auth.currentUser?.uid;
    const il_y_a_24h = Date.now() - 24 * 3600 * 1000;
    const nonDeclarees = ventes.filter(v =>
      v.vendeurId === uid &&
      v.source !== 'manuelle' &&
      !v.cachee &&
      (v.timestamp?.toMillis?.() || 0) >= il_y_a_24h
    ).sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));

    if (nonDeclarees.length === 0) {
      selectBot.innerHTML = '<option value="">— Aucune facture in-game à déclarer —</option>';
      selectBot.disabled = true;
      infoBot.className = 'alert warn';
      infoBot.innerHTML = `<strong>Aucune facture in-game non déclarée dans les 24 dernières heures.</strong><br>
        Pour déclarer une vente, il faut d'abord faire la facture en jeu. Le bot Discord la remontera ici dans les secondes qui suivent.<br>
        <em>Si tu en attends une, patiente quelques secondes puis rouvre cette fenêtre.</em>`;
      infoBot.classList.remove('hidden');
      document.getElementById('btn-vente-valider').disabled = true;
    } else {
      selectBot.disabled = false;
      selectBot.innerHTML = '<option value="">— Sélectionne la facture —</option>' +
        nonDeclarees.map(v => {
          const dt = v.timestamp?.toDate?.()
            ? v.timestamp.toDate().toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
            : '?';
          const raison = (v.raison || '').slice(0, 35);
          return `<option value="${v.id}" data-montant="${v.montant}">${dt} · ${moneyPrecis(v.montant)} · ${escapeHtml(raison || v.client || '?')}</option>`;
        }).join('');
      // Stocke le set pour retrouver le doc apres selection
      selectBot.dataset.ventesJson = JSON.stringify(nonDeclarees);

      selectBot.onchange = () => {
        const docId = selectBot.value;
        if (!docId) {
          venteBotChoisie = null;
          document.getElementById('vente-facture-bot-id').value = '';
          infoBot.classList.add('hidden');
          recalculer();
          return;
        }
        const list = JSON.parse(selectBot.dataset.ventesJson || '[]');
        venteBotChoisie = list.find(v => v.id === docId);
        if (venteBotChoisie) {
          document.getElementById('vente-facture-bot-id').value = docId;
        }
        recalculer();
      };

      // Preselect si demande (depuis Mon espace)
      if (factureBotIdPreset && nonDeclarees.find(v => v.id === factureBotIdPreset)) {
        selectBot.value = factureBotIdPreset;
        selectBot.onchange();
      }
      document.getElementById('btn-vente-valider').disabled = true; // active apres saisie matchante
    }
  } else {
    // Admin/direction : pas de selection bot requise
    blocSelect.classList.add('hidden');
    document.getElementById('btn-vente-valider').disabled = false;
  }

  ajouterLigne();
  recalculer();
  document.getElementById('modal-vente').classList.remove('hidden');
}

export async function ouvrirModalModifierVente(vente, { onSuccess } = {}) {
  injectModalIfNeeded();
  if (!produitsCache) produitsCache = await listProduits().catch(() => []);
  // Edition = admin/direction => acces complet au catalogue (pros + particuliers)
  // mais TOUJOURS exclure les intrants (matieres premieres achetees, non vendues)
  produitsVisibles = produitsCache.filter(p => !p.intrant);
  onSuccessCb = onSuccess || null;

  document.getElementById('modal-vente-title').textContent = `Modifier la vente #${vente.factureId || vente.id}`;
  document.getElementById('vente-mode').value = 'edit';
  document.getElementById('vente-id').value = vente.id;
  document.getElementById('vente-client').value = vente.client || '';
  document.getElementById('vente-paiement').value = (vente.paiement || '').toLowerCase();
  document.getElementById('vente-montant').value = vente.montant || '';
  document.getElementById('vente-motif').value = '';
  document.getElementById('vente-motif-bloc').classList.remove('hidden');
  // Mode admin : on affiche les champs montant/client/paiement
  document.getElementById('vente-admin-fields').classList.remove('hidden');
  document.getElementById('btn-vente-valider').textContent = 'Enregistrer la modification';
  document.getElementById('vente-lignes').innerHTML = '';

  const lignesSource = Array.isArray(vente.lignes) && vente.lignes.length > 0
    ? vente.lignes
    : (Array.isArray(vente.items) ? vente.items.map(i => ({ produitId: i.id || i.produitId, quantite: i.quantite })) : []);

  if (lignesSource.length === 0) {
    ajouterLigne();
  } else {
    for (const l of lignesSource) ajouterLigne({ produitId: l.produitId, quantite: l.quantite });
  }
  recalculer();
  document.getElementById('modal-vente').classList.remove('hidden');
}
