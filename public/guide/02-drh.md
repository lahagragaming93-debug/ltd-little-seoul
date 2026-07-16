# Guide DRH — Ressources Humaines

> Tu es le **garant des employés** : leurs heures, leurs paies, la conformité aux plafonds TTE.
> Tu **gères aussi les comptes** (création, modification, suspension, suppression) — sauf le Patron et le Co-Patron, qui restent hors de ton périmètre.
> Tu peux décider les salaires des responsables et de la direction.

---

## Tes modules

| Module | Accès | Rôle |
|--------|-------|------|
| Dashboard | Lecture | Vue d'ensemble (CA, masse, alertes) |
| Stocks épicerie | **Lecture + écriture** | Voir, modifier les stocks, **et créer de nouveaux produits** au catalogue |
| Stations essence | **Lecture + écriture** | Modifier capacité / prix / stock / N° pompe, ajouter ou supprimer une station |
| Ventes | Lecture | Voir les factures de la semaine |
| Comptabilité | Lecture | Voir les comptes (pas modifier) |
| **Ressources humaines** | **Lecture + écriture** | Gérer effectif et salaires décidés |
| **Administration** | **Lecture + écriture (sauf direction)** | Créer / modifier / suspendre / supprimer des comptes |
| Mon espace + Mes paies | Lecture | Tes infos perso |

> Tu n'as pas accès à : **Configuration globale** dans Administration (réservée à la direction).
>
> **Périmètre Administration** : tu peux gérer **tous les comptes sauf le Patron et le Co-Patron** (les comptes hors périmètre apparaissent en lecture seule, actions grisées). Tu peux gérer un autre DRH.
>
> **2026-05-13** : tu peux désormais modifier les stocks épicerie et essence (alignement avec la direction sur décision du patron).

---

## Le module RH en détail

### Ce que tu vois

#### Sélecteur semaine (en haut)
Toggle binaire pour choisir la semaine affichée :
- **Cette semaine (en cours)** — par défaut, montre la semaine RP en cours (lundi 00h00 → maintenant).
- **Semaine précédente (à payer)** — bascule à utiliser **le lundi matin** après la clôture auto de 00h00, pour voir les salaires estimés à verser sur la semaine clôturée.

Le badge à droite affiche les dates exactes de la semaine affichée. Le marqueur **« À PAYER »** est visible quand tu es sur la semaine précédente.

> La page recharge automatiquement (ventes, services, quotas, paies, redistributions carburant) sur la fenêtre choisie. Pas besoin de F5.

#### KPI en haut
| KPI | Signification |
|-----|---------------|
| **Effectif actif** | Nombre d'employés au statut « actif » |
| **Salaires estimés** | Somme des salaires calculés pour la semaine affichée. En mode **semaine précédente**, lit le **snapshot figé à la clôture** (delta « figé à la clôture »). En mode courant, recalcul live |
| **Salaires versés** | Somme des paies déjà versées via Discord (`#paie`) sur la semaine affichée |
| **Masse salariale %** | Total salaires / CA semaine — limite TTE = 90 % |
| **Reste à verser** *(mode semaine précédente uniquement)* | Somme des estimations des employés **non encore cochés « Versé »**. Indicateur de pilotage du lundi matin : passe à 0 $ quand tu as tout payé |

#### Filtres
- **Rôle** : pour ne voir qu'une catégorie (ex. « tous les vendeurs »)
- **Statut** : actif / suspendu
- **Recherche** : nom, prénom, ID Discord, ID Perso

#### Tableau effectif
Une ligne par employé avec :
- **Nom + rôle** (badge coloré)
- **ID Discord** (utile pour matcher avec les logs)
- **Heures de service** de la semaine — si < 7h, marqueur d'alerte
- **CA / Quota** (varie selon le rôle) :
  - Vendeur : `CA généré / 50 000` (plafond CA) + score quota fabrication si actif
  - Pompiste : `% score` (moyenne bidons + caoutchoucs)
  - Responsable / Direction / DRH : « Décidé »
- **Salaire estimé / plafond**
- **Statut** + bouton **« Détail »**

#### Colonne « Versé ? » (mode semaine précédente uniquement)

**Workflow lundi matin** (depuis 2026-05-18, Option B « snapshots ») :

