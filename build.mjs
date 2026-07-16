// ============================================================
// Build front LTD Little Seoul — bundle + minifie chaque page.
// ------------------------------------------------------------
// Chaque public/js/pages/X.js → public/js/dist/X.js (1 fichier minifié au lieu
// d'une cascade de ~14 modules ES). Les imports Firebase (https://www.gstatic…)
// restent EXTERNES → chargés depuis le CDN Google, pas bundlés.
// Lancé en CI (GitHub Actions) avant le déploiement Pages : si ce build échoue,
// rien n'est déployé (l'ancienne version reste en ligne).
//   Local : npm install && node build.mjs
// ============================================================
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync } from 'fs';

const SRC = 'public/js/pages';
const OUT = 'public/js/dist';
const entries = readdirSync(SRC).filter(f => f.endsWith('.js')).map(f => `${SRC}/${f}`);

const externalHttps = {
  name: 'external-https',
  setup(b) { b.onResolve({ filter: /^https?:\/\// }, a => ({ path: a.path, external: true })); }
};

await build({
  entryPoints: entries,
  bundle: true,
  format: 'esm',        // garde le top-level await (déjà utilisé par le site)
  minify: true,
  target: 'es2022',
  outdir: OUT,
  plugins: [externalHttps],
  logLevel: 'info'
});
console.log(`Build OK — ${entries.length} pages bundlées dans ${OUT}/`);

// ============================================================
// Anti-cache : injecte ?v=<version> sur chaque référence locale .js / .css des
// pages HTML. Le navigateur re-télécharge le bundle dès qu'une nouvelle version
// est déployée (plus de JS périmé servi pendant 10 min par le cache GitHub Pages).
// Version = SHA du commit en CI (stable par commit), sinon timestamp en local.
// Les URLs externes (Firebase CDN https://…) ne sont pas touchées.
// N.B. : rewrite des HTML dans public/ APRÈS le bundle → la CI déploie le résultat.
// Ne PAS committer les HTML modifiés (garder le repo propre) — la CI le fait à la volée.
// ============================================================
const VERSION = String(process.env.GITHUB_SHA || Date.now()).slice(0, 12);
const RE_ASSET = /\b(src|href)="(?!https?:|\/\/|data:|#)([^"?]+\.(?:js|css))(\?v=[^"]*)?"/g;
let htmlCount = 0;
for (const f of readdirSync('public').filter(f => f.endsWith('.html'))) {
  const p = `public/${f}`;
  const before = readFileSync(p, 'utf8');
  const after = before.replace(RE_ASSET, (_m, attr, path) => `${attr}="${path}?v=${VERSION}"`);
  if (after !== before) { writeFileSync(p, after); htmlCount++; }
}
console.log(`Anti-cache — ?v=${VERSION} injecté dans ${htmlCount} page(s) HTML.`);
