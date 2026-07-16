// ============================================================
// Catalogue produits — prix de VENTE de référence
// Le prix d'ACHAT est saisi manuellement par le patron via /admin
// ============================================================
// Catégories alignées sur l'inventaire FiveM réel (export 2026-05-10)
// ============================================================
// pourPro = true  : produit vendu uniquement aux professionnels (autres
//                   entreprises, en gros). Direction/DRH/Resp Vente gerent
//                   ces ventes. Pas de commission vendeur, mais CA LTD compte.
// pourPro = false : produit vendu aux particuliers par les vendeurs.
//                   Commission calculee dessus (CA × commission).
// intrant = true  : matiere premiere achetee mais JAMAIS revendue. Sert
//                   uniquement comme intrant pour le craft. Section "Achat
//                   fournisseur" dans Stocks epicerie. Invisible dans toutes
//                   les modal de vente. (cf [[projet_matieres_premieres_intrants]])
// enFabrication = true : produit issu du craft (futur). Section "Produits
//                   de fabrication" dans Stocks epicerie.
// ============================================================

export const CATEGORIES = [
  'boissons', 'alimentaire', 'confiserie',
  'outillage', 'jardinage', 'mobilier',
  'electronique', 'auto', 'matiere_premiere',
  'peche', 'emballage', 'divers'
];

export const CATEGORY_LABELS = {
  boissons:         'Boissons',
  alimentaire:      'Alimentaire',
  confiserie:       'Confiserie',
  outillage:        'Outillage',
  jardinage:        'Jardinage',
  mobilier:         'Mobilier',
  electronique:     'Électronique',
  auto:             'Automobile',
  matiere_premiere: 'Matière première',
  peche:            'Pêche',
  emballage:        'Emballage',
  divers:           'Divers'
};

