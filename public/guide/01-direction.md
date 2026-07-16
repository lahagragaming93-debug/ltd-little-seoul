# Guide Direction — Patron / Co-Patron

> Tu es le pivot de la plateforme. Tu vois TOUT, tu peux modifier TOUT. Avec ce pouvoir vient la responsabilité de ne pas tout casser.

Ce guide couvre **les 9 modules** auxquels tu as accès, dans l'ordre où tu les utiliseras le plus souvent.

---

## 1. Dashboard (Tableau de bord)

> **Ta page d'accueil**. Par défaut, vue de la semaine en cours — mais tu peux changer la période via le **filtre en haut**.

### Filtre période (haut de page)

Sélecteur avec 5 options : **Cette semaine** (par défaut) · **Ce mois** · **30 derniers jours** · **Depuis ouverture** · **Personnalisé** (2 dates au choix, granularité 1 jour).

Au changement → les KPI, le graphique ventes et le Top 5 produits se recalculent sur la nouvelle période. **Le solde banque, les alertes, les stations et les stocks bas restent toujours en temps réel** (état instantané, indépendant du filtre).

> Ce même filtre est aussi disponible sur **Banque LTD**, **Revenus carburant** et **Mes paies**.

### Ce que tu vois

| Section | Contenu |
|---------|---------|
| **KPI** (selon période) | CA, bénéfice brut, bénéfice net, masse salariale (% + statut TTE) |
| **Solde banque LTD** | Toujours live, peu importe la période |
| **Graphique ventes par jour** | Bar chart sur la période sélectionnée |
| **Top 5 produits** | Les 5 plus gros CA de la période |
| **Historique 6 dernières semaines** | Tableau avec CA, dépenses, bénéfice net, statut (toujours hebdo, indépendant du filtre) |
| **Alertes actives** | 8 dernières alertes (stock, station, vente sans stock, masse) — temps réel |
| **Stations mini-bloc** | Niveau de chaque station (barre de progression) — temps réel |
| **Stocks bas** | 8 produits en rupture ou sous seuil — temps réel |

### Ce que tu peux faire
- **Lecture seule.** Aucune action sur cette page. C'est juste un dashboard.

### À comprendre
- **Bénéfice brut** = CA − coût d'achat des produits vendus
- **Bénéfice net** = CA − dépenses − salaires versés (le vrai)
- **Masse salariale** = total salaires / CA × 100 — si > 90 %, **tu es hors TTE**, alerte rouge.

### Ne pas faire
- Ne pas paniquer si la masse salariale dépasse 85 % en début de semaine (les paies ne sont pas encore versées). Le calcul s'ajuste au fil de la semaine.
- Si tu vois une alerte « vente sans stock », **ne l'ignore pas** : ça veut dire qu'un vendeur a fait une facture sans avoir sorti la marchandise du stock — il y a un bug Discord, ou pire, un vol.

---

## 2. Stocks épicerie

> Catalogue des **100+ produits** rangés en **5 onglets** : Vente épicerie, Vente partenaire, Achat fournisseur, Quincaillerie, Mouvements.

### Les 5 onglets

| Onglet | Contenu | Commission vendeur ? |
|--------|---------|----------------------|
| **Vente épicerie** | Produits vendus aux particuliers (bonbons, tickets, ballons, outils légers…) | Oui (CA × commission) |
| **Vente partenaire** | Produits vendus aux pros / autres entreprises (eau purifiée, whey, huile…) | Non (CA LTD seulement) |
| **Achat fournisseur** | Matières premières achetées (acier, cuivre, corde, caoutchouc, charbon…) — **non revendues** | — (jamais vendues) |
| **Quincaillerie** | Produits craftés par les vendeurs (Visseries, Mastic carrosserie, Lumière violette…) | Oui (commission) |
| **Mouvements** | Historique 20 derniers mouvements de stock |

