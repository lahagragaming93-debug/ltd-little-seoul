// ============================================================
// Layout commun — sidebar + topbar
// Compatible tablette FiveM CEF (responsive + bouton retour)
// ============================================================

import { ROLE_LABELS, canAccess, isEmployeeView, isDirection, isSuperAdmin } from './utils/permissions.js';
import { deconnecter, clearViewAsRole } from './auth.js';
import { listenAlertesActives, marquerAlerteLue, marquerToutesAlertesLues } from './api.js';
import { VERSION, AUTHOR, SIGNATURE_COURTE } from './version.js';
import { initCollapsiblePanels, observeMain } from './utils/collapsible-panel.js';
import { icon } from './utils/icons.js';
import { infoModal } from './utils/confirmation.js';
import { CHANGELOG } from './data/changelog.js';

const NAV_ITEMS = [
  { key: 'dashboard',       href: 'dashboard.html',     icon: 'dashboard',     label: 'Dashboard',          group: 'Direction' },
  { key: 'stocks_epicerie', href: 'stocks.html',        icon: 'package',       label: 'Stocks épicerie',    group: 'Opérations' },
  { key: 'stocks_essence',  href: 'stations.html',      icon: 'fuel',          label: 'Stations essence',   group: 'Opérations' },
  { key: 'ventes',          href: 'ventes.html',        icon: 'receipt',       label: 'Ventes',             group: 'Opérations' },
  { key: 'livraisons',      href: 'livraisons.html',    icon: 'truck',         label: 'Livraisons',         group: 'Opérations' },
  { key: 'comptabilite',    href: 'comptabilite.html',  icon: 'ledger',        label: 'Comptabilité',       group: 'Finance' },
  { key: 'banque',          href: 'banque.html',        icon: 'landmark',      label: 'Banque LTD',         group: 'Finance' },
  { key: 'revenus_carburant', href: 'revenus-carburant.html', icon: 'trending-up', label: 'Revenus carburant', group: 'Finance' },
  { key: 'rh',              href: 'rh.html',            icon: 'users',         label: 'Ressources humaines',group: 'Personnel' },
  { key: 'notes_frais',     href: 'notes-frais.html',   icon: 'wallet',        label: 'Notes de frais',     group: 'Personnel' },
  { key: 'admin',           href: 'admin.html',         icon: 'settings',      label: 'Administration',     group: 'Système' },
  { key: 'employee',        href: 'employee.html',      icon: 'circle-user',   label: 'Mon espace',         group: 'Personnel' },
  { key: 'paies',           href: 'paies.html',         icon: 'banknote',      label: 'Mes paies',          group: 'Personnel' },
  { key: 'tuto',            href: 'tuto.html',          icon: 'graduation',    label: 'Tutoriel',           group: 'Aide' },
  { key: 'guide',           href: 'guide.html',         icon: 'book-open',     label: 'Guide',              group: 'Aide' }
];

// ============================================================
// Helpers d'affichage rôle (badge stylé + initiales)
// ============================================================
const ROLE_DISPLAY = {
  'patron':                  { ico: 'crown',         label: 'PATRON' },
  'co-patron':               { ico: 'star',          label: 'CO-PATRON' },
  'drh':                     { ico: 'clipboard',     label: 'DRH' },
  'responsable-vente':       { ico: 'shopping-cart', label: 'RESP. VENTE' },
  'responsable-pompiste':    { ico: 'fuel',          label: 'RESP. POMPISTE' },
  'chef-equipe':             { ico: 'users',         label: "CHEF D'ÉQUIPE" },
  'vendeur-novice':          { ico: 'sprout',        label: 'NOVICE' },
  'vendeur-intermediaire':   { ico: 'briefcase',     label: 'INTERMÉDIAIRE' },
  'vendeur-experimente':     { ico: 'award',         label: 'EXPÉRIMENTÉ' },
  'livreur':                 { ico: 'package',       label: 'LIVREUR' },
  'pompiste-novice':         { ico: 'sprout',        label: 'NOVICE' },
  'pompiste-intermediaire':  { ico: 'briefcase',     label: 'INTERMÉDIAIRE' },
  'pompiste-experimente':    { ico: 'award',         label: 'EXPÉRIMENTÉ' },
  'admin-technique':         { ico: 'wrench',        label: 'ADMIN TECH' }
};