// prixVente = 0 et note "à compléter" pour items dont le prix n'est pas encore confirmé
export const CATALOGUE = [
  // BOISSONS
  { id: 'bouteille-eau',           nom: "Bouteille d'eau",         categorie: 'boissons',         prixVente: 10,   pourPro: true },
  { id: 'bouteille-eau-purifiee',  nom: "Bouteille d'eau purifiée", categorie: 'boissons',        prixVente: 2,    pourPro: true },
  { id: 'cola-zero',               nom: 'Cola Zero Sucre',         categorie: 'boissons',         prixVente: 4,    pourPro: false },
  { id: 'brique-citron',           nom: 'Brique de citron',        categorie: 'boissons',         prixVente: 15,   pourPro: true },
  { id: 'jus-raisin-rouge',        nom: 'Jus de raisin rouge',     categorie: 'boissons',         prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'koffi-caramel',           nom: 'Koffi Caramel',           categorie: 'boissons',         prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'milkshake-proteine',      nom: 'Milkshake protéiné',      categorie: 'boissons',         prixVente: 4,    pourPro: true },
  { id: 'whey-fraise',             nom: 'Whey fraise',             categorie: 'boissons',         prixVente: 8,    pourPro: true },
  { id: 'whey-zero',               nom: 'Whey zero',               categorie: 'boissons',         prixVente: 8,    pourPro: true },
  { id: 'pure-whey',               nom: 'Pure Whey',               categorie: 'boissons',         prixVente: 4,    pourPro: true },
  { id: 'proteine-energy',         nom: 'Protéine Energy',         categorie: 'boissons',         prixVente: 4,    pourPro: true },
  { id: 'prot-muscle-2000',        nom: 'Prot Muscle2000',         categorie: 'boissons',         prixVente: 20,   pourPro: true },
  { id: 'proteine-vegan',          nom: 'Protéine Vegan',          categorie: 'boissons',         prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },

  // ALIMENTAIRE
  { id: 'menu-burger',             nom: 'Menu Burger ice tea',     categorie: 'alimentaire',      prixVente: 90,   pourPro: true },
  { id: 'menu-simple',             nom: 'Menu simple',             categorie: 'alimentaire',      prixVente: 110,  pourPro: true },
  { id: 'menu-complet',            nom: 'Menu complet',            categorie: 'alimentaire',      prixVente: 130,  pourPro: true },
  { id: 'baguette',                nom: 'Baguette',                categorie: 'alimentaire',      prixVente: 15,   pourPro: true },
  { id: 'tortilla',                nom: 'Tortilla',                categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'coquille-tacos',          nom: 'Coquille à Tacos',        categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'moutarde',                nom: 'Moutarde',                categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'pistache',                nom: 'Pistache',                categorie: 'alimentaire',      prixVente: 8,    pourPro: true },
  { id: 'noix',                    nom: 'Noix',                    categorie: 'alimentaire',      prixVente: 8,    pourPro: true },
  { id: 'noix-cajou',              nom: 'Noix de Cajou',           categorie: 'alimentaire',      prixVente: 8,    pourPro: true },
  { id: 'creme-glacee-pot',        nom: 'Crème glacée pot',        categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'creme-glacee-cornet',     nom: 'Crème glacée cornet',     categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'creme-fraiche',           nom: 'Crème fraîche',           categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'bicarbonate-soude',       nom: 'Bicarbonate de soude',    categorie: 'alimentaire',      prixVente: 2,    pourPro: true },
  { id: 'pain-burger',             nom: 'Pain à burger',           categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'pates',                   nom: 'Pâtes',                   categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'nouille',                 nom: 'Nouille',                 categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'effiloche-mouton',        nom: 'Effiloché de Mouton',     categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'pastelitos',              nom: 'Pastelitos',              categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'picadillo',               nom: 'Picadillo',               categorie: 'alimentaire',      prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },

  // CONFISERIE
  { id: 'bonbon',                  nom: 'Bonbon',                  categorie: 'confiserie',       prixVente: 7,    pourPro: false },
  { id: 'bonbon-cola',             nom: 'Bonbon Cola',             categorie: 'confiserie',       prixVente: 7,    pourPro: false },
  { id: 'bonbon-tada',             nom: 'Bonbon Tada',             categorie: 'confiserie',       prixVente: 7,    pourPro: false },
  { id: 'bonbon-drag',             nom: 'Bonbon Drag',             categorie: 'confiserie',       prixVente: 7,    pourPro: false },
  { id: 'chewing-gum-citron',      nom: 'Chewing-gum citron',      categorie: 'confiserie',       prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'chewing-gum-cerise',      nom: 'Chewing-gum cerise',      categorie: 'confiserie',       prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'barre-chocolatee',        nom: 'Barre chocolatée',        categorie: 'confiserie',       prixVente: 18,   pourPro: true },
  { id: 'barre-choco-caramel',     nom: 'Barre chocolatée caramel',categorie: 'confiserie',       prixVente: 18,   pourPro: true },
  { id: 'barre-energetique',       nom: 'Barre énergétique',       categorie: 'confiserie',       prixVente: 4,    pourPro: true },
  { id: 'fontaine-chocolat',       nom: 'Fontaine de chocolat',    categorie: 'confiserie',       prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'chocolat',                nom: 'Chocolat',                categorie: 'confiserie',       prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },

  // OUTILLAGE
  { id: 'grosse-perceuse-rouge',   nom: 'Grosse Perceuse rouge',   categorie: 'outillage',        prixVente: 15,   pourPro: false },
  { id: 'perceuse',                nom: 'Perceuse',                categorie: 'outillage',        prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'perceuse-manuel',         nom: 'Perceuse manuelle',       categorie: 'outillage',        prixVente: 0,    pourPro: true,
    note: 'Prix à confirmer' },
  { id: 'foret-perceuse',          nom: 'Forêt de Perceuse',       categorie: 'outillage',        prixVente: 600,  pourPro: false },
  { id: 'pince-plaque',            nom: 'Pince pour Plaque',       categorie: 'outillage',        prixVente: 25,   pourPro: false },
  { id: 'pince-coupante',          nom: 'Pince Coupante',          categorie: 'outillage',        prixVente: 20,   pourPro: false },
  { id: 'cisaille',                nom: 'Cisaille',                categorie: 'outillage',        prixVente: 1500, pourPro: false },
  { id: 'outil',                   nom: 'Outil',                   categorie: 'outillage',        prixVente: 0,    pourPro: true,
    note: 'Outil générique — prix à confirmer' },

  // JARDINAGE
  { id: 'pot-fleur',               nom: 'Pot de Fleur',            categorie: 'jardinage',        prixVente: 10,   pourPro: false },
  { id: 'fertilisant',             nom: 'Fertilisant',             categorie: 'jardinage',        prixVente: 10,   pourPro: false },
  { id: 'tas-terre',               nom: 'Tas de terre',            categorie: 'jardinage',        prixVente: 14,   pourPro: false },
  { id: 'bac-jardinage',           nom: 'Bac de jardinage',        categorie: 'jardinage',        prixVente: 20,   pourPro: true },
  // MOBILIER
  { id: 'table',                   nom: 'Table de travail',        categorie: 'mobilier',         prixVente: 10,   pourPro: false },

  // ÉLECTRONIQUE
  { id: 'batterie',                nom: 'Batterie',                categorie: 'electronique',     prixVente: 10,   pourPro: true },
  { id: 'pile',                    nom: 'Pile',                    categorie: 'electronique',     prixVente: 2,    pourPro: false, intrant: true,
    note: 'Pile verte — achat Yootool, usage interne uniquement (non vendue)' },

  // AUTO
  { id: 'huile',                   nom: 'Huile',                   categorie: 'auto',             prixVente: 8,    pourPro: true },
  { id: 'huile-shell',             nom: 'Huile Shell',             categorie: 'auto',             prixVente: 12,   pourPro: true },
  { id: 'huile-noire',             nom: 'Huile Noire',             categorie: 'auto',             prixVente: 15,   pourPro: true },
  { id: 'batterie-voiture',        nom: 'Batterie de Voiture',     categorie: 'auto',             prixVente: 20,   pourPro: true },
  { id: 'eponge-voiture',          nom: 'Éponge pour voiture',     categorie: 'auto',             prixVente: 2,    pourPro: true },
  { id: 'bidon-essence',           nom: "Bidon d'essence",         categorie: 'auto',             prixVente: 0,    pourPro: false, intrant: true,
    note: 'Bidon vide acheté pour ravitailler les stations — non revendu. Compté pour quota pompiste. Intrant craft Jerrican.' },

  // MATIÈRE PREMIÈRE
  { id: 'caoutchouc',              nom: 'Caoutchouc',              categorie: 'matiere_premiere', prixVente: 6,    pourPro: true, intrant: true,
    note: 'Compté pour quota pompiste — intrant craft Jerrican' },
  { id: 'acier',                   nom: 'Acier',                   categorie: 'matiere_premiere', prixVente: 0,    pourPro: true, intrant: true,
    note: 'GB Foundry — 40$ achat (60$ TEMP pénurie)' },
  { id: 'cuivre',                  nom: 'Cuivre',                  categorie: 'matiere_premiere', prixVente: 0,    pourPro: true, intrant: true,
    note: 'GB Foundry — prix à confirmer à réouverture' },
  { id: 'feve-cacao',              nom: 'Fève de Cacao',           categorie: 'matiere_premiere', prixVente: 0,    pourPro: true, intrant: true,
    note: 'Intrant craft chocolat' },

  // PÊCHE
  { id: 'canne-peche',             nom: 'Canne à pêche',           categorie: 'peche',            prixVente: 64,   pourPro: false },
  { id: 'appat-grande-qualite',    nom: 'Appât de Grande Qualité', categorie: 'peche',            prixVente: 10,   pourPro: false },

  // EMBALLAGE
  { id: 'sachet-vide',             nom: 'Sachet vide',             categorie: 'emballage',        prixVente: 0,    pourPro: true,
    note: 'Consommable — prix à confirmer' },

  // DIVERS
  { id: 'porte-document',          nom: 'Porte Document',          categorie: 'divers',           prixVente: 8,    pourPro: false },
  { id: 'porte-feuille',           nom: 'Porte Feuille',           categorie: 'divers',           prixVente: 8,    pourPro: false },
  { id: 'trousseau-clefs',         nom: 'Trousseau de Clefs',      categorie: 'divers',           prixVente: 80,   pourPro: false },
  { id: 'colle',                   nom: 'Colle',                   categorie: 'divers',           prixVente: 2,    pourPro: false },
  { id: 'encre',                   nom: 'Encre',                   categorie: 'divers',           prixVente: 4,    pourPro: true },
  { id: 'corde',                   nom: 'Corde',                   categorie: 'divers',           prixVente: 10,   pourPro: true, intrant: true,
    note: 'Intrant craft Jerrican' },
  { id: 'lumiere-violette',        nom: 'Lumière Violette',        categorie: 'divers',           prixVente: 20,   pourPro: false, enFabrication: true,
    note: 'Crafté : 1×Plomberie + 1×Acier + 4×Câble + 2×Visserie → 16×Lumières (coût ~47.36$ TEMP)' },
  { id: 'solvant',                 nom: 'Solvant',                 categorie: 'divers',           prixVente: 25,   pourPro: true },
  { id: 'eponge-nettoyage',        nom: 'Éponge Nettoyage',        categorie: 'divers',           prixVente: 1000, pourPro: true },
  { id: 'ticket-gratter',          nom: 'Ticket à Gratter',        categorie: 'divers',           prixVente: 25,   pourPro: false },
  { id: 'papier-rouler',           nom: 'Papier à Rouler',         categorie: 'divers',           prixVente: 2,    pourPro: true },
  { id: 'spray-tag',               nom: 'Spray à tag',             categorie: 'divers',           prixVente: 2300, pourPro: true },
  { id: 'skate-board',             nom: 'Skate Board',             categorie: 'divers',           prixVente: 80,   pourPro: false },
  { id: 'trottinette-electrique',  nom: 'Trottinette électrique',  categorie: 'divers',           prixVente: 500,  pourPro: true },
  { id: 'ballon-foot',             nom: 'Ballon de Foot',          categorie: 'divers',           prixVente: 40,   pourPro: false },
  { id: 'ballon-basket',           nom: 'Ballon de Basket',        categorie: 'divers',           prixVente: 40,   pourPro: false },
  { id: 'croquette',               nom: 'Croquette',               categorie: 'divers',           prixVente: 30,   pourPro: false,
    note: 'Achat Yootool — vendable particuliers (commission). Prix d\'achat à renseigner par le patron.' },
  { id: 'herisson',                nom: 'Hérisson',                categorie: 'divers',           prixVente: 2,    pourPro: false },
  { id: 'elastique',               nom: 'Élastique',               categorie: 'divers',           prixVente: 20,   pourPro: true },
  { id: 'bidon-peinture',          nom: 'Bidon de Peinture',       categorie: 'divers',           prixVente: 4,    pourPro: true },

  // === QUINCAILLERIE — Produits craftés par les vendeurs (enFabrication=true) ===
  { id: 'visseries',               nom: 'Visseries',               categorie: 'outillage',        prixVente: 65,   pourPro: false, enFabrication: true,
    note: 'Crafté : 1×Charbon + 3×Acier → 5×Visseries (coût 26$, TEMP 38$ si acier 60$)' },
  { id: 'mastic-carrosserie',      nom: 'Mastic carrosserie',      categorie: 'auto',             prixVente: 0,    pourPro: false, enFabrication: true,
    note: 'Prix de vente et recette de craft à compléter par le patron.' },
  { id: 'plomberie',               nom: 'Plomberie',               categorie: 'divers',           prixVente: 0,    pourPro: false, enFabrication: true, intrant: true,
    note: 'Composant intermédiaire — utilisé pour Lumière violette. Crafté : 1×Charbon + 2×Cuivre + 5×Bobine → 1×Plomberie (coût 131.75$). intrant=true bloque le modal vente.' },
  { id: 'cable-electrique',        nom: 'Câble électrique',        categorie: 'electronique',     prixVente: 0,    pourPro: false, enFabrication: true, intrant: true,
    note: 'Composant intermédiaire — utilisé pour Lumière violette. Crafté : 1×Charbon + 6×Bobine → 1×Câble (coût 122.50$).' },
  { id: 'sac-jute',                nom: 'Sac en jute',             categorie: 'divers',           prixVente: 0,    pourPro: false, enFabrication: true,
    note: 'Crafté : 1×Corde + 1×Tissu → 2×Sacs en jute. Prix de vente à compléter par le patron.' },

  // === MATIÈRES PREMIÈRES INTRANTS DE CRAFT (achat fournisseur, intrant=true) ===
  { id: 'charbon',                 nom: 'Charbon',                 categorie: 'matiere_premiere', prixVente: 0,    pourPro: false, intrant: true,
    note: 'Intrant craft Visseries / Pioche / Plomberie / Câble — prix unitaire 10$ d\'après recettes' },
  { id: 'bobine-cuivre',           nom: 'Bobine de cuivre',        categorie: 'matiere_premiere', prixVente: 0,    pourPro: false, intrant: true,
    note: 'Intrant craft Plomberie / Câble électrique — prix unitaire 18.75$' },
  { id: 'tissu',                   nom: 'Tissu',                   categorie: 'matiere_premiere', prixVente: 0,    pourPro: false, intrant: true,
    note: 'Intrant craft Sac en jute — fournisseur et prix à renseigner' }
];

// Items spéciaux pour quotas pompistes (ID logs-ig)
export const ITEM_BIDON      = 'bidon-essence';
export const ITEM_CAOUTCHOUC = 'caoutchouc';

const _PRODUIT_BY_ID = new Map(CATALOGUE.map(p => [p.id, p]));
export function getProduitById(id) { return _PRODUIT_BY_ID.get(id); }
export function nomProduit(id) { return _PRODUIT_BY_ID.get(id)?.nom || id; }
