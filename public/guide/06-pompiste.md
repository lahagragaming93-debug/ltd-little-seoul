# Guide Pompiste

> Tu es **pompiste** au LTD (Novice, Intermédiaire ou Expérimenté). Ton job : **ravitailler les 8 stations** en essence et **fabriquer des caoutchoucs**. Toutes tes déclarations se font sur le site (depuis 2026-05-12, c'est la source de vérité — pas les logs Discord).

---

## Tes 3 pages

| Page | Contenu |
|------|---------|
| **Mon espace** | Tes performances + déclarations rapides (ravitailler, caoutchoucs, corriger stock) |
| **Stations essence** | Niveaux des 8 stations + ravitaillement par station + déclaration caoutchoucs |
| **Mes paies** | Historique des paies reçues |

> Pas d'accès aux ventes, à la compta, à l'admin, etc. Tu vois uniquement ce qui te concerne.

---

## Mon espace — la page principale

### Bandeau "En service" (si tu es en service)
Quand tu es en service (commencé via Discord), un **bandeau vert** s'affiche en haut :
> **En service** depuis 14h27 (2h15 écoulées). Les compteurs ci-dessous incluent ce service en cours.

Les KPIs **montent en live** sans attendre la fin de service. Pas besoin de finir + recommencer pour voir tes heures évoluer.

### Les 4 KPIs principaux
| KPI | Signification |
|-----|---------------|
| **Bidons ravitaillés** | Nombre de bidons d'essence que tu as déclarés cette semaine |
| **Caoutchoucs produits** | Nombre de caoutchoucs déclarés cette semaine |
| **Score global** | Moyenne (% bidons + % caoutchoucs) — ton indicateur principal |
| **Salaire estimé** | Score × plafond de ton grade |

### Détail de ta semaine

#### Bidons + valeur unitaire
```
Bidons d'essence ravitaillés          +3,82 $/bidon
[================        ] 850 / 1700 → 3 250 $
```
Tu vois directement **combien rapporte 1 bidon** à ton grade. Chaque bidon que tu fais ajoute ce montant à ton salaire estimé.

#### Caoutchoucs + valeur unitaire
```
Caoutchoucs produits                  +8,13 $/caoutchouc
[============            ] 400 / 800 → 4 065 $
```

#### Salaire estimé total
```
Salaire estimé / plafond Pompiste Novice
[==================      ] 7 315 $ / 13 000 $
```

> **Tu touches dès le 1er bidon ou caoutchouc.** Pas besoin d'attendre d'avoir tout fait. Si tu ravitailles 50 bidons sans encore faire de caoutchouc, tu vois déjà ~191 $ apparaître (50 × 3,82 $ Novice).

### Consulter l'historique de tes semaines
Au-dessus du panel **« Détail de ta semaine »**, un **sélecteur de semaine** te permet de remonter dans les semaines clôturées :
- Par défaut : « Semaine en cours ».
- Sélectionne une semaine passée pour voir tes **bidons / caoutchoucs / score / salaire calculé** de cette semaine-là.
- Le badge `Clôturée` apparaît à côté du titre du panel, et la liste live des stations + les boutons d'action disparaissent (uniquement pertinents pour la semaine en cours).
- Les blocs **Heures de service** et **Avertissements** restent toujours sur la semaine en cours.
- Le choix est mémorisé dans la session — pas perdu au refresh.

### État des stations en temps réel
Sous ton détail, tu vois la liste des **8 stations** triées par % stock croissant (les plus basses en haut, pour savoir où aller en priorité).

Chaque station affiche :
- Stock actuel / Capacité max + % rempli
- Badge **OK** / **BAS** / **ALERTE** selon le seuil

### 3 boutons en haut de Mon espace

#### Ravitailler une station
Modal directe sans devoir aller sur la page Stations :
1. **Sélectionne la station** dans le menu déroulant (avec son stock actuel affiché)
2. Saisis le **nombre de litres ajoutés**
3. **Preview live** : conversion en bidons (1 bidon = 15 L) + nouveau stock après
4. Si tu dépasses la capacité : alerte rouge avant validation
5. Click **Valider** → stock station mis à jour automatiquement + tes bidons incrémentés (+1 bidon par 15 L)

#### Déclarer des caoutchoucs
Lien vers Stations avec auto-ouverture de la modal caoutchoucs :
- Saisis le **nombre de caoutchoucs** que tu viens de fabriquer
- Validation → ton quota perso est incrémenté

#### Corriger un stock (en cas d'incohérence)
À utiliser **uniquement** si le stock affiché sur le site ne colle pas avec le stock réel in-game (par exemple le site dit 14 000 L mais en pompe il y en a 12 000 L) :
1. Sélectionne la station
2. Saisis la **vraie valeur du stock** (en litres)
3. **Raison obligatoire** (au moins 5 caractères, ex : "écart 2000 L IG vs site")
4. Validation → stock mis à jour + **alerte direction** (audit obligatoire)

> Une alerte est envoyée à la direction à chaque correction. Utilise cette fonction de manière justifiée — c'est tracé.

---

## Page Stations essence

Tu y vois les 8 stations avec :
- Stock actuel + capacité max + barre de progression
- Prix au litre
- Badge alerte si stock < seuil
- Bouton **« Ravitailler »** sur chaque station (saisie en bidons)
- Bouton **« Déclarer caoutchoucs »** en haut

Cette page est utile si tu veux voir l'ensemble + ravitailler en mode "1 station après l'autre". Mais le bouton Ravitailler de Mon espace est plus rapide pour les corrections ponctuelles.

---

## Mes paies

Identique à la page Vendeur :
- Paie de la semaine en cours + plafond grade
- Paie du mois
- Total reçu depuis ton entrée
- Tableau historique : date, payeur, montant

> Si une paie manque : vérifie que **ton ID Perso est renseigné** dans ton profil (le bot matche les paies via l'ID Perso). Sinon contacte la direction.

---

## Comprendre ta paie

### Formule
```
score bidons     = MIN(1, bidons / 1700)
score caoutchouc = MIN(1, caoutchoucs / 800)
score moyen      = (score bidons + score caoutchouc) / 2

Salaire = score moyen × plafond
```

### En clair : ton salaire est divisé en 2 moitiés
- **Moitié bidons** : si tu fais les 1700 bidons → tu gagnes la moitié du plafond
- **Moitié caoutchoucs** : si tu fais les 800 caoutchoucs → tu gagnes l'autre moitié

### Combien rapporte 1 unité

| Grade | Plafond | 1 bidon | 1 caoutchouc |
|-------|--------:|--------:|-------------:|
| Novice | 13 000 $ | 3,82 $ | 8,13 $ |
| Inter | 14 000 $ | 4,12 $ | 8,75 $ |
| Exp | 15 000 $ | 4,41 $ | 9,38 $ |

### Cas concrets

#### Cas 1 — Quotas atteints à 100 %
**Pompiste Inter** : 1700 bidons + 800 caoutchoucs = 100 % score = **14 000 $** (plafond plein)

#### Cas 2 — Une catégorie en retard
**Pompiste Inter** : 1700 bidons + 400 caoutchoucs
- Score = (100 % + 50 %) / 2 = 75 %
- Salaire = 75 % × 14 000 = **10 500 $**

#### Cas 3 — Largement au-dessus du quota
Pas de bonus pour faire plus que le quota — score plafonné à 100 % par catégorie.
**Pompiste Exp** : 3000 bidons (vs 1700) + 800 caoutchoucs → **15 000 $** (plafond Exp).

> Une fois ton quota atteint, **continue quand même** — tu rends service à l'équipe et au LTD. Mais si tu veux gagner plus, demande à monter en grade.

---

## Comment maximiser ta paie

### 1. Équilibre les 2 catégories
Le score est une **moyenne**. 200 % en bidons + 0 % en caoutchoucs = 50 % de score, pas 100 %. Vise les deux.

### 2. Surveille les stations en temps réel
Le bloc "État des stations" sur Mon espace montre les stations triées par % stock croissant. Vise celles en alerte ou au-dessous de 30 %.

### 3. Déclare immédiatement après chaque ravitaillement
Plus tu déclares vite, plus ton salaire estimé monte vite, et plus la liste des stations est à jour pour tes collègues.

### 4. Monte en grade
Plafond fixe par grade :
- Novice : 13 000 $ max
- Inter : 14 000 $ max
- Exp : 15 000 $ max

Pour passer Inter ou Exp, il faut le faire valider par la direction (ancienneté + performance).

### 5. Vérifie tes IDs
Ton compte doit avoir :
- **ID Discord** renseigné (pour matcher les services)
- **ID Perso** (in-game) renseigné (pour matcher les paies)

Sans ces IDs, tes performances ne sont pas comptabilisées correctement.

### 6. Fais tes heures de service
Vise au moins **7h/semaine**. Le compteur "Heures de service" inclut maintenant le service en cours en live (le bandeau vert "En service" l'indique).

---

## Ce que tu ne peux PAS faire

- Modifier le **prix au litre** d'une station (réservé direction)
- Modifier la **capacité max** d'une station (réservé direction)
- Modifier le **seuil d'alerte** d'une station (réservé direction)
- Ajouter ou supprimer une station (réservé direction)
- Voir les autres pompistes (uniquement la direction et ton responsable)
- Changer les quotas (responsable pompiste / direction)

> Si un quota change, ton salaire estimé est recalculé automatiquement à ton prochain refresh.

---

## Questions fréquentes

**« Mon stock affiché ne correspond pas à ce que je vois en jeu »**
Utilise le bouton **« Corriger un stock »** sur Mon espace. Renseigne la vraie valeur + une raison claire. La direction est notifiée.

**« J'ai ravitaillé mais mon salaire ne bouge pas »**
Tu as bien validé la modal "Ravitailler" ? Si oui, recharge la page (F5). Sinon, refais la déclaration.

**« Pourquoi je ne vois pas mes heures d'aujourd'hui ? »**
Si tu es encore en service, tu devrais voir un bandeau vert "En service depuis HHhMM" qui inclut le temps écoulé en live. Sinon, ton service n'a pas été détecté — vérifie ton ID Discord.

**« Mes caoutchoucs ne sont pas comptés depuis Discord »**
Depuis 2026-05-12, le bot Discord ne compte plus les caoutchoucs automatiquement. **Tu dois les déclarer toi-même** via le bouton "Déclarer caoutchoucs" (sur Stations, accessible aussi depuis Mon espace).

Plus de questions ? Va voir [08-faq-depannage.md](08-faq-depannage.md).
