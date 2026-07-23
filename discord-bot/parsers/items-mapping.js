// ============================================================
// Mapping items FiveM → ID catalogue interne
// ============================================================
// Deux tables sont consultées par resolveItemId(), dans cet ordre :
//
//   1. INTERNAL_MAPPING : nom INTERNE FiveM (snake_case / slug exact)
//      Source : champ `item:` des embeds #logs-ig (bot Faab'Hook).
//      Match strict (insensible à la casse uniquement).
//
//   2. RAW_MAPPING : nom DISPLAY (français, avec accents/espaces).
//      Source : embeds #ventes (bot venteAuto) ou inventaire manuel.
//      Match via normalizeKey() : insensible casse/accents/séparateurs/
//      suffixe " 4$".
//
// Si aucune des deux ne matche, l'item est SKIP silencieusement.
// ============================================================

// Préfixes de coffres LTD légitimes. Le coffre FiveM est porté par
// `owner` (ex: "action-27166-0-1") — ou parfois par `source` selon
// le canal. On filtre sur le préfixe "action-XXXXX".
// Coffres LITTLE SEOUL identifiés par relevé réel du salon logs (23/07/2026,
// croisement items × owner sur 8 000 messages depuis le 16/07) :
export const SOURCES_LTD_PREFIXES = [
  'action-49676', // Carburant 1 : bidons d'essence (555 mouvements)
  'action-47319', // Carburant 2 : bidons d'essence (235)
  'action-29964', // Matériel auto : caoutchoucs, éponges, solvant, mastic, visseries
  'action-27162', // Divers : bmx, encre, portefeuilles, protéines, croquettes
  'action-27309', // Épicerie/restauration : bagels, jus, wraps, nouilles
  'action-27163'  // Admin/textile : porte-documents, contrats, tissu
  // Exclus (faible volume, propriété non confirmée) : action-73177,
  // action-77244, action-42430 — à ajouter si Morgan les confirme.
];