> Un produit peut apparaître **dans 2 onglets en même temps** s'il a un fournisseur défini : par exemple, Pince Coupante = Vente épicerie + Achat fournisseur (acheté chez Yootool).

### Ce que tu peux faire

#### Modifier un produit
- Édite : **Nom**, **Prix achat**, **Prix vente** (décimaux supportés : 1,25 $), **Seuil d'alerte**, **Section** (épicerie / pro / achat fournisseur / Quincaillerie), **Fournisseur**
- Optionnel : **Ajustement de stock** (delta) avec **raison obligatoire**
- Enregistre

> Chaque changement de prix est **loggé** dans `historiquePrix` (audit trail).

#### Créer un nouveau produit
- Bouton « + » en haut à droite
- Pré-rempli avec la section sur laquelle tu te trouves
- Tu peux faire passer un produit d'une section à l'autre à tout moment (ex. Spray à tag de "pro" à "épicerie" → les vendeurs touchent commission dessus)

### À comprendre
- Le **stock évolue automatiquement** quand un vendeur déclare une vente (transaction atomique : crée la vente + décrémente le stock).
- Le **prix d'achat** n'est jamais dans les logs FiveM — saisie manuelle. Sert à la marge LTD et au bénéfice net en compta. **N'impacte pas la commission vendeur** (qui est sur le CA, pas le bénéfice).
- Les **matières premières** (intrant=true) sont **invisibles dans le modal de vente** — impossible de les vendre par erreur.

### Ne pas faire
- Ne change pas un prix de vente sans prévenir tes vendeurs.
- Ne mets jamais un prix d'achat à 0 sauf volontaire (fausse le bénéfice net en compta).
- Pour les ajustements manuels de stock, **raison obligatoire** (audit immuable).

---

## 3. Stations essence

> Vue des **8 stations** de la franchise avec niveaux en temps réel.

### Ce que tu vois
- **KPI** : nb de stations, stock total (litres + %), stations en alerte, quota bidons/sem.
- **Grille des stations** : nom, badge OK/ALERTE, barre de progression (stock actuel/max), prix au litre, seuil.
- **Redistributions de la semaine** : qui a redistribué, quand, où, combien de litres, montant.

### Ce que tu peux faire

#### Ajouter une station
- Bouton **« + Ajouter une station »**
- Champs : **Nom** (obligatoire), stock actuel, stock max (défaut 30 000 L), seuil alerte, prix au litre

#### Modifier / redistribuer
- Bouton **« Modifier / redistribuer »** sur une station
- Modifie : nom, stock, capacité, seuil, prix
- Bouton **Supprimer** disponible (action CRITIQUE 3 sec + tape `SUPPRIMER`)

#### Configuration globale essence
- Bouton **« Configuration »**
- **Quota bidons/semaine** (défaut 1 700) — utilisé pour calcul paie pompiste
- **Quota caoutchoucs/semaine** (défaut 800)
- **Prix essence par défaut** (pour création de nouvelles stations)
- **Seuil d'alerte essence** (en litres)

### À comprendre
- Le **stock essence évolue automatiquement** quand un pompiste redistribue (logs Discord `#suivi-achat-essence`).
- Une station passe en **ALERTE** quand stock actuel < seuil → alerte créée + notification webhook Discord si configuré.
- Les **stations** de l'entreprise sont paramétrées avec le cabinet au moment du branchement (noms, capacités, prix au litre) et visibles dans la page Stations.

### Ne pas faire
- Ne change pas le **quota bidons** sans en parler à tes pompistes (impact direct sur leur salaire).
- Ne supprime jamais une station qui a de l'historique de redistribution sans bonne raison (les redistributions passées resteront orphelines).

---

## 4. Ventes

> Liste de **toutes les factures** de la semaine en cours avec discordances. **2 sources** : ventes bot Discord (bot) et déclarations manuelles vendeurs (manuel).