1. À la **clôture** (manuelle bouton cadenas ou cron lundi 00h00 Paris), le système prend une photo des estimations de chaque employé actif → collection `/paiesEstimees/{weekKey}_{userId}`. Ces chiffres sont **figés** : ils ne bougent plus, même si tu modifies une vente ou un salaire décidé après coup.
2. Tu bascules le toggle sur **« Semaine précédente (à payer) »**.
3. Le tableau affiche les estimations **figées à la clôture** (pas un recalcul live).
4. Une colonne **« Versé ? »** apparaît :
   - **Checkbox vide** : pas encore versé.
   - **Suggestion ≈ XXXX $** : le système a trouvé une paie `/paies` du bénéficiaire dans la fenêtre lundi 00h → mardi 21h dont le montant est à ±5 % de l'estimation. Quand tu coches, le snapshot est **lié à cette paie** (audit).
   - **Écart +1500 $** (orange) ou **+5000 $** (rouge) : la paie réelle s'écarte de l'estimation. Décide si c'est une erreur ou une régularisation volontaire.
   - **Badge « payé »** : déjà coché. Tu peux décocher pour annuler.
5. Tu coches employé par employé au fur et à mesure que tu verses les `/pay` Discord.
6. Le KPI **« Reste à verser »** baisse à chaque coche.
7. Une fois à **0 $**, tu as fini la semaine.

> **Idempotent** : si tu re-clôtures la même semaine (cas rare), aucun snapshot existant n'est écrasé — la trace est conservée.
> **Reset** : décoche pour annuler le marquage (les champs `datePaiement` et `paieMatcheeId` sont remis à null).
> **Droits** : Patron, Co-Patron, DRH, Admin Technique peuvent cocher.

### Ce que tu peux faire

#### Voir le détail d'un employé
- Clique **« Détail »** sur n'importe quelle ligne → modale avec :
  - Infos perso : ID Discord, ID Perso, date d'entrée
  - Heures service de la semaine + sessions individuelles
  - Salaires versés cette semaine (depuis `/paies`)
  - Salaire estimé pour la semaine + plafond TTE applicable

  **Pour un vendeur** :
  - CA total généré, **CA particulier** (commissionnable) et CA pro (non commissionné), bénéfice
  - **Tableau de TOUTES les factures** (manuelles + bot + cachées) avec colonnes : date, source, n°, client, montant, bénéfice, commissionnable, statut → permet de comparer "ce que le bot a vu" vs "ce que le vendeur a déclaré"

  **Pour un pompiste** : bidons / quota, caoutchoucs / quota, score %
  **Pour responsable / direction / DRH** : champ **« Salaire décidé »** + bouton **« Décider salaire »**

#### Voir l'espace personnel d'un employé (mode débug)
- Bouton **« Voir son espace »** en bas de la modale détail
- Te redirige sur **employee.html** mais affiche **les données de cet employé** (CA, factures, alertes, etc.) — exactement ce qu'il voit lui-même
- Bandeau bleu en haut : "Mode débug — lecture seule"
- Utile quand un employé dit "j'ai un problème" → tu vois exactement ce qu'il voit et tu identifies le bug
- Tous les boutons d'action sont désactivés (impossible de déclarer une vente à sa place)

#### Décider un salaire (responsables, direction, DRH inclus)
- Saisis le montant dans le champ
- Le système refuse si > plafond du rôle
- Plafonds :
  - Patron / Co-Patron : **20 000 $/sem**
  - DRH : **18 000 $/sem FIXE** (non modifiable, imposé patron)
  - Responsable Vente : **calculé auto** depuis CA personnel (pas de saisie)
  - Responsable Pompiste : **17 000 $/sem max** (à toi de décider)
- Clique **« Décider salaire »** → enregistré immédiatement

> Ton salaire DRH est **fixe à 18 000 $**, tu n'as pas à le décider.

### Ce que tu peux AUSSI faire (stocks épicerie + essence)
- **Ajouter un nouveau produit** au catalogue (Stocks épicerie → « + Ajouter un produit »)
- **Modifier** les fiches produits existantes (nom, prix achat/vente, seuil)
- **Ajuster manuellement les stocks** épicerie (avec justification obligatoire — tracé dans les mouvements)
- **Gérer les stations essence** : ajouter / supprimer une station, modifier sa capacité, son prix, son stock actuel, son N° de pompe
- Les Responsables Vente peuvent modifier les fiches mais **pas créer** de nouveaux produits — c'est ton rôle (et celui de la direction)

### Ce que tu ne peux PAS faire

- Ajouter une dépense (Comptabilité lecture seule)
- Modifier la **Configuration globale** dans Administration (quotas, prix essence, webhook — réservée à la direction)
- Gérer les comptes **Patron** et **Co-Patron** (hors périmètre — apparaissent grisés dans Administration)

> Si tu as besoin d'une de ces actions → demande au Patron ou Co-Patron.

---

## Le module Administration (gestion des comptes)