// ============================================================
// Table 1 : noms INTERNES FiveM (champ `item:` des embeds #logs-ig)
// ============================================================
// Source : capture exhaustive du 2026-05-10 par la copatronne (Luciana
// Angel Mars), 71 items sortis un par un des 3 coffres LTD.
const INTERNAL_MAPPING = {
  // Boissons
  water:                'bouteille-eau',
  jus_raisin:           'jus-raisin-rouge',
  latte:                'koffi-caramel',
  milkshake_proteine:   'milkshake-proteine',
  whey_fraise:          'whey-fraise',
  whey_zero:            'whey-zero',
  pure_whey:            'pure-whey',
  proteine_energy:      'proteine-energy',
  proteine_muscle2000:  'prot-muscle-2000',
  proteine_vegan:       'proteine-vegan',

  // Alimentaire
  noix:                 'noix',
  bolpistache:          'pistache',
  sourcream:            'creme-glacee-pot',     // pot de glace
  icecream:             'creme-glacee-cornet',  // cornet de glace
  sour_cream:           'creme-fraiche',        // ⚠️ avec underscore = fraîche
  bakingsoda:           'bicarbonate-soude',
  buns:                 'pain-burger',
  pasta:                'pates',
  nouille:              'nouille',
  effiloche_mouton:     'effiloche-mouton',
  pastelitos:           'pastelitos',
  picadillo:            'picadillo',
  tortilla:             'tortilla',
  tacoshell:            'coquille-tacos',

  // Confiserie
  candy:                'bonbon',
  bonbon_tagada:        'bonbon-tada',
  bonbon_dragibus:      'bonbon-drag',
  chewinggum:           'chewing-gum-citron',
  gum:                  'chewing-gum-cerise',
  caramelle:            'barre-choco-caramel',
  chocolatebar:         'barre-chocolatee',
  chocolate_fountain:   'fontaine-chocolat',
  marabou:              'chocolat',

  // Outillage (mappings contre-intuitifs confirmés par les embeds)
  drill:                'perceuse',
  heavy_duty_drill:     'grosse-perceuse-rouge',
  bigdrill:             'perceuse-manuel',
  shears:               'cisaille',
  heavy_cutters:        'pince-coupante',
  boltplate:            'pince-plaque',
  tronchese:            'outil',

  // Jardinage
  fertilizer:           'fertilisant',
  flowerpot:            'pot-fleur',
  cokeground:           'bac-jardinage',

  // Mobilier
  drugtable:            'table',

  // Électronique
  battery:              'batterie',

  // Auto
  shell_oil:            'huile',
  stock_oil:            'huile-noire',
  car_battery:          'batterie-voiture',
  vehicle_sponge:       'eponge-voiture',

  // Matière première
  rubber:               'caoutchouc',
  copper:               'cuivre',
  feve_cacao:           'feve-cacao',

  // Pêche
  canadapesca:          'canne-peche',
  turtlebait:           'appat-grande-qualite',

  // Emballage
  empty_bag:            'sachet-vide',

  // Divers
  document_holder:      'porte-document',
  wallet:               'porte-feuille',
  key_chain:            'trousseau-clefs',
  wig_glue:             'colle',
  money_ink_set:        'encre',
  corde:                'corde',
  purplelight:          'lumiere-violette',
  solvente:             'solvant',
  sponge:               'eponge-nettoyage',
  rolling_paper:        'papier-rouler',
  basketball:           'ballon-basket',
  football:             'ballon-foot',
  croquettes:           'croquette',
  herisson:             'herisson',
  elastic:              'elastique',
  petit_pot_peinture:   'bidon-peinture',

  // ============================================================
  // Slugs FlashFA — Little Seoul (relevés réels du salon logs,
  // 8 000 messages depuis le 16/07, ajoutés le 23/07/2026).
  // Correspondances SÛRES uniquement — le reste est listé plus bas.
  // ============================================================
  bidon_fuel:           'bidon-essence',
  jerry_can:            'bidon-essence',
  rubber:               'caoutchouc',
  document_holder:      'porte-document',
  vehicle_sponge:       'eponge-voiture',
  purifiedwater:        'eau-purifiee-rex-diner',
  solvente:             'solvant',
  bodyfiller:           'mastic-carrosserie',
  visseries:            'visseries',
  cloth:                'tissu',
  wallet:               'porte-feuille',
  key_chain:            'trousseau-clefs',
  nouille:              'nouille',
  buns:                 'pain-burger',
  bimx:                 'bmx',                 // variante/typo de bmx observée en réel
  spray:                'spray-tag',
  skateboard:           'skate-board',
  scratch_ticket:       'ticket-gratter',
  tacoshell:            'coquille-tacos',
  fertilizer:           'fertilisant',
  camera:               'appareil-photo',
  baquette:             'baguette',            // typo serveur observée
  cannadapesca:         'canne-peche'

  // ⚠️ Slugs FlashFA LS observés SANS produit correspondant dans notre
  // catalogue /stocks (skippés silencieusement — à trancher avec Morgan :
  // ajouter au catalogue ou hors périmètre) :
  //   bagel, wrap_golden, jus_ananas, cafedeolla, icecreambar, stickynote,
  //   money_ink_set, tablet, contrat, casquette, mangomilkshake, cocacola,
  //   caprisun, bucket_poisson, hotdog, fritespatatedouce, lait_fraise,
  //   slushy, xs_condom, tostada, pancakes, churros_sale, pilons_poulet,
  //   soda_cola, cheesecake, jus_multifruit, chocolat_hot_orange,
  //   champurrado, popcorn, jackets, phone, joint_cbd, midnight_ride,
  //   origami_crane, heartstopper, buñuelos…
  // ⚠️ Anciens items du catalogue au slug inconnu (inchangé) :
  //   bonbon-cola, cola-zero, brique-citron, menus, moutarde, noix-cajou,
  //   foret-perceuse, tas-terre, pile, huile-shell, acier…
};

const INTERNAL_NORMALIZED = Object.fromEntries(
  Object.entries(INTERNAL_MAPPING).map(([k, v]) => [k.toLowerCase(), v])
);