### Ce que tu vois
- **KPI** : CA semaine, bénéfice brut, panier moyen, paiements (espèces vs carte).
- **Filtres** : par vendeur, par paiement, recherche libre.
- **Tableau factures** : date, n°, vendeur, client, montant, bénéfice, paiement, raison, source (bot / manuel).
- Les **ventes cachées** (doublons bot remplacés par une manuelle) sont automatiquement filtrées.
- **Discordances** : si une vente a été faite sans sortie de stock corrélée.

### Anti-fraude : déclaration manuelle liée à la facture bot
Depuis 2026-05-13, un vendeur **ne peut plus déclarer une vente from scratch**. Il doit :
1. Faire la facture in-game (le bot la remonte)
2. Sur son espace, voir la vente "non déclarée" et cliquer "Déclarer"
3. Saisir les produits → le **montant total doit matcher exactement** celui de la facture in-game
4. Validation : la vente bot est remplacée par la manuelle (avec bon bénéfice + flag particulier/pro)

> Toi (direction) peux toujours déclarer une vente sans référence (pour régularisation).

### Ce que tu peux faire
- **Modifier une vente** (icône crayon sur ligne) — change produits/montant/client/paiement. Motif obligatoire.
- **Exporter CSV** — pour audit ou archivage.

### Consulter l'historique des semaines
Depuis 2026-05-18, un **sélecteur de semaine** est disponible en tête de toolbar :
- Par défaut : « Semaine en cours » (comportement historique inchangé).
- Tu peux remonter jusqu'à 20 semaines clôturées (selon ce qui existe en base) — chaque option affiche les dates + le statut (`Clôturée`, `Clôturée (manuelle)`, etc.).
- À chaque changement : KPI + tableau + discordances rechargent sur la fenêtre choisie. Le titre du panel devient `Factures de la semaine du DD/MM au DD/MM`.
- **Lecture seule** sur les semaines passées : l'icône crayon est remplacée par un cadenas (tooltip « Semaine clôturée — non modifiable »). L'export CSV reste utilisable.
- Le choix est mémorisé dans la session (sessionStorage) — pas perdu au refresh.

### À comprendre
- Le **vendeur est résolu** depuis son ID Discord (champ `idDiscord` dans son compte).
- Si un vendeur n'apparaît pas → ID Discord manquant. Va dans Admin → Modifier.

### Ne pas faire
- N'ignore JAMAIS une discordance (vente sans stock).
- Ne te base pas sur le CA seul — regarde aussi le **bénéfice** (un vendeur qui brade fait du CA mais peu de profit).

---

## 5. Comptabilité

> **Conformité TTE Chap. IV — Secteur 2.** C'est ta photo financière hebdomadaire officielle.

### Ce que tu vois
- **4 KPIs colorés** en haut : CA (vert), Charges déductibles (rouge), Masse salariale (orange + statut TTE), Bénéfice net (bleu si positif, rouge si perte).
- **Sélecteur semaine** : « Semaine en cours » + 6 dernières semaines archivées.
- **Dépenses rapides** : 5 boutons templates (Matières premières / Avocat / Entretien véhicule / Loyer / Autre) qui pré-remplissent le formulaire en 1 clic.
- **Conformité TTE — gauge masse salariale** : barre de progression visuelle avec marqueur 90 %. Vert / orange / rouge clignotant selon le ratio.
- **Recettes / Dépenses** : 2 colonnes côte à côte avec totaux.
- **Salaires & paies de la semaine** : tableau récap par groupe (Direction / Responsables / Vendeurs / Pompistes) avec **salaire estimé / versé / reste à verser** par employé.
- **Bouton « Copier récap Discord »** : prépare un message formaté à coller dans `#paie` avec les montants à verser à la direction et aux responsables.
- **Charges détaillées** : tableau date, raison, type, montant, qui a saisi.

### Ce que tu peux faire

