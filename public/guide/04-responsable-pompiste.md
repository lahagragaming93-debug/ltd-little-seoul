# Guide Responsable Pompiste

> Tu pilotes les **8 stations-essence** : tu fixes les prix, gères les capacités, suis les redistributions de ton équipe.
> Tu **gères aussi tes pompistes** depuis Administration : créer, modifier, suspendre, supprimer, changer leur grade.

---

## Tes modules

| Module | Accès | Rôle |
|--------|-------|------|
| **Stations essence** | **Lecture + écriture** | C'est ton outil principal |
| **Revenus carburant** | **Lecture** | CA carburant par station, prix moyen, transactions, graphique CA/jour |
| RH | Lecture | Voir l'effectif pompistes |
| **Administration** | **Lecture + écriture (pompistes uniquement)** | Gérer ton équipe |
| Mon espace + Mes paies | Lecture | Tes infos perso |

> Tu **n'as pas accès** à : Dashboard, Stocks épicerie, Ventes, Comptabilité, Banque LTD, **Configuration globale** dans Administration.

---

## Revenus carburant (nouveau)

La page **Revenus carburant** (groupe Finance dans la sidebar) te donne en un coup d'œil le CA généré par tes stations sur la période choisie (semaine en cours / 7 derniers jours / 30 derniers jours).

**Source** : collection `redistributions` alimentée automatiquement par le bot Discord (canal `#suivi-achat-essence`). À chaque fois qu'un client paie à la pompe, une ligne arrive ici.

**Ce que tu y vois** :
- 4 KPIs : CA total carburant, litres vendus, prix moyen / L (pondéré), nombre de stations actives
- Graphique CA par jour
- Récap par station (CA, litres, transactions, prix moyen) — trie par CA pour repérer la station la plus rentable
- Détail chronologique de toutes les transactions
- Filtre par station + export CSV

**Astuce pilotage** :
- Si une station a un prix moyen / L très bas par rapport aux autres → soit prix mal réglé, soit volume gros consommateur
- Si une station n'apparaît pas dans le récap → aucune vente sur la période → vérifier le stock essence dans `Stations essence`
>
> **Périmètre Administration** : tu peux gérer **uniquement les pompistes** (Novice, Intermédiaire, Expérimenté). Tous les autres comptes apparaissent grisés (lecture seule).

---

## Administration — Gestion de tes pompistes

### Ce que tu peux faire
- **Créer un compte pompiste** (Novice / Inter / Exp)
  - Renseigne **ID Discord** + **ID Perso** systématiquement (sinon les bidons/caoutchoucs/paies ne lui seront pas attribués)
