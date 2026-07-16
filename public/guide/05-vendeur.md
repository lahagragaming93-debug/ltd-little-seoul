# Guide Vendeur

> Tu es **vendeur** au LTD (Novice, Intermédiaire ou Expérimenté). Le site te montre **ton CA, ton bénéfice, ta progression et ta paie**. Tu n'as rien à saisir manuellement — tout est automatique depuis les logs Discord.

---

## Tes 2 pages

| Page | Contenu |
|------|---------|
| **Mon espace** | Tes performances de la semaine (CA, bénéfice, progression, salaire estimé) |
| **Mes paies** | L'historique des paies que tu as reçues |

C'est tout ! En tant que vendeur, tu as un accès très restreint et c'est normal — tu te concentres sur ton boulot.

---

## Mon espace

### Ce que tu vois en haut
- Message de bienvenue avec ton prénom
- **Ton rôle** (Vendeur Novice / Inter / Exp)

### KPI vendeur

| KPI | Signification |
|-----|---------------|
| **Mon CA** | Total des montants des factures que tu as faites cette semaine |
| **CA commissionnable** | Sous-total des ventes "particulier" (base du salaire CA) |
| **Score quota fab** *(si quota actif)* | % moyen de tes fabrications hebdo (eau purifiée / mastic / visseries) |
| **Salaire estimé** | Part CA + bonus quota fabrication, plafonné selon ton grade |

### Tableau de tes ventes
30 dernières factures :
- Date / heure
- Client (nom RP)
- Montant facturé
- Bénéfice généré (en fonction du prix d'achat des produits vendus)

### Heures de service
Toutes tes prises et fins de service de la semaine, avec durée totale.
- Si total ≥ 7h : marqueur OK
- Si < 7h : à compléter (sinon ta paie sera ridicule)

### Ce que tu peux faire
- **Déclarer une vente** — bouton en haut de Mon espace (voir section dédiée ci-dessous)
- Tout le reste est en **lecture seule** (les chiffres viennent des logs Discord + tes déclarations)

### Consulter l'historique de tes semaines
Au-dessus du panel **« Détail de ta semaine »**, un **sélecteur de semaine** te permet de naviguer dans les semaines clôturées :
- Par défaut : « Semaine en cours ».
- Tu peux choisir une semaine passée pour voir ton **CA, ton CA commissionnable, ton salaire calculé** et la **liste détaillée de tes factures** de cette semaine-là.
- Les KPIs et progress bars du panel Détail se rechargent automatiquement, le badge `Clôturée` apparaît à côté du titre.
- Le tableau **« Mes factures de la semaine »** liste tes ventes avec date / #facture / client / paiement / montant / bénéfice.
- Les blocs **Heures de service** et **Avertissements** restent toujours sur la semaine en cours.
- Le choix est mémorisé dans la session — pas perdu au refresh.

---

## Déclarer une vente (workflow obligatoire)

Pour qu'une vente compte dans ta commission, **tu dois la déclarer toi-même** sur le site. Le bot Discord remonte automatiquement la facture in-game, mais sans détail des produits — c'est toi qui les renseignes pour figer le bénéfice.

### Étapes
1. **Fais la facture in-game** normalement
2. Dans les secondes qui suivent, le bot Discord la remonte → elle apparaît dans **Mon espace → "Vente in-game à déclarer"** (après 5 min, pour te laisser le temps de déclarer spontanément)
3. Clique **"Déclarer"** sur la ligne de la facture
4. La modal s'ouvre **avec la facture présélectionnée** + le **montant cible affiché**
5. Saisis les produits que tu as vendus (autocomplete par texte)
6. Le bouton **"Valider"** est désactivé tant que ton total ne matche pas exactement le montant in-game
7. Quand ça matche : Valider → ta vente est enregistrée et compte pour la commission

### Pourquoi c'est obligatoire
- **Anti-fraude** : impossible de déclarer une fausse vente (sans facture in-game associée)
- **Précision** : le bénéfice est calculé exactement à partir des produits que tu déclares (pas une estimation)

### Ce que tu vois dans la modal
- Les produits **"PRO"** (eau purifiée, huile, matières premières, etc.) sont **invisibles** — tu ne peux pas les vendre, c'est réservé direction
- Les **matières premières** (acier, cuivre, corde…) aussi invisibles — elles servent uniquement aux crafts, jamais à la vente
- Tu vois : produits **épicerie particuliers** + **Quincaillerie** (Visseries, Mastic carrosserie, Lumière violette…)

### Si la facture in-game n'apparaît pas après 30 secondes
- Vérifie dans Discord que le canal `#suivi-facture` a bien remonté ta vente
- Si oui mais pas sur le site : préviens la direction (bug bot ou ID Discord mal configuré)

### Si le client ne peut pas payer → tu supprimes la facture IG
Cas typique : tu factures un client, il n'a pas l'argent, tu supprimes la facture in-game depuis ton menu facturier.

**Tu n'as rien d'autre à faire sur le site.** Le bot Discord détecte automatiquement la suppression IG (canal `#logs-ig`, embed `xbankaccount - cancel`) et :
- Marque ta vente comme **annulée**
- Elle disparaît automatiquement de ton bloc "Vente in-game à déclarer"
- Elle apparaît avec un badge `Annulée` dans la vue RH (audit direction) avec le motif et la date

**Important** : si tu déclares d'abord la vente sur le site **puis** tu supprimes la facture IG, la direction reçoit une alerte automatique (cas suspect : tu aurais encaissé sans rendre l'argent au client). Si tu te trompes, préviens ton responsable tout de suite.

