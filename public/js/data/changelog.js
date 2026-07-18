// ============================================================
// Journal des mises à jour — LTD Little Seoul
// Affiché dans la modale ouverte en cliquant sur la signature
// de version (footer). La version la plus récente en premier.
// Routine : à CHAQUE mise à jour, ajouter une entrée ici ET
// bumper VERSION dans js/version.js.
// ============================================================

export const CHANGELOG = [
  {
    version: '1.1.0',
    date: '18/07/2026',
    title: 'Nouvelle grille de grades',
    items: [
      "Les grades de la tablette ont été renommés selon la nouvelle grille : Directeur, Directeur Adjoint, Ressources Humaines, Chef d'équipe Boutique, Chef d'équipe Pompiste, Vendeur expérimenté, Vendeur novice, Pompiste expérimenté, Pompiste novice.",
      "Les grades intermédiaires (Vendeur/Pompiste) et le grade Livreur ont été retirés de la création de comptes. Les permissions et les salaires de chaque grade restent inchangés."
    ]
  },
  {
    version: '1.0.2',
    date: '16/07/2026',
    title: "Correction d'affichage du journal",
    items: [
      'Mise en page du journal des mises à jour corrigée (espaces superflus supprimés).'
    ]
  },
  {
    version: '1.0.1',
    date: '16/07/2026',
    title: 'Finitions de mise en service',
    items: [
      'Journal des mises à jour accessible en cliquant sur la signature de version en bas de page.',
      'Le bouton « Ouvrir le portail BLA » de la page Comptabilité ouvre désormais votre espace déclaration dédié.',
      'Textes et exemples du guide alignés sur votre entreprise (stations paramétrées au branchement).'
    ]
  },
  {
    version: '1.0.0',
    date: '16/07/2026',
    title: 'Mise en ligne de votre plateforme',
    items: [
      'Plateforme de gestion complète : tableau de bord, ventes, stocks, stations-essence, livraisons, notes de frais, RH, paies automatiques (secteur 2) et comptabilité tenue par le cabinet BLA Corporate.',
      'Comptes de la direction créés (changement de mot de passe obligatoire à la première connexion).',
      'Clôture comptable automatique chaque dimanche, déclaration fiscale prête à importer chaque semaine.'
    ]
  }
];