export function roleBadgeHtml(role) {
  const d = ROLE_DISPLAY[role] || { ico: 'dot', label: (ROLE_LABELS[role] || role || 'INCONNU').toUpperCase() };
  return `<span class="role-badge role-${role}">${icon(d.ico, { size: 13, cls: 'role-badge-ico' })}<span>${d.label}</span></span>`;
}

function initiales(prenom, nom) {
  const p = (prenom || '').trim();
  const n = (nom || '').trim();
  const i1 = p ? p[0] : '';
  const i2 = n ? n[0] : '';
  return (i1 + i2).toUpperCase() || '?';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// Helpers alertes (icône, URL cible, heure relative)
// ============================================================
function alertIcon(type) {
  let name = 'alert-triangle';
  if (type === 'stock-rupture')    name = 'alert-circle';
  else if (type === 'stock-bas')        name = 'package';
  else if (type === 'station-bas')      name = 'fuel';
  else if (type === 'vente-sans-stock') name = 'alert-triangle';
  else if (type && type.startsWith('masse')) name = 'banknote';
  return icon(name, { size: 18 });
}

function alertHref(a) {
  switch (a.type) {
    case 'stock-rupture':
    case 'stock-bas':         return 'stocks.html';
    case 'station-bas':       return 'stations.html';
    case 'vente-sans-stock':  return 'ventes.html';
    default:                  return null; // pas de redirect
  }
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(d.getTime())) return '';
  const diff = Math.max(0, Date.now() - d.getTime());
  const min  = Math.floor(diff / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j < 7) return `il y a ${j} j`;
  return d.toLocaleDateString('fr-FR');
}