---

## Mes paies

### Ce que tu vois
- **Ce que tu as reçu cette semaine** + plafond TTE de ton grade
- **Ce que tu as reçu ce mois**
- **Total reçu** depuis ton entrée
- **Tableau** des paies : date, qui t'a payé, montant, période

### Si tu ne vois pas une paie qui aurait dû arriver
- Vérifie d'abord avec ton responsable / la direction (le bot Discord est-il actif ?)
- Vérifie que **ton ID Perso est bien renseigné** dans ton profil (sinon le bot ne sait pas que c'est toi qu'on paie)
- Si tout est OK : ouvre un ticket Discord à la direction

---

## Comprendre ta paie

Depuis le **25 mai 2026**, ton salaire a deux composantes : la **part CA** (jusqu'à 8/9/10k selon ton grade) + le **bonus quota fabrication** (jusqu'à 5 000 $). Le total est plafonné à 13/14/15k.

### Formule
```
Part CA   = (CA commissionnable / 50 000) × plafond_CA[grade]
            (plafonné à plafond_CA, atteint à 50 000 $ de CA)
Bonus fab = score_quota × 5 000 $
            (score_quota = moyenne des ratios fabriqué/quota sur les produits actifs)

Salaire   = MIN( Part CA + Bonus fab, plafond_total[grade] )

plafond_CA    = 8 000 $ (Novice) / 9 000 $ (Inter) / 10 000 $ (Exp)
plafond_total = 13 000 $ (Novice) / 14 000 $ (Inter) / 15 000 $ (Exp)
```

> **Important** : la part CA se calcule uniquement sur les ventes de produits **particulier** (bonbons, tickets à gratter, ballons, outils, etc.). Les produits **professionnels** (whey, huile, matières premières…) sont vendus uniquement par la direction aux autres entreprises.
>
> En revanche le **quota fabrication** est complètement indépendant des ventes : tu craftes les unités demandées et tu les déclares dans **Mon espace → "Déclarer une fabrication"**, peu importe ce que tu en fais ensuite.

### Le quota fabrication

- Chaque semaine, le patron définit un quota par produit parmi : **Eau purifiée / Mastic carrosserie / Visseries** (un produit avec quota = 0 est désactivé pour la semaine).
- Tu déclares tes fabrications via la section **Déclarer une fabrication** : saisis la quantité, clique **Valider**.
- Ton score = **moyenne des ratios** (`fait / quota`) sur les produits actifs, chacun plafonné à 100 %.
- Le bonus est versé **au prorata** du score (50 % du score = 2 500 $ de bonus, 100 % = 5 000 $).

### Exemples

#### Vendeur Inter (plafond CA 9 000, bonus max 5 000)

- CA commissionnable : **25 000 $** → Part CA = (25000/50000) × 9000 = **4 500 $**
- Quota fab : 200 eaux + 100 visseries. Tu fais 100 eaux + 100 visseries. Score = (0,5 + 1) / 2 = **75 %** → Bonus = **3 750 $**
- Salaire total : 4 500 + 3 750 = **8 250 $**

#### Vendeur Exp qui fait tout (plafond total 15 000)