#### Dépenses rapides (recommandé pour les dépenses récurrentes)
Au-dessus de la gauge, 5 boutons templates :
- Matières premières → pré-remplit raison « Achat matières premières » + type déductible
- Frais avocat → « Honoraires avocat » + déductible
- Entretien véhicule → « Entretien véhicule LTD » + déductible
- Loyer / Charges → « Loyer hebdomadaire » + autre déductible
- Autre → ouvre la modale vide

Tu n'as plus qu'à saisir le **montant** et valider.

#### Ajouter une dépense (manuel)
- Bouton **« + Ajouter une dépense »** (en haut à droite)
- Champs : **Raison** (obligatoire), **Montant** (obligatoire), **Type** :
  - `matieres-premieres` (déductible)
  - `frais-avocat` (déductible)
  - `entretien-vehicules` (déductible)
  - `autre-deductible`
  - `non-deductible` (sortie cash sans bénéfice fiscal)

> La plupart des dépenses arrivent **automatiquement** via le bot Discord (`#depenses`). N'utilise ce bouton que pour des dépenses non tracées dans Discord (ex. paiement en cash hors compte).

#### Verser les salaires (workflow recommandé)
1. Va en bas de page → section **« Salaires & paies de la semaine »**
2. Vérifie la colonne **« Reste à verser »** pour chaque membre Direction et Responsable
3. Clique **« Copier récap Discord »** en haut à droite de la section
4. Colle le message dans le canal `#paie` Discord
5. Verse les montants RP via la commande Discord ou in-game
6. Le bot Discord enregistre automatiquement les paies (apparaissent dans la colonne **« Versé cette semaine »**)

> Pour vendeurs et pompistes : les salaires sont **calculés automatiquement** selon CA / quotas. Va voir **Ressources humaines** pour le détail individuel.

#### Exporter CSV / Exporter PDF
- CSV : pour conserver une copie hors ligne ou la coller dans une feuille de calcul.
- PDF : ouvre la fenêtre d'impression du navigateur → choisis « Enregistrer en PDF ».

### À comprendre
- Le calcul de la **masse salariale** = total salaires (estimés + versés) / CA. Doit rester **≤ 90 %** pour être TTE-compliant.
- Les **primes** sont calculées automatiquement selon les tranches Art. 4-1.10 (hebdo, sur le CA) et Art. 4-1.11 (mensuel, sur le bénéfice net).
- Une **semaine archivée** (statut `cloturee`) est figée — tu peux la consulter mais plus la modifier.

### Ne pas faire
- Ne classe **jamais** une dépense en `matieres-premieres` si elle n'en est pas une. C'est de la fraude fiscale RP.
- Ne modifie pas une semaine archivée même si tu le peux techniquement (l'audit verra l'incohérence).
- Si la masse salariale dépasse 90 %, **réduis les salaires décidés** ou **augmente le CA** — ne triche pas en sous-déclarant.

---

## 6. Ressources humaines (RH)

> **Tu vois tous les employés**, leurs heures, leur CA généré, et tu décides leurs salaires.

Voir aussi : **[02-drh.md](02-drh.md)** pour le détail.

### Ce que tu vois
- **Sélecteur semaine** en haut : *Cette semaine (en cours)* ou *Semaine précédente (à payer)*.
  - Bascule sur **« Semaine précédente »** chaque **lundi matin** après la clôture auto de 00h00 pour voir les salaires à verser sur la semaine qui vient de se terminer.
  - Le badge à droite du sélecteur affiche les dates exactes de la semaine affichée + le marqueur **« À PAYER »** quand tu es sur la semaine précédente.
- **KPI** : effectif actif, salaires estimés (libellé adapté à la semaine choisie), salaires versés, masse salariale %.
- **Filtres** : par rôle, statut, recherche.
- **Tableau effectif** : nom, rôle, ID Discord, heures de service, CA/quota, salaire estimé/plafond, statut, bouton « Détail ».