- **Modifier** un pompiste (prénom, NOM, IDs Discord/Perso, date d'entrée)
- **Changer son grade** (promouvoir Novice → Inter → Exp) via le sélecteur de rôle
- **Suspendre** un pompiste (= licenciement) — confirmation 3 secondes
- **Supprimer définitivement** — confirmation 3 secondes + tape `SUPPRIMER` pour activer le bouton

### À ne pas faire
- Ne supprime pas un pompiste sans avoir noté ses derniers chiffres (bidons réalisés, score, paies)
- Ne donne **jamais** un mot de passe par téléphone vocal — toujours via DM Discord ou autre canal écrit traçable
- Ne tente pas de promouvoir un pompiste en Responsable ou DRH — c'est hors de ton périmètre

### Promotion d'un pompiste
1. Dans Admin, ligne du pompiste → sélecteur **Rôle** → choisis le nouveau grade
2. Le changement est immédiat
3. Le **plafond salaire** s'ajuste : 13k → 14k → 15k

---

## Stations essence — Ton outil principal

### Les 8 stations du LTD

| Station | Capacité max | Prix au litre |
|---------|--------------|---------------|
| *(exemple)* Station A | 10 000 L | 5 $ |
| *(exemple)* Station B | 5 000 L | 5,50 $ |

> La liste réelle des stations de l'entreprise (noms, capacités, prix) est paramétrée
> avec le cabinet au moment du branchement et s'affiche dans la page Stations.

> Chaque station a un **seuil d'alerte** à **20 % de la capacité max** par défaut.

### Ce que tu vois

#### KPI en haut
- **Nb stations** (8)
- **Stock total** (en L et en %)
- **Stations en alerte** (sous seuil)
- **Quota bidons** par semaine (utilisé pour calcul paie pompiste)

#### Grille des stations
Chaque station = une carte avec :
- Nom + badge OK / ALERTE
- Barre de progression (stock actuel / max)
- Prix au litre
- Seuil d'alerte
- Bouton **« Modifier / redistribuer »**

#### Redistributions de la semaine
Tableau avec : date, station, litres redistribués, prix au litre, montant, stock après.

### Ce que tu peux faire

#### Ajouter une station
Bouton **« + Ajouter une station »** :
| Champ | Quoi mettre |
|-------|-------------|
| **Nom** (obligatoire) | Le nom commercial complet |
| **Stock actuel** | Combien de L au moment de la création |
| **Stock max** | Capacité totale (défaut 30 000) |
| **Seuil d'alerte** | À partir de combien de L on alerte (défaut depuis config) |
| **Prix au litre** | Tarif vendu au client (défaut depuis config) |

> Cas d'usage : nouvelle station ouverte par le LTD, ou pour test/diag.

#### Modifier une station
Bouton **« Modifier / redistribuer »** sur une station :
- Modifie : nom, stock actuel, stock max, seuil, prix
- Bouton **Supprimer** (modal CRITIQUE 3 sec + tape `SUPPRIMER`)

> Le **stock baisse automatiquement** à chaque vente carburant (canal `xbankaccount` "Redistribution N°X" → décrément via `onBankAccount`).
> Le **stock monte** uniquement via :
> - La modal "Ravitailler" depuis Mon espace pompiste (saisie en litres + select station, depuis 2026-05-14)
> - La modal "Ravitailler" sur cette page Stations (saisie en bidons)
> - L'édition manuelle direction (modifier station)
> - La modal "Corriger un stock" pour incohérence IG/site (alerte direction obligatoire)

#### Configuration globale (essence)
Bouton **« Configuration »** — modale globale :

| Paramètre | Défaut | Impact |
|-----------|--------|--------|
| **Quota bidons / semaine** | 1 700 | Cible bidons par pompiste pour atteindre 100 % de salaire |
| **Quota caoutchoucs / semaine** | 800 | Cible caoutchoucs par pompiste |
| **Prix essence par défaut** | 5 $ | Pour création de nouvelles stations |
| **Seuil d'alerte essence** | (à définir) | Alerte par défaut sur nouvelles stations |

> La config quota / prix est **partagée avec l'Administration**. Si tu modifies ici, c'est aussi visible côté Patron. Coordonne avec la direction avant de toucher aux quotas.

### Bonnes pratiques

#### À faire
- **Surveille les niveaux** chaque jour : 1-2 stations sous seuil = pompiste à dispatcher
- **Adapte les prix** par station selon la zone (quartier aisé plus cher, périphérie moins chère)
- **Vérifie après chaque redistribution** que le stock est bien remonté

#### À ne pas faire
- **Ne baisse pas les quotas bidons sans accord direction** — impact direct sur la paie pompiste (et sur le service à fournir)
- Ne modifie pas le stock actuel manuellement « pour l'arrondir » — tu casses l'audit
- Ne supprime pas une station historique (Vinewood, Senora) sans réflexion — toutes les redistributions liées resteront orphelines
- Ne mets pas un prix négatif ou à 0 (le site bloque, mais ne tente pas de contourner)

---

## RH — Vue lecture seule

Tu peux **voir** :
- Tes pompistes : noms, IDs Discord, heures, score (% bidons + caoutchoucs)
- Performance comparée

Tu ne peux **pas** modifier les rôles, salaires ou statuts.

> Si un pompiste est en sous-régime (score < 50 %), parle-lui avant d'alerter la direction.

---

## Comprendre les paies pompistes (pour bien encadrer)

### Calcul (rappel pour pédagogie)
```
score bidons     = bidons réalisés / quotaBidons (max 100 %)
score caoutchouc = caoutchoucs réalisés / quotaCaoutchoucs (max 100 %)
score moyen      = (bidons + caoutchouc) / 2

Salaire = score moyen × plafond
```

### Plafonds
- Pompiste Novice : 13 000 $
- Pompiste Inter : 14 000 $
- Pompiste Exp : 15 000 $

### Exemples

| Pompiste | Bidons | Caoutchoucs | Score | Salaire (Inter) |
|----------|--------|-------------|-------|-----------------|
| Modèle | 1 700 | 800 | 100 % | 14 000 $ |
| Bon | 1 500 | 700 | (88+88)/2 = 88 % | 12 320 $ |
| Moyen | 1 000 | 500 | (59+62)/2 = 61 % | 8 540 $ |
| Faible | 500 | 200 | (29+25)/2 = 27 % | 3 780 $ |

> Les quotas sont configurables dans **Stations → Configuration**. Plus tu les augmentes, plus c'est dur d'atteindre 100 %.

---

## Ta semaine type

### Lundi matin
- **Stations** : checke le niveau de chacune
- Identifie celles qui ont fini la semaine basses → priorité de redistribution
- Brief tes pompistes (Discord, vocal)

### En cours de semaine
- **2-3 fois par jour**, regarde la grille des stations (pas besoin de rafraîchir, c'est temps réel)
- Si une station passe en ALERTE (bandeau visible) → dispatch un pompiste

### Vendredi
- **Bilan de la semaine** : combien de redistributions ? Sur quelles stations ?
- Note les pompistes en sous-régime pour le DRH/Patron

### Dimanche
- Rien à faire — clôture automatique

---

## Ta propre paie

Comme le Responsable Vente, tu es en **salaire fixe** :
- **Plafond TTE** : 17 000 $/semaine
- **Pas de commission** sur les redistributions de tes pompistes
- Décidé par la direction / DRH

---

## Les 3 erreurs à éviter

1. **Quotas trop bas** = pompistes au plafond facile = paie qui explose la masse salariale
2. **Quotas trop hauts** = pompistes démotivés (impossible d'atteindre 100 %)
3. **Stations en rupture prolongée** = clients déçus, perte de CA, plainte direction

---

## La suite

- **[07-automatismes.md](07-automatismes.md)** : comment les redistributions sont détectées depuis Discord (`#suivi-achat-essence`)
- **[08-faq-depannage.md](08-faq-depannage.md)** : « la station n'a pas baissé après cette redistribution »