// ============================================================
// renderShell — entrée publique
// ============================================================
export function renderShell(profile, activePageKey, mainContentHtml) {
  const ini = initiales(profile.prenom, profile.nom);
  const userChip = `
    <div class="user-chip" id="user-chip">
      <div class="user-avatar role-${profile.role}" title="${escapeHtml(profile.prenom)} ${escapeHtml(profile.nom)}">${ini}</div>
      <div class="user-meta">
        <div class="user-name">${escapeHtml(profile.prenom)} ${escapeHtml(profile.nom)}</div>
        <div class="user-role">${roleBadgeHtml(profile.role)}</div>
      </div>
      <button class="btn-logout" id="btn-logout" title="Déconnexion" aria-label="Déconnexion">
        <span class="btn-logout-ico">${icon('log-out', { size: 16 })}</span>
      </button>
    </div>`;

  const navByGroup = {};
  NAV_ITEMS
    .filter(item => canAccess(profile.role, item.key, profile.accesSupp)
      || (item.key === 'livraisons' && canAccess(profile.role, 'livraisons_declare', profile.accesSupp)))
    .forEach(item => {
      // Pour un employé pur, ne montrer que "Mon espace", "Mes paies", "Guide"
      // + "Livraisons" pour qui peut déclarer (livreur ou titulaire de la permission).
      if (isEmployeeView(profile.role)
          && item.key !== 'employee'
          && item.key !== 'paies'
          && item.key !== 'guide'
          && item.key !== 'livraisons') return;
      (navByGroup[item.group] ||= []).push(item);
    });

  // Chaque groupe = un <div.nav-group> avec un bouton-titre repliable
  // (chevron) + un conteneur de liens. data-group sert a la persistance
  // localStorage. En mode rail (sidebar repliee), les titres se masquent
  // et seules les icones restent (label via tooltip natif title=).
  const navHtml = Object.entries(navByGroup).map(([group, items]) => `
    <div class="nav-group" data-group="${escapeHtml(group)}">
      <button type="button" class="group-title" data-group-toggle aria-expanded="true">
        <span class="group-title-label">${escapeHtml(group)}</span>
        <span class="group-chevron" aria-hidden="true">${icon('chevron-down', { size: 14 })}</span>
      </button>
      <div class="nav-group-items">
        ${items.map(it => `
          <a href="${it.href}" class="${it.key === activePageKey ? 'active' : ''}" data-nav-link title="${escapeHtml(it.label)}">
            <span class="nav-icon">${icon(it.icon, { size: 19 })}</span><span class="nav-label">${escapeHtml(it.label)}</span>
          </a>`).join('')}
      </div>
    </div>
  `).join('');

  // Bouton retour : désactivé si pas d'historique navigable (page d'entrée)
  const canGoBack = window.history.length > 1;

  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <button type="button" class="btn-rail-toggle" id="btn-rail-toggle" title="Replier le menu" aria-label="Replier ou déplier le menu">
          <span class="rail-toggle-ico" aria-hidden="true">${icon('chevrons-left', { size: 16 })}</span>
        </button>
        <div class="brand">
          <img src="img/logo.png" alt="LTD Little Seoul" class="brand-logo" />
          <div class="name">LITTLE SEOUL</div>
          <div class="subname">Épicerie &amp; Stations</div>
        </div>
        <nav>${navHtml}</nav>
        <div class="sidebar-footer" style="margin-top:auto;padding:10px 14px;border-top:1px solid rgba(210,180,140,0.15);font-size:0.62rem;color:rgba(210,180,140,0.5);text-align:center;letter-spacing:0.02em;">
          v${VERSION} · by ${AUTHOR}
        </div>
      </aside>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <header class="topbar">
        <button class="btn-menu" id="btn-menu" title="Menu" aria-label="Ouvrir le menu">${icon('menu', { size: 20 })}</button>
        <button class="btn-back" id="btn-back" title="Retour" aria-label="Page précédente" ${canGoBack ? '' : 'disabled'}>${icon('arrow-left', { size: 18 })}</button>
        <h1 id="page-title">${getPageTitle(activePageKey)}</h1>
        <div class="spacer"></div>

        <!-- Cloche d'alertes : direction + DRH + super-admin uniquement.
             Les autres roles ne voient ni la cloche ni les alertes globales
             (stock bas, ravitaillements, corrections, audit pompiste, etc.). -->
        ${(isDirection(profile.role) || isSuperAdmin(profile.role) || profile.role === 'drh') ? `
        <div class="alerts-wrapper" id="alerts-wrapper">
          <button class="btn-alerts" id="btn-alerts" title="Alertes" aria-label="Voir les alertes">
            <span class="btn-alerts-ico">${icon('bell', { size: 19 })}</span>
            <span class="btn-alerts-badge" id="alerts-count" hidden>0</span>
          </button>
          <div class="alerts-dropdown hidden" id="alerts-dropdown" role="menu">
            <div class="alerts-dropdown-header">
              <strong>Alertes actives</strong>
              <span class="muted" id="alerts-dropdown-count">—</span>
              <button type="button" class="btn-mark-all-read" id="btn-mark-all-read" title="Tout marquer lu">Tout marquer lu</button>
            </div>
            <ul class="alerts-dropdown-list" id="alerts-dropdown-list">
              <li class="alerts-empty">Chargement…</li>
            </ul>
          </div>
        </div>
        ` : ''}

        ${userChip}
      </header>
      <main class="main">
        ${profile.viewingAs ? `
          <div class="alert" id="bandeau-view-as" style="background:rgba(180,120,40,0.22);border:2px solid #c93;font-weight:bold;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="display:inline-flex;align-items:center;gap:8px;">${icon('eye', { size: 18 })}<span><strong>Mode aperçu</strong> : tu vois le site comme <strong>${escapeHtml(ROLE_LABELS[profile.viewingAs] || profile.viewingAs)}</strong>.
            Tes vrais droits restent <strong>${escapeHtml(ROLE_LABELS[profile.roleReel] || profile.roleReel)}</strong>.</span></span>
            <button class="btn btn-ghost" id="btn-quitter-apercu" type="button" style="padding:4px 12px;margin-left:auto;display:inline-flex;align-items:center;gap:6px;">${icon('corner-up-left', { size: 15 })}<span>Revenir à ma vue ${escapeHtml(ROLE_LABELS[profile.roleReel] || '')}</span></button>
          </div>
        ` : ''}
        ${profile.bloque ? `
          <div class="alert" style="background:rgba(220,40,40,0.20);border:2px solid var(--color-blood);font-weight:bold;margin-bottom:12px;display:flex;align-items:flex-start;gap:8px;">
            <span style="flex-shrink:0;margin-top:1px;">${icon('lock', { size: 18 })}</span><span><strong>COMPTE BLOQUÉ — 3 avertissements actifs.</strong>
            Tu peux consulter le site mais aucune écriture, déclaration ou ravitaillement n'est possible.
            Contacte la direction pour qu'elle retire un avertissement et débloque ton compte.</span>
          </div>
        ` : ''}
        ${mainContentHtml}
        <footer class="app-footer" style="margin-top:32px;padding:14px 0 8px;border-top:1px solid rgba(210,180,140,0.12);font-size:0.72rem;color:rgba(210,180,140,0.5);text-align:center;letter-spacing:0.02em;">
          <span id="footer-changelog" role="button" tabindex="0" title="Voir le journal des mises à jour" style="cursor:pointer;border-bottom:1px dotted rgba(210,180,140,0.4);">LTD Little Seoul · v${VERSION} — by ${AUTHOR}</span>
        </footer>
      </main>
    </div>
    <div id="toast-container"></div>
  `;

  // Si le compte est bloque, on grise visuellement les boutons d'action
  // sensibles. La protection reelle est cote Cloud Functions + Firestore
  // rules — c'est juste de l'UX pour eviter les clics qui echoueraient.
  if (profile.bloque) {
    setTimeout(() => {
      document.querySelectorAll('button.btn-primary, button.btn-danger').forEach(b => {
        if (b.id === 'btn-logout' || b.id === 'btn-menu' || b.id === 'btn-back') return;
        b.disabled = true;
        b.title = 'Compte bloqué (3 avertissements actifs)';
        b.style.opacity = '0.5';
        b.style.cursor = 'not-allowed';
      });
    }, 50);
  }

  // === Portail modaux : echappe les .modal-backdrop vers <body> ===
  // Necessaire car .panel a backdrop-filter, ce qui transforme le containing
  // block des descendants position:fixed -> modal contraint au panel au lieu
  // du viewport. Move vers body resoud quel que soit l'ancetre. Les event
  // listeners attaches par getElementById restent valides apres move.
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    if (m.parentElement !== document.body) document.body.appendChild(m);
  });

  // === Auto-reload sur nouvelle version (clients FiveM/CEF qui ne peuvent
  // pas faire Ctrl+Shift+R). Polling 5 min : fetch version.js raw avec
  // cache:no-store, si la VERSION distante differe de la VERSION chargee
  // -> location.reload(). Cache-busting via query string pour eviter le
  // cache CDN GitHub Pages. Les releases sont manuelles, 5 min suffit
  // largement (60s etait inutilement agressif). ===
  if (!window.__ltdVersionPolling) {
    window.__ltdVersionPolling = setInterval(async () => {
      try {
        const res = await fetch('js/version.js?_t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const match = text.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (match && match[1] && match[1] !== VERSION) {
          // Ne pas couper une saisie en cours : on attend le prochain tick.
          const tag = document.activeElement?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          console.log('[auto-reload] nouvelle version :', match[1], '(actuelle :', VERSION + ')');
          window.location.reload();
        }
      } catch { /* ignore network blips */ }
    }, 300_000);
  }

  // === Panneaux repliables (.panel.framed) ===
  // Attache le bouton ▾/▸ sur les panneaux deja presents, puis observe le
  // <main> pour capter ceux ajoutes dynamiquement par les pages (rendus
  // apres fetch Firestore, modales, etc.).
  initCollapsiblePanels(document);
  observeMain();

  // === Quitter le mode apercu (admin reel) ===
  const btnQuitter = document.getElementById('btn-quitter-apercu');
  if (btnQuitter) {
    btnQuitter.addEventListener('click', () => {
      clearViewAsRole();
      window.location.reload();
    });
  }

  // === Déconnexion ===
  document.getElementById('btn-logout').addEventListener('click', deconnecter);

  // === Journal des mises à jour (clic sur la signature de version du footer) ===
  const footerSig = document.getElementById('footer-changelog');
  if (footerSig) {
    const openChangelog = () => {
      // IMPORTANT : .confirm-message est en white-space:pre-wrap -> le HTML doit
      // etre genere SANS retours a la ligne (sinon chaque \n devient un saut visible).
      const html = CHANGELOG.map((e) =>
        '<div style="margin:0 0 12px;padding:10px 12px;text-align:left;border-left:3px solid var(--color-blood,#8B0000);background:rgba(255,255,255,0.03);border-radius:0 8px 8px 0;">'
        + '<div style="font-weight:700;color:var(--color-gold,#c9a961);font-size:0.95em;">v' + escapeHtml(e.version)
        + ' <span style="font-weight:400;color:var(--color-sand,#D2B48C);opacity:0.75;font-size:0.88em;">· ' + escapeHtml(e.date) + '</span></div>'
        + '<div style="font-weight:600;color:var(--color-sand-light,#E7ECF3);margin:2px 0 6px;">' + escapeHtml(e.title) + '</div>'
        + '<ul style="margin:0;padding-left:17px;">'
        + e.items.map((it) => '<li style="margin-bottom:3px;line-height:1.5;font-size:0.93em;">' + escapeHtml(it) + '</li>').join('')
        + '</ul></div>'
      ).join('');
      infoModal({
        titre: 'Journal des mises à jour',
        message: '<div style="white-space:normal;max-height:52vh;overflow-y:auto;padding-right:6px;">' + html + '</div>',
        btnOk: 'Fermer'
      });
    };
    footerSig.addEventListener('click', openChangelog);
    footerSig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChangelog(); } });
  }

  // === Bouton retour ===
  document.getElementById('btn-back').addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    }
  });

  // === Menu hamburger (responsive : ouvre/ferme sidebar) ===
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btnMenu = document.getElementById('btn-menu');

  const openSidebar  = () => { sidebar.classList.add('open'); overlay.classList.add('open'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };

  btnMenu.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('[data-nav-link]').forEach(a => {
    a.addEventListener('click', () => closeSidebar());
  });

  // === Repli "rail" de la sidebar (desktop) + repli des categories ===
  // Purement visuel : aucune cible de nav, permission ou handler metier
  // n'est touche. L'etat est persiste en localStorage (par navigateur).
  const appShell = document.querySelector('.app-shell');
  const btnRail  = document.getElementById('btn-rail-toggle');
  const railIco  = btnRail?.querySelector('.rail-toggle-ico');
  const LS_RAIL  = 'ltd-sidebar-collapsed';
  const LS_GROUP = 'ltd-navgroup:'; // + nom de groupe

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function applyRail(collapsed) {
    if (!appShell) return;
    appShell.classList.toggle('sidebar-collapsed', collapsed);
    if (btnRail) {
      btnRail.title = collapsed ? 'Déplier le menu' : 'Replier le menu';
      btnRail.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    if (railIco) railIco.innerHTML = icon(collapsed ? 'chevrons-right' : 'chevrons-left', { size: 16 });
  }

  // Restauration etat rail au chargement
  applyRail(lsGet(LS_RAIL) === '1');

  if (btnRail) {
    btnRail.addEventListener('click', () => {
      const next = !appShell.classList.contains('sidebar-collapsed');
      applyRail(next);
      lsSet(LS_RAIL, next ? '1' : '0');
    });
  }

  // Categories repliables : chaque .nav-group a un bouton-titre [data-group-toggle]
  sidebar.querySelectorAll('.nav-group').forEach(groupEl => {
    const name   = groupEl.getAttribute('data-group') || '';
    const toggle = groupEl.querySelector('[data-group-toggle]');
    if (!toggle) return;

    const setGroup = (collapsed) => {
      groupEl.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };
    // Default = deplie ; '1' en storage = replie
    setGroup(lsGet(LS_GROUP + name) === '1');

    toggle.addEventListener('click', () => {
      // En mode rail, les titres sont masques : on ne replie pas par erreur
      if (appShell?.classList.contains('sidebar-collapsed')) return;
      const next = !groupEl.classList.contains('collapsed');
      setGroup(next);
      lsSet(LS_GROUP + name, next ? '1' : '0');
    });
  });

  // === Cloche d'alertes : ouverture/fermeture du dropdown ===
  // La cloche n'est rendue que pour direction/DRH/admin-tech. Pour les autres
  // roles, les elements DOM n'existent pas : on skip tout le bloc.
  const btnAlerts      = document.getElementById('btn-alerts');
  const alertsDropdown = document.getElementById('alerts-dropdown');
  const alertsWrapper  = document.getElementById('alerts-wrapper');

  if (!btnAlerts || !alertsDropdown || !alertsWrapper) {
    return; // pas de cloche pour ce role -> on s'arrete la
  }

  const openAlerts  = () => alertsDropdown.classList.remove('hidden');
  const closeAlerts = () => alertsDropdown.classList.add('hidden');

  btnAlerts.addEventListener('click', (e) => {
    e.stopPropagation();
    if (alertsDropdown.classList.contains('hidden')) openAlerts(); else closeAlerts();
  });
  // Click outside ferme
  document.addEventListener('click', (e) => {
    if (!alertsWrapper.contains(e.target)) closeAlerts();
  });

  // Fermer Sidebar OU Alertes avec Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sidebar.classList.contains('open')) closeSidebar();
    if (!alertsDropdown.classList.contains('hidden')) closeAlerts();
  });

  // === Compteur + dropdown d'alertes — temps réel ===
  const badge       = document.getElementById('alerts-count');
  const dropList    = document.getElementById('alerts-dropdown-list');
  const dropCount   = document.getElementById('alerts-dropdown-count');

  // "Tout marquer lu" : un seul commit en lot
  const btnMarkAllRead = document.getElementById('btn-mark-all-read');
  if (btnMarkAllRead) {
    btnMarkAllRead.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await marquerToutesAlertesLues();
      } catch (err) {
        console.error('marquerToutesAlertesLues:', err);
      }
    });
  }

  listenAlertesActives(alertes => {
    if (!badge) return;
    // Le badge ne compte que les NON-lues (alertes lu=true sont visibles
    // dans le dropdown mais grisees, plus dans le compteur).
    const nonLues = alertes.filter(a => !a.lu);
    if (nonLues.length > 0) {
      badge.textContent = nonLues.length > 99 ? '99+' : nonLues.length;
      badge.hidden = false;
      btnAlerts.classList.add('has-alerts');
    } else {
      badge.hidden = true;
      btnAlerts.classList.remove('has-alerts');
    }
    dropCount.textContent = `${alertes.length} alerte${alertes.length > 1 ? 's' : ''}${nonLues.length < alertes.length ? ` (${nonLues.length} non lue${nonLues.length > 1 ? 's' : ''})` : ''}`;
    btnMarkAllRead.hidden = nonLues.length === 0;

    if (alertes.length === 0) {
      dropList.innerHTML = `<li class="alerts-empty"><span style="display:inline-flex;align-items:center;gap:6px;justify-content:center;">${icon('check', { size: 16 })}<span>Aucune alerte active. Tout va bien.</span></span></li>`;
      return;
    }

    // Limiter à 30 alertes affichées (le scroll se fera dans le dropdown)
    const items = alertes.slice(0, 30);
    dropList.innerHTML = items.map(a => {
      const href  = alertHref(a);
      const ico   = alertIcon(a.type);
      const grav  = a.gravite || 'warn';
      const heure = relativeTime(a.timestamp);
      const luCls = a.lu ? ' alert-lu' : '';
      const btnLu = a.lu ? '' : `<button type="button" class="alert-mark-read" data-mark-read="${a.id}" title="Marquer lu" aria-label="Marquer lu">${icon('check', { size: 14 })}</button>`;
      const inner = `
        <span class="alert-ico">${ico}</span>
        <div class="alert-body">
          <div class="alert-msg">${escapeHtml(a.message || a.type)}</div>
          <div class="alert-meta">
            <span class="alert-type alert-type-${escapeHtml(grav)}">${escapeHtml(a.type)}</span>
            <span class="alert-time">${heure}</span>
          </div>
        </div>
        ${btnLu}
        ${href ? `<span class="alert-arrow">${icon('arrow-right', { size: 15 })}</span>` : ''}
      `;
      return href
        ? `<li><a class="alert-item alert-grav-${escapeHtml(grav)}${luCls}" href="${href}" data-alert-link>${inner}</a></li>`
        : `<li><div class="alert-item alert-grav-${escapeHtml(grav)}${luCls}">${inner}</div></li>`;
    }).join('');

    // Fermer le dropdown au clic sur une alerte (avant la navigation)
    dropList.querySelectorAll('[data-alert-link]').forEach(a => {
      a.addEventListener('click', () => closeAlerts());
    });
    // "Marquer lu" individuel : ne pas naviguer, juste mettre lu=true
    dropList.querySelectorAll('[data-mark-read]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-mark-read');
        try { await marquerAlerteLue(id); }
        catch (err) { console.error('marquerAlerteLue:', err); }
      });
    });
  });
}

function getPageTitle(key) {
  const map = {
    dashboard: 'Tableau de bord',
    stocks_epicerie: 'Stocks épicerie',
    stocks_essence: 'Stations essence',
    ventes: 'Ventes',
    comptabilite: 'Comptabilité',
    rh: 'Ressources humaines',
    admin: 'Administration',
    employee: 'Mon espace',
    paies: 'Mes paies',
    guide: 'Guide d\'utilisation',
    banque: 'Banque LTD',
    notes_frais: 'Notes de frais',
    tuto: 'Tutoriel'
  };
  return map[key] || 'LTD Little Seoul';
}
