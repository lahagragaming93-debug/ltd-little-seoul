// ============================================================
// Script de RESYNC des stocks LTD (SET absolu, pas increment)
// ============================================================
// Force la quantite de chaque item liste ci-dessous en fonction du
// comptage manuel des coffres IG (screens copatronne 2026-05-XX).
// Ecrase la valeur actuelle dans /stocks/{id}.quantite. Les
// mouvementsStock historiques sont CONSERVES.
// ============================================================
// Usage :
//   1. Remplir le tableau STOCKS ci-dessous (id catalogue + qty reelle IG)
//   2. cd firebase/functions
//   3. node scripts/resync-stocks.js          → dry-run (affiche sans ecrire)
//   4. node scripts/resync-stocks.js --apply  → execute le SET Firestore
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../serviceAccountKey.json');
const APPLY     = process.argv.includes('--apply');

// ============================================================
// === ZONE A REMPLIR : comptage manuel des coffres LTD ========
// ============================================================
// Format : { id: 'id-catalogue', nom: 'Nom display', qty: NOMBRE_REEL }
// - id : doit correspondre a un id du catalogue (cf. public/js/data/produits.js)
// - qty : somme totale toutes positions du coffre + sous-coffres
// - Si un item n'apparait pas ici, son /stocks/{id} reste inchange.
// ============================================================

