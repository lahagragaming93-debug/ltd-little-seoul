// ============================================================
// Script d'initialisation — stocks Firestore depuis snapshot
// coffres LTD du 2026-05-10 (relevé manuel).
// ============================================================
// Usage :
//   1. Télécharger une cle de compte de service depuis
//      Firebase Console > Project Settings > Service accounts >
//      Generate new private key → enregistrer dans
//      firebase/serviceAccountKey.json (gitignore).
//   2. cd firebase/functions
//   3. node scripts/init-stocks.js          → dry-run (affiche sans ecrire)
//   4. node scripts/init-stocks.js --apply  → execute l'ecriture Firestore
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../serviceAccountKey.json');

// === Donnees source ===
// Chaque entree : { id catalogue, nom affiche, quantite }
// Pour les items presents dans plusieurs coffres, les quantites ont ete
// sommees (commentaire en fin de ligne).
const STOCKS = [
  // --- Epicerie (action-27310) ---
  { id: 'bouteille-eau',           nom: "Bouteille d'eau",         qty: 986 },
  { id: 'milkshake-proteine',      nom: 'Milkshake protéiné',      qty: 16 },
  { id: 'whey-fraise',             nom: 'Whey fraise',             qty: 14 },
  { id: 'whey-zero',               nom: 'Whey zero',               qty: 2 },
  { id: 'pure-whey',               nom: 'Pure Whey',               qty: 16 },
  { id: 'proteine-energy',         nom: 'Protéine Energy',         qty: 16 },
  { id: 'prot-muscle-2000',        nom: 'Prot Muscle2000',         qty: 6 },
  { id: 'proteine-vegan',          nom: 'Protéine Vegan',          qty: 312 },
  { id: 'jus-raisin-rouge',        nom: 'Jus de raisin rouge',     qty: 198 },
  { id: 'effiloche-mouton',        nom: 'Effiloché de Mouton',     qty: 198 },
  { id: 'pastelitos',              nom: 'Pastelitos',              qty: 298 },
  { id: 'koffi-caramel',           nom: 'Koffi Caramel',           qty: 299 },
  { id: 'picadillo',               nom: 'Picadillo',               qty: 298 },
  { id: 'noix',                    nom: 'Noix',                    qty: 285 },
  { id: 'baguette',                nom: 'Baguette',                qty: 5 },
  { id: 'pistache',                nom: 'Pistache',                qty: 88 },
  { id: 'creme-glacee',            nom: 'Crème Glacée',            qty: 712 },   // 412 epicerie + 300 entrepot
  { id: 'creme-fraiche',           nom: 'Crème fraîche',           qty: 748 },   // 499 epicerie + 249 entrepot
  { id: 'chewing-gum-citron',      nom: 'Chewing-gum citron',      qty: 86 },
  { id: 'bonbon-tada',             nom: 'Bonbon Tada',             qty: 68 },
  { id: 'chewing-gum-cerise',      nom: 'Chewing-gum cerise',      qty: 47 },
  { id: 'bonbon-cola',             nom: 'Bonbon Cola',             qty: 79 },
  { id: 'barre-energetique',       nom: 'Barre énergétique',       qty: 13 },
  { id: 'bonbon',                  nom: 'Bonbon',                  qty: 126 },
  { id: 'bonbon-drag',             nom: 'Bonbon Drag',             qty: 63 },
  { id: 'barre-choco-caramel',     nom: 'Barre chocolatée caramel',qty: 2445 },  // 1517 epicerie + 928 entrepot (Caramel)
  { id: 'fontaine-chocolat',       nom: 'Fontaine de chocolat',    qty: 52 },
  { id: 'chocolat',                nom: 'Chocolat',                qty: 91 },

  // --- Materiel (action-27166) ---
  { id: 'ballon-basket',           nom: 'Ballon de Basket',        qty: 11 },
  { id: 'ballon-foot',             nom: 'Ballon de Foot',          qty: 9 },
  { id: 'papier-rouler',           nom: 'Papier à Rouler',         qty: 155 },
  { id: 'spray-tag',               nom: 'Spray à tag',             qty: 2 },
  { id: 'eponge-nettoyage',        nom: 'Éponge Nettoyage',        qty: 349 },
  { id: 'herisson',                nom: 'Hérisson',                qty: 1336 },
  { id: 'croquette',               nom: 'Croquette',               qty: 114 },
  { id: 'elastique',               nom: 'Élastique',               qty: 29 },
  { id: 'solvant',                 nom: 'Solvant',                 qty: 18 },
  { id: 'porte-document',          nom: 'Porte Document',          qty: 5 },
  { id: 'trousseau-clefs',         nom: 'Trousseau de Clefs',      qty: 8 },
  { id: 'porte-feuille',           nom: 'Porte Feuille',           qty: 8 },
  { id: 'perceuse',                nom: 'Perceuse',                qty: 120 },
  { id: 'grosse-perceuse-rouge',   nom: 'Grosse Perceuse rouge',   qty: 23 },
  { id: 'perceuse-manuel',         nom: 'Perceuse manuelle',       qty: 11 },
  { id: 'fertilisant',             nom: 'Fertilisant',             qty: 106 },
  { id: 'lumiere-violette',        nom: 'Lumière Violette',        qty: 29 },
  { id: 'pot-fleur',               nom: 'Pot de Fleur',            qty: 531 },
  { id: 'table',                   nom: 'Table de travail',        qty: 143 },
  { id: 'bac-jardinage',           nom: 'Bac de jardinage',        qty: 69 },
  { id: 'canne-peche',             nom: 'Canne à pêche',           qty: 92 },
  { id: 'bicarbonate-soude',       nom: 'Bicarbonate de soude',    qty: 1999 },
  { id: 'sachet-vide',             nom: 'Sachet vide',             qty: 10000 },
  { id: 'outil',                   nom: 'Outil',                   qty: 31 },
  { id: 'cisaille',                nom: 'Cisaille',                qty: 17 },
  { id: 'pince-coupante',          nom: 'Pince Coupante',          qty: 45 },
  { id: 'pince-plaque',            nom: 'Pince pour Plaque',       qty: 26 },
  { id: 'batterie',                nom: 'Batterie',                qty: 152 },

  // --- Entrepot (action-30439) ---
  { id: 'appat-grande-qualite',    nom: 'Appât de Grande Qualité', qty: 199 },
  { id: 'caoutchouc',              nom: 'Caoutchouc',              qty: 13569 },
  { id: 'acier',                   nom: 'Acier',                   qty: 20 },
  { id: 'bouteille-eau-purifiee',  nom: "Bouteille d'eau purifiée",qty: 8450 },  // "Eau purifiée" cote FiveM
  { id: 'feve-cacao',              nom: 'Fève de Cacao',           qty: 266 },
  { id: 'barre-chocolatee',        nom: 'Barre chocolatée',        qty: 5833 },  // "Bar de chocolat" cote FiveM
  { id: 'pain-burger',             nom: 'Pain à burger',           qty: 7423 },
  { id: 'pates',                   nom: 'Pâtes',                   qty: 1370 },
  { id: 'nouille',                 nom: 'Nouille',                 qty: 50 },
  { id: 'tortilla',                nom: 'Tortilla',                qty: 73 },
  { id: 'coquille-tacos',          nom: 'Coquille à Tacos',        qty: 98 },
  { id: 'colle',                   nom: 'Colle',                   qty: 6299 },
  { id: 'bidon-peinture',          nom: 'Bidon de Peinture',       qty: 170 },
  { id: 'encre',                   nom: 'Encre',                   qty: 100 },
  { id: 'tas-terre',               nom: 'Tas de terre',            qty: 330 },
  { id: 'cuivre',                  nom: 'Cuivre',                  qty: 90 },
  { id: 'corde',                   nom: 'Corde',                   qty: 44 },
  { id: 'batterie-voiture',        nom: 'Batterie de Voiture',     qty: 39 },
  { id: 'huile',                   nom: 'Huile',                   qty: 88 },    // "Huile Jaune" cote FiveM
  { id: 'huile-noire',             nom: 'Huile Noire',             qty: 58 },
  { id: 'eponge-voiture',          nom: 'Éponge pour voiture',     qty: 4485 }
];