Tu y accèdes via la sidebar — **« Administration »**.

### Ton périmètre
- Tu peux **créer / modifier / suspendre / supprimer** : DRH, Responsables, Vendeurs, Pompistes
- Tu ne peux **pas** toucher à : Patron, Co-Patron (lignes grisées)
- Tu peux changer le rôle d'un employé (ex. promouvoir un Vendeur Novice → Intermédiaire)

### Créer un compte
Bouton **« + Créer un compte »**. Remplis :
- Prénom, NOM, Email
- ID Discord, ID Perso (in-game) — **les deux sont indispensables** pour que ses ventes/paies/heures soient bien attribuées
- Rôle (limité à ton périmètre)
- Mot de passe provisoire (bouton « Générer » dispo)

À la création, le site affiche les credentials (email + mot de passe) → transmets-les à l'employé. Au premier accès, il sera forcé à changer son mot de passe.

### Suspendre / Supprimer
- **Suspendre** = licenciement RP. L'employé perd l'accès immédiatement, le compte reste consultable et réactivable. Confirmation 3 secondes.
- **Supprimer définitivement** : confirmation 3 secondes + **tape `SUPPRIMER`** pour activer le bouton. Supprime le profil Firestore. Le compte Firebase Auth (login/email) doit être supprimé séparément depuis la console Firebase pour libérer l'email — demande à la direction.

### À ne pas faire
- Ne supprime pas un compte sans avoir noté ses derniers chiffres (les ventes/paies passées restent en base mais lui-même disparaît)
- Ne donne **jamais** un mot de passe par téléphone vocal — toujours via DM Discord ou autre canal écrit traçable

---

## Comprendre les calculs de paie

### Vendeur (modèle 2026-05-25 : CA prorata 50k + bonus quota fabrication 5k)
```
plafond CA    = 8 000 / 9 000 / 10 000 $ (Novice / Inter / Exp)
bonus max     = 5 000 $ (quota fabrication, atteint si score 100 %)
plafond total = 13 000 / 14 000 / 15 000 $ (Novice / Inter / Exp)

Part CA   = (CA commissionnable / 50 000) × plafond CA, plafonné à plafond CA
Bonus fab = score_quota_fabrication × 5 000 $
            (score = moyenne des ratios fait/quota sur produits actifs,
             chaque ratio plafonné à 100 %)

Salaire   = MIN( Part CA + Bonus fab, plafond total )
```

> **Distinction particulier / professionnel**
>
> Chaque produit du catalogue a un flag `pourPro` :
> - **Particulier** (pourPro=false) : vendu par les vendeurs aux clients → entre dans le CA commissionnable
> - **Professionnel** (pourPro=true) : vendu par la direction (Patron, Co-Patron, DRH, Resp Vente) à d'autres entreprises → entre dans le CA LTD pour la compta mais **pas dans la commission vendeur**
>
> Tu peux basculer un produit entre les 2 régimes à tout moment depuis **Stocks → Modifier produit → checkbox "Vendu aux professionnels uniquement"**.

> **Quota fabrication** : les 3 produits éligibles sont définis dans `permissions.js` → `PRODUITS_QUOTA_FAB` (eau purifiée, mastic carrosserie, visseries). Le patron règle les quantités hebdo sur la page RH → bloc "Quotas hebdomadaires". Un quota = 0 désactive le produit pour la semaine.

**Exemple concret** (Vendeur Intermédiaire — quota 200 eaux + 100 visseries actif) :
- CA commissionnable : 25 000 $ → Part CA = (25000/50000) × 9000 = **4 500 $**
- Fabrications : 100 eaux + 100 visseries → score = (0,5 + 1) / 2 = 75 % → Bonus = **3 750 $**
- Salaire = MIN(4 500 + 3 750, 14 000) = **8 250 $**

**Exemple plafonné** (Vendeur Expérimenté — quotas atteints) :
- CA : 50 000 $ → Part CA = **10 000 $** (plafond CA atteint)
- Score quota 100 % → Bonus = **5 000 $**
- Salaire = MIN(10 000 + 5 000, 15 000) = **15 000 $** (= plafond total)

> Sans quota fabrication actif (tous à 0), seule la part CA compte et le vendeur plafonne à 8/9/10k au lieu de 13/14/15k.

### Pompiste
```
score bidons     = bidons / quotaBidons (max 100 %)
score caoutchouc = caoutchoucs / quotaCaoutchoucs (max 100 %)
score moyen      = (score bidons + score caoutchouc) / 2

Salaire = score moyen × plafond
```