const STOCKS = [
  // --- Materiel (action-27166) — comptage 2026-05-10 ---
  { id: 'ballon-basket',           nom: 'Ballon de Basket',        qty: 11    }, // 0-1
  { id: 'ballon-foot',             nom: 'Ballon de Foot',          qty: 8     }, // 0-1
  { id: 'papier-rouler',           nom: 'Papier à Rouler',         qty: 154   }, // 0-1
  { id: 'spray-tag',               nom: 'Spray à tag',             qty: 1     }, // 0-1 (badge non visible)
  { id: 'eponge-nettoyage',        nom: 'Éponge Nettoyage',        qty: 347   }, // 0-1
  { id: 'herisson',                nom: 'Hérisson',                qty: 1335  }, // 0-1
  { id: 'croquette',               nom: 'Croquette',               qty: 114   }, // 0-1
  { id: 'elastique',               nom: 'Élastique',               qty: 28    }, // 0-1
  { id: 'solvant',                 nom: 'Solvant',                 qty: 17    }, // 0-1
  { id: 'porte-document',          nom: 'Porte Document',          qty: 4     }, // 0-2
  { id: 'trousseau-clefs',         nom: 'Trousseau de Clefs',      qty: 7     }, // 0-2
  { id: 'porte-feuille',           nom: 'Porte Feuille',           qty: 7     }, // 0-2
  { id: 'perceuse',                nom: 'Perceuse',                qty: 119   }, // 0-3
  { id: 'grosse-perceuse-rouge',   nom: 'Grosse Perceuse rouge',   qty: 22    }, // 0-3
  { id: 'perceuse-manuel',         nom: 'Perceuse manuelle',       qty: 10    }, // 0-3
  { id: 'fertilisant',             nom: 'Fertilisant',             qty: 105   }, // 0-4 (N°2 0-5 manquant)
  { id: 'lumiere-violette',        nom: 'Lumière Violette',        qty: 28    }, // 0-6
  { id: 'pot-fleur',               nom: 'Pot de Fleur',            qty: 530   }, // 0-7
  { id: 'table',                   nom: 'Table de travail',        qty: 142   }, // 0-8
  { id: 'bac-jardinage',           nom: 'Bac de jardinage',        qty: 68    }, // 0-9
  { id: 'canne-peche',             nom: 'Canne à pêche',           qty: 91    }, // 0-12
  { id: 'bicarbonate-soude',       nom: 'Bicarbonate de soude',    qty: 1998  }, // 0-13
  { id: 'sachet-vide',             nom: 'Sachet vide',             qty: 10000 }, // 0-14
  { id: 'outil',                   nom: 'Outil',                   qty: 30    }, // 0-16 (Pince)
  { id: 'cisaille',                nom: 'Cisaille',                qty: 16    }, // 0-16 (Pince)
  { id: 'pince-coupante',          nom: 'Pince Coupante',          qty: 44    }, // 0-16 (Pince)
  { id: 'pince-plaque',            nom: 'Pince pour Plaque',       qty: 25    }, // 0-16 (Pince)
  { id: 'batterie',                nom: 'Batterie',                qty: 151   }, // 0-17

  // --- Epicerie (action-27310) — comptage 2026-05-10 ---
  { id: 'bouteille-eau',           nom: "Bouteille d'eau",         qty: 985   }, // 27310-0-1 (585) + 30439-0-9 (400)
  { id: 'milkshake-proteine',      nom: 'Milkshake protéiné',      qty: 15    }, // 0-4
  { id: 'whey-fraise',             nom: 'Whey fraise',             qty: 13    }, // 0-4
  { id: 'whey-zero',               nom: 'Whey zero',               qty: 1     }, // 0-4
  { id: 'pure-whey',               nom: 'Pure Whey',               qty: 15    }, // 0-4
  { id: 'proteine-energy',         nom: 'Protéine Energy',         qty: 15    }, // 0-4
  { id: 'prot-muscle-2000',        nom: 'Prot Muscle2000',         qty: 5     }, // 0-4
  { id: 'proteine-vegan',          nom: 'Protéine Vegan',          qty: 311   }, // 0-4
  { id: 'jus-raisin-rouge',        nom: 'Jus de raisin rouge',     qty: 197   }, // 0-5
  { id: 'effiloche-mouton',        nom: 'Effiloché de Mouton',     qty: 197   }, // 0-5
  { id: 'pastelitos',              nom: 'Pastelitos',              qty: 297   }, // 0-6
  { id: 'koffi-caramel',           nom: 'Koffi Caramel',           qty: 298   }, // 0-6
  { id: 'picadillo',               nom: 'Picadillo',               qty: 297   }, // 0-6
  { id: 'noix',                    nom: 'Noix',                    qty: 284   }, // 0-7
  { id: 'baguette',                nom: 'Baguette',                qty: 5     }, // 0-7 (item sans nom interne FiveM)
  { id: 'pistache',                nom: 'Pistache',                qty: 87    }, // 0-7
  { id: 'creme-glacee-pot',        nom: 'Crème glacée pot',        qty: 303   }, // 27310-0-8 (3) + 30439-0-14 (300, en pot par decision user)
  { id: 'creme-glacee-cornet',     nom: 'Crème glacée cornet',     qty: 103   }, // 27310-0-8
  { id: 'creme-fraiche',           nom: 'Crème fraîche',           qty: 498   }, // 27310-0-8 (249) + 30439-0-13 (249)
  { id: 'chewing-gum-citron',      nom: 'Chewing-gum citron',      qty: 85    }, // 0-10
  { id: 'bonbon-tada',             nom: 'Bonbon Tada',             qty: 67    }, // 0-10
  { id: 'chewing-gum-cerise',      nom: 'Chewing-gum cerise',      qty: 46    }, // 0-10
  { id: 'bonbon-cola',             nom: 'Bonbon Cola',             qty: 78    }, // 0-10 (item sans nom interne FiveM)
  { id: 'barre-energetique',       nom: 'Barre énergétique',       qty: 12    }, // 0-10 (item sans nom interne FiveM)
  { id: 'bonbon',                  nom: 'Bonbon',                  qty: 125   }, // 0-10
  { id: 'bonbon-drag',             nom: 'Bonbon Drag',             qty: 62    }, // 0-10
  { id: 'barre-choco-caramel',     nom: 'Barre chocolatée caramel',qty: 1516  }, // 27310-0-11 (588) + 30439-0-15 (928)
  { id: 'fontaine-chocolat',       nom: 'Fontaine de chocolat',    qty: 51    }, // 0-11
  { id: 'chocolat',                nom: 'Chocolat',                qty: 90    }, // 0-11

  // --- Entrepot (action-30439) — comptage 2026-05-10 ---
  { id: 'appat-grande-qualite',    nom: 'Appât de Grande Qualité', qty: 198   }, // 0-1
  { id: 'caoutchouc',              nom: 'Caoutchouc',              qty: 21568 }, // 0-4 (7996) + 0-5 (8000) + 0-6 (5572)
  { id: 'acier',                   nom: 'Acier',                   qty: 20    }, // 0-6
  { id: 'bouteille-eau-purifiee',  nom: "Bouteille d'eau purifiée", qty: 8450 }, // 0-7
  { id: 'feve-cacao',              nom: 'Fève de Cacao',           qty: 265   }, // 0-10
  { id: 'barre-chocolatee',        nom: 'Barre chocolatée',        qty: 5832  }, // 0-10 (Bar de chocolat)
  { id: 'pain-burger',             nom: 'Pain à burger',           qty: 7422  }, // 0-11
  { id: 'pates',                   nom: 'Pâtes',                   qty: 1369  }, // 0-12
  { id: 'nouille',                 nom: 'Nouille',                 qty: 49    }, // 0-12
  { id: 'tortilla',                nom: 'Tortilla',                qty: 72    }, // 0-12
  { id: 'coquille-tacos',          nom: 'Coquille à Tacos',        qty: 97    }, // 0-12
  { id: 'colle',                   nom: 'Colle',                   qty: 6298  }, // 0-16
  { id: 'bidon-peinture',          nom: 'Bidon de Peinture',       qty: 169   }, // 0-16
  { id: 'encre',                   nom: 'Encre',                   qty: 99    }, // 0-18
  { id: 'tas-terre',               nom: 'Tas de terre',            qty: 330   }, // 0-19 (item sans nom interne FiveM)
  { id: 'cuivre',                  nom: 'Cuivre',                  qty: 89    }, // 0-20
  { id: 'corde',                   nom: 'Corde',                   qty: 43    }, // 0-21
  { id: 'batterie-voiture',        nom: 'Batterie de Voiture',     qty: 38    }, // 0-22
  { id: 'huile',                   nom: 'Huile',                   qty: 87    }, // 0-22 (Huile Jaune)
  { id: 'huile-noire',             nom: 'Huile Noire',             qty: 57    }, // 0-22
  { id: 'eponge-voiture',          nom: 'Éponge pour voiture',     qty: 4484  }  // 0-23
];

