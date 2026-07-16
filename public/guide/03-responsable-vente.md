# Guide Responsable Vente

> Tu pilotes l'**épicerie** : tu gères le catalogue, les prix, les stocks. Tu vois les ventes faites par ton équipe.
> Tu **gères aussi tes vendeurs** depuis Administration : créer, modifier, suspendre, supprimer, changer leur grade.
> Tu ne décides pas les salaires (DRH et direction).

---

## Tes modules

| Module | Accès | Rôle |
|--------|-------|------|
| **Stocks épicerie** | **Lecture + écriture** | C'est ton outil principal |
| **Ventes** | Lecture | Suivre l'activité de l'équipe |
| RH | Lecture | Voir l'effectif (pas modifier) |
| **Administration** | **Lecture + écriture (vendeurs uniquement)** | Gérer ton équipe |
| Mon espace + Mes paies | Lecture | Tes infos perso |

> Tu **n'as pas accès** à : Dashboard, Stations essence, Comptabilité, **Configuration globale** dans Administration.
>
> **Périmètre Administration** : tu peux gérer **uniquement les vendeurs** (Novice, Intermédiaire, Expérimenté). Tous les autres comptes apparaissent grisés (lecture seule).

---

## Administration — Gestion de tes vendeurs

### Ce que tu peux faire
- **Créer un compte vendeur** (Novice / Inter / Exp)
  - Renseigne **ID Discord** + **ID Perso** systématiquement (sinon les ventes/paies ne lui seront pas attribuées)
