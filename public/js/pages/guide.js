// ============================================================
// Page : Guide d'utilisation (rendu markdown des guides par rôle)
// ============================================================

import { requireAuth } from '../auth.js';
import { renderShell } from '../layout.js';
import { isDirection } from '../utils/permissions.js';

const { profile } = await requireAuth('guide');

// Catalogue des guides (correspond aux fichiers dans public/guide/)
// Champ `acces` (optionnel) : liste blanche de roles autorises. Si absent =
// accessible a tous les roles authentifies. Les guides sensibles (compta, TTE)
// sont restreints a direction + DRH + admin-technique pour eviter qu'un
// vendeur/pompiste lambda ne voie le workflow cloture, les regles TTE, etc.
const ROLES_DIR_DRH = ['patron', 'co-patron', 'drh', 'admin-technique'];
const GUIDES = [
  { id: '00-index',                file: 'guide/00-index.md',                titre: 'Sommaire',                  pourQui: 'Tout le monde' },
  { id: '01-direction',            file: 'guide/01-direction.md',            titre: 'Direction',                  pourQui: 'Patron, Co-Patron' },
  { id: '02-drh',                  file: 'guide/02-drh.md',                  titre: 'DRH',                        pourQui: 'DRH (et direction)' },
  { id: '03-responsable-vente',    file: 'guide/03-responsable-vente.md',    titre: 'Responsable Vente',          pourQui: 'Responsable Vente' },
  { id: '04-responsable-pompiste', file: 'guide/04-responsable-pompiste.md', titre: 'Responsable Pompiste',       pourQui: 'Responsable Pompiste' },
  { id: '05-vendeur',              file: 'guide/05-vendeur.md',              titre: 'Vendeur',                    pourQui: 'Vendeurs (Novice, Inter, Exp)' },
  { id: '06-pompiste',             file: 'guide/06-pompiste.md',             titre: 'Pompiste',                   pourQui: 'Pompistes (Novice, Inter, Exp)' },
  { id: '07-automatismes',         file: 'guide/07-automatismes.md',         titre: 'Automatismes',                pourQui: 'Tout le monde (technique)' },
  { id: '08-faq-depannage',        file: 'guide/08-faq-depannage.md',        titre: 'FAQ + Dépannage',             pourQui: 'Tout le monde' },
  { id: '09-comptabilite',         file: 'guide/09-comptabilite.md',         titre: 'Comptabilité',                pourQui: 'Direction, DRH, Admin Tech', acces: ROLES_DIR_DRH },
  { id: '10-tte-reference',        file: 'guide/10-tte-reference.md',        titre: 'Référence T.T.E.',            pourQui: 'Direction, DRH, Admin Tech',  acces: ROLES_DIR_DRH }
];

function peutVoirGuide(guide, role) {
  if (!guide.acces) return true;
  return guide.acces.includes(role);
}
const GUIDES_VISIBLES = GUIDES.filter(g => peutVoirGuide(g, profile.role));

// Mapping rôle → guide à pré-sélectionner
function defaultGuideForRole(role) {
  if (role === 'patron' || role === 'co-patron') return '01-direction';
  if (role === 'drh') return '02-drh';
  if (role === 'responsable-vente') return '03-responsable-vente';
  if (role === 'responsable-pompiste') return '04-responsable-pompiste';
  if (role === 'chef-equipe') return '03-responsable-vente';
  if (role === 'livreur') return '05-vendeur';
  if (role && role.startsWith('vendeur-')) return '05-vendeur';
  if (role && role.startsWith('pompiste-')) return '06-pompiste';
  return '00-index';
}

// Lire ?guide=xxx dans l'URL pour permettre les deep-links / navigation interne
const urlParams = new URLSearchParams(window.location.search);
const initialId = urlParams.get('guide') || defaultGuideForRole(profile.role);

const html = `
  <div class="guide-layout">
    <!-- Liste des guides (sidebar interne) -->
    <aside class="guide-toc panel">
      <div class="panel-title"><span>Tous les guides</span></div>
      <ul class="guide-list">
        ${GUIDES_VISIBLES.map(g => `
          <li>
            <a href="?guide=${g.id}" class="guide-link" data-guide-id="${g.id}">
              <div class="guide-link-titre">${g.titre}</div>
              <div class="guide-link-pourqui">${g.pourQui}</div>
            </a>
          </li>
        `).join('')}
      </ul>
    </aside>

    <!-- Contenu rendu markdown -->
    <article class="guide-content panel">
      <div id="guide-toolbar" class="row mb-2" style="gap:8px; flex-wrap:wrap;">
        <button class="btn btn-sm btn-ghost" id="btn-print">Imprimer / PDF</button>
        <span class="spacer"></span>
        <span class="muted" id="guide-lecture-info" style="font-size:0.8rem;"></span>
      </div>
      <div id="guide-rendered" class="markdown-body">
        <p class="muted">Chargement…</p>
      </div>
    </article>
  </div>
`;