// ============================================================

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

  if (total === 0) {
    console.log('Aucun item a resync. Remplir la zone STOCKS dans le script.');
    process.exit(0);
  }

  const totalQty = STOCKS.reduce((s, x) => s + x.qty, 0);

  console.log('='.repeat(60));
  console.log(`Resync stocks Firestore — ${APPLY ? 'APPLY' : 'DRY-RUN (utilise --apply pour ecrire)'}`);
  console.log('='.repeat(60));
  console.log(`${total} items a resync, ${totalQty.toLocaleString('fr-FR')} unites au total`);
  console.log('Mode: SET ABSOLU (ecrase la valeur actuelle)');
  console.log('');

  if (!APPLY) {
    for (const s of STOCKS) {
      console.log(`  ${s.id.padEnd(28)} = ${String(s.qty).padStart(6)}   (${s.nom})`);
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

  let okCount  = 0;
  let errCount = 0;
  for (const s of STOCKS) {
    try {
      await db.collection('stocks').doc(s.id).set({
        quantite: s.qty,
        nom: s.nom,
        derniereMaj: FieldValue.serverTimestamp(),
        par: 'resync-script'
      }, { merge: true });
      okCount++;
      process.stdout.write(`. `);
    } catch (err) {
      errCount++;
      console.error(`\nERR ${s.id}: ${err.message}`);
    }
  }
  console.log(`\n\nDone: ${okCount} ecrits, ${errCount} erreurs.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