### Ce que tu peux faire

#### Détail employé
- Clique sur **« Détail »** sur n'importe quelle ligne
- Modale : infos perso, heures, salaires, KPIs spécifiques au rôle
- Si l'employé est **Direction / Responsable / DRH** : champ **« Salaire décidé »** avec validation plafond
  - Patron / Co-Patron : plafond **20 000 $**/semaine
  - DRH : **18 000 $ fixe** (imposé, non modifiable)
  - Responsable : plafond **17 000 $**/semaine
- Bouton **« Décider salaire »** → met à jour le salaire fixe

> Pour les **vendeurs et pompistes**, le salaire est **calculé automatiquement** à partir du CA / quota — pas de salaire à décider, le système le fait.

### Ne pas faire
- Ne décide jamais un salaire **au-dessus du plafond** (le site bloque, mais ne tente pas de contourner).
- Ne marque pas un employé comme suspendu sans en parler avec lui d'abord (suspendre = licencier en pratique).
- Pour un employé avec **moins de 7h de service** dans la semaine, vérifie qu'il est bien actif (sinon paie quasi nulle est normale).

---

## 7. Administration

> **Création et gestion des comptes utilisateurs.** C'est là que tu fais entrer/sortir tes employés.

> **Hiérarchie de gestion** :
> - **Patron** (toi) : peut gérer **tous** les comptes
> - **Co-Patron** : tous sauf Patron
> - **DRH** : tous sauf Patron, Co-Patron (peut gérer un autre DRH)
> - **Responsable Vente** : uniquement vendeurs (Novice / Inter / Exp)
> - **Responsable Pompiste** : uniquement pompistes
>
> Les autres rôles ne voient pas Administration.
>
> **Configuration globale** (quotas, prix essence, webhook Discord) reste **exclusivement Patron / Co-Patron**, même si DRH/Responsables ont accès à Administration.

### Ce que tu vois
- **Tableau de tous les comptes** : nom, email, rôle, ID Discord, ID Perso, date entrée, statut, actions.

### Ce que tu peux faire

#### Créer un compte
- Bouton **« + Créer un compte »**
- Champs : Prénom, NOM (uppercase auto), Email, ID Discord, ID Perso (in-game), Rôle, Mot de passe provisoire (bouton « Générer » dispo)
- Pour rôle **Patron / Co-Patron** : modal CRITIQUE 3 sec qui rappelle que ce compte aura tous les droits
- Le site affiche les credentials à transmettre à l'employé (email + mdp)
- À l'arrivée de l'employé sur le site avec ces credentials, il sera **forcé à changer son mot de passe**

#### Modifier un compte
- Bouton **« Modifier »** par ligne
- Édite : prénom, NOM, ID Discord, ID Perso, date d'entrée
- L'**email n'est pas modifiable** ici (lecture seule, lié à Firebase Auth)

#### Changer le rôle
- Sélecteur de rôle directement dans le tableau
- Si le changement implique un rôle **Patron/Co-Patron** : confirmation CRITIQUE 3 sec

#### Suspendre un compte (= licencier)
- Bouton **« Suspendre »**
- Modal CRITIQUE 3 sec
- L'employé perd l'accès immédiatement à sa prochaine action (déconnexion forcée)
- Le compte reste visible et **réactivable** (bouton « Réactiver »)

#### Supprimer DÉFINITIVEMENT
- Bouton **« × »**
- Modal CRITIQUE 3 sec **+ tape le mot `SUPPRIMER`** pour activer
- Supprime le profil Firestore de l'employé
- **Le compte Firebase Auth (email/mdp) reste actif** ! Il faut aller le supprimer **manuellement** dans la console Firebase pour libérer l'email.
- Tu ne peux pas supprimer ton propre compte (le bouton est désactivé)