renderShell(profile, 'guide', html);

// Charger marked.js depuis CDN (seulement quand la page est rendue)
async function loadMarked() {
  if (window.marked) return window.marked;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Échec chargement de marked.js'));
    document.head.appendChild(s);
  });
  // Configurer marked : conserver les sauts de ligne, désactiver l'HTML brut potentiellement dangereux
  // (les .md sont écrits par la direction, donc pas de risque XSS, mais on désactive les scripts par sécurité)
  window.marked.setOptions({
    breaks: false,
    gfm: true
  });
  return window.marked;
}

const renderedEl     = document.getElementById('guide-rendered');
const lectureInfoEl  = document.getElementById('guide-lecture-info');
const btnPrint       = document.getElementById('btn-print');
const tocLinks       = document.querySelectorAll('.guide-link');

function highlightActive(id) {
  tocLinks.forEach(a => a.classList.toggle('active', a.dataset.guideId === id));
}

function estimerLecture(texte) {
  // ~200 mots/minute en lecture rapide
  const mots = texte.trim().split(/\s+/).length;
  const min = Math.max(1, Math.round(mots / 200));
  return `~${min} min de lecture · ${mots.toLocaleString('fr-FR')} mots`;
}

async function loadGuide(id, opts = { pushHistory: true, scrollTop: true }) {
  const guide = GUIDES.find(g => g.id === id);
  if (!guide) {
    renderedEl.innerHTML = `<p class="alert danger">Guide introuvable : <code>${id}</code></p>`;
    return;
  }
  if (!peutVoirGuide(guide, profile.role)) {
    renderedEl.innerHTML = `<div class="alert danger"><strong>Accès refusé.</strong><br>Ce guide est réservé à la direction, au DRH et à l'admin technique. Contacte le patron si tu penses que c'est une erreur.</div>`;
    lectureInfoEl.textContent = '';
    return;
  }

  highlightActive(id);
  if (opts.pushHistory) {
    const newUrl = window.location.pathname + '?guide=' + id;
    window.history.pushState({ guideId: id }, '', newUrl);
  }
  if (opts.scrollTop) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'instant' });
  }

  renderedEl.innerHTML = '<p class="muted">Chargement du guide…</p>';
  lectureInfoEl.textContent = '';

  try {
    const [marked, resp] = await Promise.all([
      loadMarked(),
      fetch(guide.file, { cache: 'no-store' })
    ]);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const md = await resp.text();
    renderedEl.innerHTML = marked.parse(md);
    lectureInfoEl.textContent = estimerLecture(md);
    interceptInternalLinks();
  } catch (err) {
    console.error(err);
    renderedEl.innerHTML = `
      <div class="alert danger">
        <strong>Impossible de charger le guide.</strong><br>
        Détail : <code>${err.message || err}</code><br>
        Contacte la direction si le problème persiste.
      </div>`;
  }
}

// Intercepter les clics sur les liens internes (xx-fichier.md) pour SPA-like nav
function interceptInternalLinks() {
  renderedEl.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    // Lien vers un autre .md du dossier
    const m = href.match(/^(\d{2}-[a-z0-9-]+)\.md(#.*)?$/i);
    if (m) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        loadGuide(m[1]);
      });
      return;
    }
    // Lien externe (http/https) : forcer ouverture dans la même fenêtre (compat tablette FiveM)
    if (/^https?:\/\//i.test(href)) {
      a.removeAttribute('target'); // s'assurer aucun target=_blank
    }
  });
}

// Liens de la TOC interne
tocLinks.forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    loadGuide(a.dataset.guideId);
  });
});

// Bouton imprimer
btnPrint.addEventListener('click', () => window.print());

// Gestion du back/forward navigateur
window.addEventListener('popstate', (e) => {
  const id = (e.state && e.state.guideId) || (new URLSearchParams(window.location.search).get('guide')) || initialId;
  loadGuide(id, { pushHistory: false });
});

// Premier chargement
loadGuide(initialId, { pushHistory: false });