**Exemple** (Pompiste Inter, plafond 14 000) :
- Bidons : 1 700 / 1 700 = 100 %
- Caoutchoucs : 600 / 800 = 75 %
- Score moyen = (100 + 75) / 2 = **87,5 %**
- Salaire = 87,5 % × 14 000 = **12 250 $**

### Responsable Vente
- Salaire fixe **décidé** par le patron (ou toi) — régime identique au Responsable Pompiste depuis 2026-05-24
- Plafond : **17 000 $/semaine**
- Ses ventes/crafts personnels **ne sont pas** commissionnés — il pilote l'équipe vendeurs
- Saisie via la modale "Détail employé" comme pour les autres responsables

### Responsable Pompiste
- Salaire fixe **décidé** par le patron (ou toi)
- Plafond : **17 000 $/semaine**

### DRH (toi)
- **Salaire FIXE 18 000 $/semaine** — imposé par le patron, non modifiable.
- Pas besoin de faire de CA, c'est ta rémunération de garant des employés.

### Direction (Patron / Co-Patron)
- Salaire fixe décidé
- Plafond : **20 000 $/semaine**

---

## Conformité TTE — ce que tu surveilles

### Plafonds individuels (déjà bloqués par le site)
| Rôle | Plafond hebdo |
|------|---------------|
| Vendeur Novice | 13 000 $ |
| Vendeur Intermédiaire | 14 000 $ |
| Vendeur Expérimenté | 15 000 $ |
| Pompiste Novice | 13 000 $ |
| Pompiste Intermédiaire | 14 000 $ |
| Pompiste Expérimenté | 15 000 $ |
| Responsable Vente / Pompiste | 17 000 $ |
| DRH (fixe) | 18 000 $ |
| Patron / Co-Patron | 20 000 $ |
| Responsable Vente / Pompiste | 17 000 $ |

### Masse salariale globale
- **≤ 85 %** : OK (vert)
- **85 % – 90 %** : Attention (orange) — alerte affichée
- **> 90 %** : **HORS TTE** (rouge) — il faut agir

> Si la masse dépasse 90 %, options :
> - Réduire un ou plusieurs salaires décidés (responsables, direction)
> - Augmenter le CA (vendre plus)
> - Identifier un employé en sous-régime (peu d'heures, peu de CA) qui plombe le ratio

### Primes (calculées automatiquement)

**Prime hebdomadaire (Art. 4-1.10) — sur le CA semaine** :
| CA semaine | Prime |
|------------|-------|
| 0–200 000 | 0 $ |
| 200 000–400 000 | 5 000 $ |
| 400 000–600 000 | 10 000 $ |
| > 600 000 | 15 000 $ |

**Prime mensuelle (Art. 4-1.11) — sur le bénéfice net du mois** :
| Bénéfice net mois | Prime |
|-------------------|-------|
| 0–500 000 | 0 $ |
| 500 000–1 000 000 | 20 000 $ |
| 1 000 000–2 000 000 | 40 000 $ |
| > 2 000 000 | 60 000 $ |

> Tu n'as **rien à saisir** pour les primes. Le système les calcule à chaque clôture.

---

## Ta semaine type

### Lundi matin
- Vue rapide du dashboard
- Module **RH** : note les employés actifs / suspendus, vérifie les nouveaux

### Mardi → Jeudi
- Surveille les heures de service de chacun (filtre par rôle)
- Si quelqu'un n'a pas encore fait d'heures → message Discord pour rappel

### Vendredi
- Moment clé : **vérifie que la masse salariale prévue ≤ 90 %**
- Décide / ajuste les salaires des responsables et de la direction
- Si masse trop haute : revois les salaires fixes à la baisse

### Dimanche soir
- Dernière vérification : tous les chiffres sont-ils cohérents ?
- Aucune action manuelle nécessaire — la clôture est automatique à 00h00 lundi

---

## Les 3 erreurs DRH à éviter

1. **Décider un salaire par à-coups** sans vérifier la masse globale après. Toujours regarder le KPI « masse salariale % » dans le dashboard ou la compta.
2. **Oublier qu'un employé suspendu n'apparaît plus en effectif actif** mais peut encore avoir des paies versées dans la semaine (filtre statut « tous » pour vérifier).
3. **Modifier ton propre salaire au max** sans accord de la direction. Légalement tu peux, RP-ment c'est très mal vu.

---

## La suite

- **[07-automatismes.md](07-automatismes.md)** : pour comprendre comment les heures de service et les paies arrivent automatiquement depuis Discord
- **[08-faq-depannage.md](08-faq-depannage.md)** : « pourquoi cet employé n'a pas de salaire estimé ? », etc.