// ============================================================
// Table 2 : noms DISPLAY (français)
// ============================================================
// Source : embeds #ventes (bot venteAuto) et inventaire manuel.
// Lookup via normalizeKey() : insensible à la casse, aux accents, aux
// séparateurs et au suffixe monétaire " 4$".
const RAW_MAPPING = {
  // Boissons
  "Bouteille d'Eau":       'bouteille-eau',
  "Eau purifiée":          'bouteille-eau-purifiee',
  "Jus de raisin rouge":   'jus-raisin-rouge',
  "Koffi Caramel":         'koffi-caramel',
  "Milkshake protéiné":    'milkshake-proteine',
  "Whey fraise":           'whey-fraise',
  "Whey zero":             'whey-zero',
  "Pure Whey":             'pure-whey',
  "Protéine Energy":       'proteine-energy',
  "Prot Muscle2000":       'prot-muscle-2000',
  "Protéine Vegan":        'proteine-vegan',

  // Alimentaire
  "Noix":                  'noix',
  "Baguette":              'baguette',
  "Pistache":              'pistache',
  // ⚠️ Le display "Crème glacée" ne distingue pas pot/cornet — par
  // défaut on suppose pot. Les ventes-auto précises devront utiliser
  // le nom interne (sourcream/icecream).
  "Crème glacée":          'creme-glacee-pot',
  "Crème fraîche":         'creme-fraiche',
  "Tortilla":              'tortilla',
  "Coquille à tacos":      'coquille-tacos',
  "Bicarbonate de soude":  'bicarbonate-soude',
  "Pain à burger":         'pain-burger',
  "Pâtes":                 'pates',
  "Nouille":               'nouille',
  "Effiloché de Mouton":   'effiloche-mouton',
  "Pastelitos":            'pastelitos',
  "Picadillo":             'picadillo',

  // Confiserie
  "Bonbon":                'bonbon',
  "Bonbon cola":           'bonbon-cola',
  "Bonbon Tada":           'bonbon-tada',
  "Bonbon Drag":           'bonbon-drag',
  "Chewing gum citron":    'chewing-gum-citron',
  "Chewing Gum cerise":    'chewing-gum-cerise',
  "Bar de chocolat":       'barre-chocolatee',
  "Caramel":               'barre-choco-caramel',
  "Barre énergétique":     'barre-energetique',
  "Fontaine de chocolat":  'fontaine-chocolat',
  "Chocolat":              'chocolat',

  // Outillage
  "Grosse Perceuse":       'grosse-perceuse-rouge',
  "Perceuse":              'perceuse',
  "Perceuse manuel":       'perceuse-manuel',
  "Pince pour plaque":     'pince-plaque',
  "Pince coupante":        'pince-coupante',
  "Cisailles":             'cisaille',
  "Outil":                 'outil',

  // Jardinage
  "Pot de fleur":          'pot-fleur',
  "Fertilisant":           'fertilisant',
  "Tas de Terre":          'tas-terre',
  "Bac de jardinage":      'bac-jardinage',

  // Mobilier
  "Table de travail":      'table',

  // Électronique
  "Batterie":              'batterie',

  // Auto
  "Huile Jaune":           'huile',
  "Huile noir":            'huile-noire',
  "Batterie de voiture":   'batterie-voiture',
  "Eponge pour voiture":   'eponge-voiture',

  // Matière première
  "Caoutchouc":            'caoutchouc',
  "Acier":                 'acier',
  "Cuivre":                'cuivre',
  "Fève de Cacao":         'feve-cacao',

  // Pêche
  "Canne à pêche":         'canne-peche',
  "Appât grande qualité":  'appat-grande-qualite',

  // Emballage
  "Sachet vide":           'sachet-vide',

  // Variantes typos observées sur #ventes (canal ventes-auto FiveM)
  "Crème Glaci":           'creme-glacee-pot',  // typo, pot par défaut
  "Crème Fruiche":         'creme-fraiche',

  // Divers
  "Porte document":        'porte-document',
  "Porte feuille":         'porte-feuille',
  "Trousseau de clé":      'trousseau-clefs',
  "Colle":                 'colle',
  "Encre":                 'encre',
  "Corde":                 'corde',
  "Lumière violette":      'lumiere-violette',
  "Solvant":               'solvant',
  "Eponge":                'eponge-nettoyage',
  "Papier à rouler":       'papier-rouler',
  "Spray pour tag":        'spray-tag',
  "spray":                 'spray-tag', // nom interne FiveM (logs-ig)
  "Balle de basket":       'ballon-basket',
  "Balle de football":     'ballon-foot',
  "Croquettes":            'croquette',
  "Hérisson":              'herisson',
  "Élastique":             'elastique',
  "Bidon peinture":        'bidon-peinture'
};

// Normalisation pour rendre la lookup robuste : lowercase, suppression des
// accents, des espaces, des tirets, des underscores et du suffixe "$".
// Permet de matcher "Caramel 2$" → "caramel" → barre-choco-caramel.
function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\s*\d+\s*\$\s*$/u, '') // strip trailing " 4$" / "20$"
    .replace(/[\s_\-]+/g, '');
}

const NORMALIZED_MAPPING = Object.fromEntries(
  Object.entries(RAW_MAPPING).map(([k, v]) => [normalizeKey(k), v])
);

/**
 * Résout le nom d'item brut (interne FiveM ou display) vers un ID catalogue.
 * Cherche d'abord dans INTERNAL_MAPPING (snake_case), puis dans RAW_MAPPING
 * (display avec normalisation). Retourne null si rien ne matche → SKIP.
 */
export function resolveItemId(rawItem) {
  if (!rawItem) return null;
  const raw = String(rawItem).trim();
  // 1) Lookup nom interne FiveM (case-insensitive)
  const internal = INTERNAL_NORMALIZED[raw.toLowerCase()];
  if (internal) return internal;
  // 2) Fallback : lookup display name (normalisation aggressive)
  const key = normalizeKey(raw);
  return NORMALIZED_MAPPING[key] || null;
}

/**
 * Vérifie qu'un identifiant de coffre FiveM (ex: "action-27310-0-1")
 * appartient à un coffre LTD légitime. Compare le préfixe "action-XXXXX".
 */
export function isLtdSource(source) {
  if (!source) return false;
  const prefix = String(source).split('-').slice(0, 2).join('-');
  return SOURCES_LTD_PREFIXES.includes(prefix);
}
