// ============================================================
// Initialise le mapping fournisseurs dans /config/global.fournisseurs
// ============================================================
// Stocke un array de "patterns" qui permettent au handler onDepense de :
//   1. Identifier le fournisseur destinataire d'une dépense
//   2. Suggérer une catégorie + un statut déductible
// Le patron reste décisionnaire final (validation manuelle dans la page Compta).
//
// Patterns initiaux fournis par Morgan HARPER le 2026-05-14.
// Le tableau grossira au fil du temps via le bouton "Mémoriser ce fournisseur"
// dans la page Comptabilité (Cloud Function reclasserDepense).
// ============================================================
// Usage :
//   cd firebase/functions
//   node scripts/init-fournisseurs-mapping.js         dry-run
//   node scripts/init-fournisseurs-mapping.js --apply
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');
const APPLY = process.argv.includes('--apply');

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

// Structure d'un pattern :
//   id : slug unique pour identification
//   label : nom affiché du fournisseur
//   matchType : 'boutique-id' | 'compte-cible' | 'raison-regex'
//   matchValue : valeur à matcher (string)
//   categorie : slug de catégorie (matieres-premieres, frais-vehicule, ...)
//   deductible : true | false
//   raisonClassification : texte humain expliquant pourquoi (audit IRS)
//   ajoutePar : 'init' | uid du patron
//   dateAjout : ISO timestamp
const PATTERNS_INITIAUX = [
  {
    id: 'yootool',
    label: 'Yootool',
    matchType: 'boutique-id',
    matchValue: '263',
    categorie: 'matieres-premieres',
    deductible: true,
    raisonClassification: 'Fournisseur matières premières (Art. 4-2.9) — revente clients',
    ajoutePar: 'init',
    dateAjout: new Date().toISOString()
  },
  {
    id: 'fournisseur-ltd',
    label: 'Fournisseur LTD (achat en gros)',
    matchType: 'boutique-id',
    matchValue: '215',
    categorie: 'matieres-premieres',
    deductible: true,
    raisonClassification: 'Fournisseur matières premières (Art. 4-2.9) — revente clients',
    ajoutePar: 'init',
    dateAjout: new Date().toISOString()
  },
  {
    id: 'hdm',
    label: 'HDM (Heavy Duty Motors)',
    matchType: 'compte-cible',
    matchValue: 'HDM',
    categorie: 'location-vehicule',
    deductible: true,
    raisonClassification: 'Location véhicule utilitaire pour ravitaillement stations',
    ajoutePar: 'init',
    dateAjout: new Date().toISOString()
  },
  {
    id: 'dynasty-8',
    label: 'Dynasty 8',
    matchType: 'compte-cible',
    matchValue: 'Dynasty 8',
    categorie: 'decoration-locaux',
    deductible: false,
    raisonClassification: 'Décoration des locaux entreprise — non déductible TTE',
    ajoutePar: 'init',
    dateAjout: new Date().toISOString()
  },
  {
    id: 'achat-essence-carte-entreprise',
    label: 'Achat essence (carte entreprise)',
    matchType: 'raison-regex',
    matchValue: '^achat\\s+essence$',
    categorie: 'frais-vehicule',
    deductible: true,
    raisonClassification: 'Frais véhicule entreprise — Art. 4-2.12 (carte entreprise = usage pro)',
    ajoutePar: 'init',
    dateAjout: new Date().toISOString()
  }
];

async function main() {
  const cfgRef = db.collection('config').doc('global');
  const cfgSnap = await cfgRef.get();
  const existing = cfgSnap.exists ? (cfgSnap.data().fournisseurs || []) : [];

  console.log(`Mode : ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Patterns existants : ${existing.length}`);
  console.log(`Patterns initiaux à insérer : ${PATTERNS_INITIAUX.length}\n`);

  // Merge sans doublons (par id)
  const existingIds = new Set(existing.map(p => p.id));
  const aAjouter = PATTERNS_INITIAUX.filter(p => !existingIds.has(p.id));

  if (aAjouter.length === 0) {
    console.log('Aucun pattern à ajouter (tous déjà présents).');
    process.exit(0);
  }

  console.log('Patterns à ajouter :');
  for (const p of aAjouter) {
    console.log(`  + ${p.id.padEnd(35)}  ${p.matchType}=${p.matchValue.padEnd(10)}  ${p.categorie.padEnd(22)}  ${p.deductible ? '✓ dédu' : '✗ non-dédu'}`);
  }

  if (APPLY) {
    const merged = [...existing, ...aAjouter];
    await cfgRef.set({ fournisseurs: merged }, { merge: true });
    console.log(`\n✓ /config/global.fournisseurs mis à jour (${merged.length} patterns au total)`);
  } else {
    console.log('\nDry-run terminé. Relance avec --apply pour écrire.');
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