- CA = 50 000 $ → Part CA = **10 000 $** (plafond CA atteint)
- Quota fab 100 % → Bonus = **5 000 $**
- Salaire total : 10 000 + 5 000 = **15 000 $** (= plafond)

#### Semaine sans quota fabrication (tous quotas à 0)

- Bonus = 0 $. Seule la part CA compte (max 8/9/10k selon ton grade).

| Grade  | Plafond CA (à 50k) | Bonus max | Plafond total |
|--------|--------------------|-----------|---------------|
| Novice | 8 000 $            | 5 000 $   | 13 000 $      |
| Inter  | 9 000 $            | 5 000 $   | 14 000 $      |
| Exp    | 10 000 $           | 5 000 $   | 15 000 $      |

---

## Comment maximiser ta paie

### 1. Maximise ton CA
- Vise les **50 000 $** de CA commissionnable pour atteindre ton plafond CA (8/9/10k selon grade)
- Au-delà de 50 000 $, la part CA est plafonnée — mais ça reste utile pour le LTD et les primes hebdo collectives
- Le bénéfice généré (CA − coût d'achat) sert au LTD pour la compta — pas à ta paie

### 1bis. Atteins ton quota de fabrication
- Si la semaine a un quota actif (eau / mastic / visseries), chaque produit fabriqué t'avance vers le bonus 5 000 $
- Le bonus est versé **au prorata** : 50 % du score = 2 500 $
- Déclare régulièrement tes craftings dans **Mon espace → Déclarer une fabrication**

### 2. Optimise tes heures de service
- Pas d'heures = pas de présence = pas de ventes attribuées (et la direction ne te paiera pas)
- Vise au moins **7h/semaine** pour que ton activité soit jugée régulière

### 3. Vérifie tes IDs
Va voir un Patron pour qu'il vérifie que ton compte a bien :
- **ID Discord** renseigné (pour que tes ventes te soient attribuées)
- **ID Perso** renseigné (pour que tes paies te soient attribuées)

Sans ces deux IDs, tu travailles dans le vide — rien ne sera attribué à ton nom.

### 4. Évite les discordances
Une « discordance » = une facture que tu fais sans qu'une sortie de stock soit détectée. Si ça arrive trop souvent, ton responsable et la direction vont enquêter (bug bot ou vol). Joue clean : facture toujours après avoir sorti la marchandise du stock.

---

## Ce que tu ne peux PAS voir / faire

- Le Dashboard global (CA total LTD)
- La liste des autres employés
- Les comptes / rôles d'autres personnes
- Modifier les prix
- Voir les ventes des autres vendeurs
- Décider ton propre salaire (c'est calculé, pas négocié)

C'est normal et c'est par sécurité — chacun ne voit que ses propres infos.

---

## Ta semaine type

### Tous les jours
- En arrivant en service → vérifie ton **Mon espace** :
  - Combien j'ai déjà fait en CA ?
  - Combien me reste-t-il pour atteindre les **50 000 $** (plafond CA) ?
  - Si quota fab actif : où j'en suis sur le score (% moyen) ?
  - Mon salaire estimé évolue-t-il bien ?

### Fin de service
- Vérifie que **toutes tes ventes apparaissent** dans le tableau (sinon il y a peut-être un problème de log Discord)

### Dimanche soir → Lundi 00h00
- La semaine se clôture automatiquement
- Tes compteurs (CA, bénéfice, etc.) sont **remis à zéro pour la nouvelle semaine**
- Tu peux toujours voir tes paies passées dans **Mes paies**

---

## Questions fréquentes

**« Pourquoi mon CA ne monte pas après ma vente ? »**
Le bot Discord n'a peut-être pas remonté ta facture (canal `#suivi-facture`). Attends 30 secondes, sinon préviens ton responsable.

**« Pourquoi mon salaire estimé est nul alors que j'ai vendu ? »**
Si ton CA s'affiche bien mais que le salaire reste à 0 $, c'est probablement un bug — préviens la direction (le calcul est : `(CA / 50 000) × plafond_CA` pour la part CA, plus `score_quota × 5 000` pour le bonus fab).

**« Est-ce que je peux dépasser le plafond ? »**
Non, c'est un plafond légal TTE. Pour gagner plus, il faut **monter en grade** (Novice → Inter → Exp).

Plus de questions ? Va voir [08-faq-depannage.md](08-faq-depannage.md).