- **Modifier** un vendeur (prénom, NOM, IDs Discord/Perso, date d'entrée)
- **Changer son grade** (promouvoir Novice → Inter → Exp) via le sélecteur de rôle
- **Suspendre** un vendeur (= licenciement) — confirmation 3 secondes
- **Supprimer définitivement** — confirmation 3 secondes + tape `SUPPRIMER` pour activer le bouton

### À ne pas faire
- Ne supprime pas un vendeur sans avoir noté ses derniers chiffres
- Ne donne **jamais** un mot de passe par téléphone vocal — toujours via DM Discord ou autre canal écrit traçable
- Ne tente pas de promouvoir un vendeur en Responsable ou DRH — c'est hors de ton périmètre (le sélecteur ne le proposera pas)

### Promotion d'un vendeur
1. Dans Admin, ligne du vendeur → sélecteur **Rôle** → choisis le nouveau grade (Novice / Inter / Exp)
2. Le changement est immédiat
3. Le **plafond salaire** s'ajuste automatiquement : 13k → 14k → 15k

---

## Stocks épicerie — Ton outil principal

### Ce que tu vois

#### Filtres en haut
- **Catégorie** : Outillage / Document / Agriculture / Mécanique / Nourriture / Divers
- **Niveau d'alerte** : Rupture / Bas / OK
- **Recherche libre** : tape un nom de produit

#### Tableau produits
Chaque ligne :
- Nom + catégorie
- **Stock** (quantité disponible) — mise à jour en temps réel à chaque vente
- Prix achat (saisi à la main)
- Prix vente (in-game)
- Marge (= vente − achat)
- Seuil d'alerte (à partir duquel le produit passe en « BAS »)
- Badge statut : RUPTURE (stock = 0), BAS (≤ seuil), OK

#### Mouvements récents
20 derniers ajustements de stock : ajout (vert) ou retrait (rouge), produit, quantité, source (utilisateur ou bot Discord), raison.

### Ce que tu peux faire

#### Modifier un produit
Bouton **« Modifier »** sur chaque ligne. Modale avec :

| Champ | Quoi mettre |
|-------|-------------|
| **Nom** | Le nom commercial (visible partout) |
| **Prix achat** | Combien ton fournisseur te le vend (sert au calcul de marge et bénéfice net en compta) |
| **Prix vente** | Le prix que tu factures au client (in-game) |
| **Seuil d'alerte** | À quel stock le produit passe en « BAS » (déclenche une alerte) |
| **Catégorie** | Pour les filtres |
| **Delta** | Ajustement manuel de stock (+X ou −X) — **raison obligatoire** |
| **Raison** | Justification de l'ajustement (ex. « inventaire physique constaté », « casse ») |

**À retenir** :
- Tout changement de prix est **automatiquement loggé** (qui, quand, ancien → nouveau)
- Un ajustement sans raison **ne passe pas** (validation bloquée)
- Le stock se met à jour en temps réel sur tous les écrans (ordi, tablette, téléphone)

#### Ajouter un nouveau produit au catalogue
> **Réservé à la direction et au DRH.** En tant que Responsable Vente, tu **ne vois pas** ce bouton. Si tu as besoin d'un nouveau produit (nouveau stock à référencer), demande à la direction ou au DRH de le créer.

#### Réinitialiser depuis catalogue (à manier avec précaution)
Bouton **« Réinitialiser depuis catalogue »** — modal CRITIQUE 3 sec.
- **Écrase** : noms, catégories, prix de vente, seuils
- **Préserve** : prix d'achat existants
- **Conserve** : produits hors catalogue (rien n'est supprimé)

> N'utilise **que** si tu veux remettre la liste des produits aux valeurs par défaut (par exemple après une mauvaise saisie en série).

### Bonnes pratiques

#### À faire
- **Vérifie les seuils d'alerte** chaque semaine. Un produit qui se vend bien doit avoir un seuil élevé pour anticiper la rupture.
- **Mets à jour les prix d'achat** dès qu'un fournisseur change ses tarifs. Sinon, le bénéfice net affiché en compta est faux.
- **Investigue les écarts** dans Mouvements récents (ex. un retrait sans raison expliquée).

#### À ne pas faire
- **Ne change jamais le prix de vente sans prévenir tes vendeurs** — ils risquent de facturer à l'ancien prix.
- Ne mets pas un prix d'achat à 0 « pour faire simple » — la marge devient artificiellement énorme et fausse le bénéfice net en compta.
- N'utilise pas l'ajustement manuel pour « rattraper » un bug Discord — préviens d'abord la direction (peut-être que le bot est en panne).
- Ne réinitialise pas le catalogue par habitude — c'est une opération massive qui efface ton travail de tarification.

---

## Ventes — Suivre ton équipe

### Ce que tu vois
- **KPI** : CA semaine, bénéfice brut, panier moyen, paiements (espèces vs carte)
- **Filtres** : par vendeur, par paiement, recherche libre
- **Tableau factures** : date, n°, vendeur, client, montant, bénéfice, paiement, raison, vérification stock
- **Discordances** : factures sans sortie de stock corrélée

### Ce que tu peux faire
- **Filtrer** par vendeur pour voir l'activité individuelle
- **Exporter CSV** : télécharge toutes les ventes de la semaine

### Ce que tu vérifies en priorité
1. **Les discordances** : si un vendeur fait une facture mais le stock ne baisse pas → soit bug bot, soit fraude. Préviens la direction.
2. **Le panier moyen** : s'il chute brutalement, c'est qu'un vendeur brade les prix. À investiguer.
3. **Le bénéfice par vendeur** : un vendeur peut faire beaucoup de CA en vendant à perte. Le bénéfice est le vrai indicateur.

---

## RH — Vue lecture seule

Tu peux **voir** :
- Les effectifs vendeurs / pompistes (utile pour planning)
- Leurs heures de service de la semaine
- Leur CA généré (pour comparer)

Tu ne peux **pas** modifier les rôles, salaires ou statuts. C'est la direction et le DRH qui s'en chargent.

> Si un de tes vendeurs n'est pas performant, **note les chiffres** et fais un retour à la direction. Ne tente pas de le suspendre toi-même (tu n'as pas accès).

---

## Ta semaine type

### Lundi matin
- **Stocks** : check rapide des ruptures et bas (filtre « niveau d'alerte »)
- Réapprovisionne mentalement (commande à passer aux fournisseurs RP)
- **Ventes** : voir comment la semaine précédente s'est terminée

### En cours de semaine
- **Une fois par jour**, vérifie **Stocks** (ruptures, alertes)
- Une fois tous les 2 jours, regarde **Ventes** (discordances, top vendeur)

### Vendredi
- Vérifie les **prix d'achat** (si fournisseur a changé ses tarifs)
- Mets à jour les seuils d'alerte si nécessaire (un produit qui s'est vendu beaucoup doit avoir un seuil plus haut)

### Dimanche
- Rien de spécial — clôture automatique

---

## Comprendre ta paie

Tu es payé en **salaire fixe**, décidé par la direction ou le DRH (modal « Décider salaire » dans RH).

- **Plafond TTE** : 17 000 $/semaine
- **Pas de commission** automatique — c'est ton taf de pilotage qui justifie ton salaire
- **Pas de quota** — tu n'as pas à atteindre un seuil de CA personnel

Va voir **Mes paies** pour ton historique de versements.

---

## Les 3 erreurs à éviter

1. **Modifier un prix de vente sans annoncer** à l'équipe — vendeurs en décalage, clients mécontents.
2. **Laisser un produit en rupture > 24h** sans alerter la direction — perte de CA directe.
3. **Confondre marge et CA** — un gros CA avec faible marge ne fait pas vivre l'épicerie.

---

## La suite

- **[07-automatismes.md](07-automatismes.md)** : comprendre comment les ventes et les sorties de stock arrivent depuis Discord
- **[08-faq-depannage.md](08-faq-depannage.md)** : « pourquoi le stock n'a pas baissé après cette vente ? »