const APPLY = process.argv.includes('--apply');

function loadServiceAccount() {
  try {
    return JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  } catch (err) {
    console.error(`\nImpossible de lire ${KEY_PATH}`);
    console.error(`Telecharge la cle depuis Firebase Console > Project Settings > Service accounts.`);
    console.error(`Erreur: ${err.message}\n`);
    process.exit(1);
  }
}

async function main() {
  const total = STOCKS.length;
  const totalQty = STOCKS.reduce((s, x) => s + x.qty, 0);

  console.log('='.repeat(60));
  console.log(`Init stocks Firestore — ${APPLY ? 'APPLY' : 'DRY-RUN (utilise --apply pour ecrire)'}`);
  console.log('='.repeat(60));
  console.log(`${total} items, ${totalQty.toLocaleString('fr-FR')} unites au total`);
  console.log(`3 items sommes : creme-glacee (412+300=712), creme-fraiche (499+249=748), barre-choco-caramel (1517+928=2445)`);
  console.log('');

  if (!APPLY) {
    for (const s of STOCKS) {
      console.log(`  ${s.id.padEnd(24)} = ${String(s.qty).padStart(6)}   (${s.nom})`);
    }
    console.log('\nDry-run termine. Relance avec --apply pour executer.');
    process.exit(0);
  }

  const sa = loadServiceAccount();
  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id
  });
  const db = getFirestore();

  let okCount = 0;
  let errCount = 0;
  for (const s of STOCKS) {
    try {
      await db.collection('stocks').doc(s.id).set({
        quantite: s.qty,
        nom: s.nom,
        derniereMaj: FieldValue.serverTimestamp(),
        par: 'init-script-2026-05-10'
      }, { merge: true });
      okCount++;
      process.stdout.write(`. `);
    } catch (err) {
      errCount++;
      console.error(`\nERR ${s.id}: ${err.message}`);
    }
  }
  console.log(`\n\nDone: ${okCount} ecrits, ${errCount} erreurs.`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