#### Configuration globale
- Bouton **« Configuration globale »**
- **Quota bidons/semaine** (défaut 1700)
- **Quota caoutchoucs/semaine** (défaut 800)
- **Prix essence par défaut** (utilisé pour créer de nouvelles stations)
- **Seuil d'alerte essence** (en litres)
- **URL Webhook Discord** : pour recevoir les alertes (rupture, masse > 90 %) sur un canal Discord

### Ne pas faire
- Ne crée **jamais** un compte sans renseigner **ID Discord ET ID Perso** — sinon ses ventes/paies/services ne lui seront pas attribués.
- Ne supprime pas un compte sans avoir d'abord récupéré ses derniers chiffres si besoin (toutes les ventes/paies passées restent dans la base, mais lui-même disparaît).
- Ne mets jamais un quota bidons à 0 (division par zéro = paie pompiste cassée).

---

## 8. Mon espace + Mes paies

Tu as aussi accès à **ces deux pages employé** comme tout le monde, pour voir tes propres heures et tes propres paies versées. Voir [05-vendeur.md](05-vendeur.md) ou [06-pompiste.md](06-pompiste.md) si tu veux le détail (mais en tant que direction, ces pages sont moins utiles pour toi — tout est dans le Dashboard et la Comptabilité).

---

## La semaine type d'un Patron

### Lundi matin
1. Ouvre le **Dashboard** : la semaine précédente est clôturée et archivée. Vérifie le bénéfice net.
2. Va dans **RH** → bascule le sélecteur sur **« Semaine précédente (à payer) »** : tu vois la liste des salaires estimés à verser à chaque employé pour la semaine qui vient de se terminer. Procède aux paiements depuis FiveM (`/paye` ou virement).
3. Va dans **Comptabilité** → semaine en cours = nouvelle semaine vierge. Le compteur démarre.
4. Si une alerte **masse salariale > 85 %** est apparue dimanche : c'est que la semaine s'est mal terminée → réfléchis à des ajustements (réduire un salaire décidé, augmenter les ventes).

### Tous les jours
- Coup d'œil rapide au **Dashboard** (10 secondes) :
  - CA en croissance ? (vs jour précédent dans la barre par jour)
  - Stations toutes au-dessus du seuil ?
  - Alertes ?

### Vendredi
- **RH** : vérifie que tous les employés ont fait au moins **7h de service**. Sinon, contacte-les.

### Dimanche soir (avant 23h59)
- **Comptabilité** → exporte le PDF de la semaine pour archive perso.
- Vérifie qu'aucune **discordance** dans Ventes n'a été oubliée.

### Lundi 00h00
- **Clôture automatique**. Tu n'as rien à faire — la Cloud Function `clotureHebdo` archive la semaine et démarre la suivante.

---

## Les 5 erreurs à NE JAMAIS commettre

1. **Supprimer un compte par accident.** Heureusement, le modal CRITIQUE + le mot `SUPPRIMER` à taper rendent l'erreur très improbable. Mais sois vigilant.
2. **Mettre la masse salariale > 90 %** délibérément. C'est une violation TTE qui peut entraîner des sanctions RP.
3. **Modifier des prix sans prévenir.** Tes vendeurs continueront avec l'ancien prix, créant des incohérences.
4. **Ignorer une alerte « vente sans stock »**. C'est soit un bug bot (à corriger), soit une vente frauduleuse (à investiguer).
5. **Diffuser ton mot de passe**. Si quelqu'un d'autre a accès à ton compte Patron, il a accès à TOUT (suppression de comptes, modification de prix, etc.). Change-le immédiatement si tu doutes.

---

## La suite

Tu as fait le tour. Lis maintenant :
- **[02-drh.md](02-drh.md)** : zoom sur la RH et la paie (utile aussi pour toi)
- **[07-automatismes.md](07-automatismes.md)** : comprendre comment le bot Discord et la clôture marchent
- **[08-faq-depannage.md](08-faq-depannage.md)** : les 20 questions courantes des employés
