# FAQ + Dépannage

> Les **20 questions courantes** avec leurs solutions. Cherche par mot-clé (Ctrl+F) ou parcours par rubrique.

---

## Connexion / Compte

### « Je ne peux pas me connecter, ça me dit "Email ou mot de passe incorrect" »
1. Vérifie l'orthographe de l'email (pas d'espace, pas de majuscule à oublier)
2. Vérifie le Caps Lock (le mot de passe est sensible à la casse)
3. Si toujours bloqué : clique sur **« Mot de passe oublié »** sur la page de connexion → un email de réinitialisation est envoyé
4. Si l'email n'arrive pas (regarde aussi les spams) : contacte la direction pour qu'ils te recréent un mot de passe provisoire

### « Le site me dit "Compte suspendu" »
Ton compte a été suspendu par la direction. Concrètement, tu es **licencié** du LTD côté plateforme. Contacte le Patron sur Discord pour comprendre la raison et éventuellement te faire réactiver.

### « Le site me dit "Accès refusé" sur certaines pages »
Normal — chaque page n'est accessible qu'à certains rôles. Le site te redirige automatiquement vers ta page d'accueil. Si tu penses que c'est une erreur (tu devrais avoir accès à cette page), demande à la direction de vérifier ton rôle.

### « Au premier accès, le site m'a demandé de changer le mot de passe — je l'ai oublié »
Mot de passe oublié → bouton **« Mot de passe oublié »** sur la page de connexion → email de reset.

### « Je ne suis pas redirigé vers la page de login après déconnexion »
Ne devrait jamais arriver. Si ça t'arrive : ferme l'onglet et rouvre l'URL. Si ça persiste, vide le cache du navigateur.

### « Je ne vois pas le site, juste un écran blanc »
1. Recharge la page (F5)
2. Vide le cache (Ctrl+Shift+R)
3. Ouvre la console (F12) et regarde s'il y a des erreurs rouges
4. Si rien ne marche : contacte la direction

---

## Ventes / CA

### « J'ai fait une vente in-game mais elle n'apparaît pas dans Mon espace »
Vérifications dans l'ordre :
1. Le bot Discord est-il actif ? Demande à un Patron de checker Railway
2. Le canal `#suivi-facture` reçoit-il bien des embeds FiveM ? (Ça tu peux le voir directement sur Discord)
3. **Ton ID Discord est-il renseigné** dans ton profil ? Si non, ta vente apparaîtra dans Ventes mais pas dans Mon espace
4. Attends ~30 secondes : il y a parfois un léger délai

### « Mon CA est nul alors que j'ai vendu plein de choses »
Probablement ton **ID Discord** qui n'est pas renseigné dans ton compte. Demande à un Patron d'aller dans **Admin → Modifier ton compte → ID Discord**.

### « Le bénéfice affiché est nul ou bizarre »
Le bénéfice se calcule par : `prix vente − prix achat × quantité`. Si le **prix d'achat** d'un produit n'est pas renseigné (resté à 0), le bénéfice peut être faux ou nul. Demande au Responsable Vente de vérifier.

### « Une vente apparaît avec "Discordance" — c'est quoi ? »
Une vente est marquée discordance quand le système n'a pas trouvé de **sortie de stock corrélée** dans les minutes qui suivent la facture. Causes possibles :
- Bug du bot Discord (il a raté un log)
- L'item facturé n'est pas dans le catalogue produits
- Vente sans intention de sortir le stock (test, fictive, vol)

→ La direction enquête systématiquement sur ces alertes.

---

## Stocks

### « Le stock n'a pas baissé après ma vente »
Ça peut être :
- Le bot a raté le log `inventory-remove` (rare)
- L'item vendu n'est pas dans le catalogue (donc rien à débiter)
- Le bot Discord est en panne

→ Préviens ton Responsable Vente.

### « Une rupture est affichée mais le produit est en stock dans la boutique RP »
Peut-être un **décalage** entre le stock système et le stock réel (oubli d'inventaire, vol, casse). Solution :
1. Va dans **Stocks → Modifier** sur ce produit
2. Champ **Delta** : mets la différence (+X)
3. Champ **Raison** : « inventaire physique constaté +X »
4. Enregistre — l'audit retient la trace

### « Je veux ajouter un nouveau produit au catalogue »
Va dans **Stocks épicerie** → bouton **« + Ajouter un produit »** (en haut à côté des filtres).

> Bouton visible uniquement pour **Patron, Co-Patron et DRH**. Les Responsables Vente peuvent modifier les prix/seuils existants mais pas créer de nouveau produit (gestion catalogue = gestion direction/DRH).

Renseigne :
- **Nom** (obligatoire) — l'identifiant technique se génère tout seul à partir du nom (slug). Tu peux le modifier si besoin (lettres minuscules / chiffres / tirets uniquement).
- **Catégorie** (Outillage / Document / Agriculture / Mécanique / Nourriture / Divers)
- **Prix achat / vente** (en $ RP)
- **Seuil d'alerte** (défaut 5)
- **Stock initial** (optionnel — un mouvement « Création produit (stock initial) » est alors tracé dans l'audit)

Le produit apparaît immédiatement dans le tableau et est utilisable par toute l'équipe.

> Si tu mets un prix d'achat **supérieur** au prix de vente, un modal critique 3 secondes te prévient (vente à perte).

### « Pourquoi le seuil d'alerte ne se déclenche pas ? »
Vérifie que le seuil est **strictement supérieur à 0** dans la fiche produit. Avec seuil = 0, l'alerte ne se déclenche qu'à rupture (qte = 0).

---

## Stations essence

### « Le stock de la station n'a pas monté après ma redistribution »
- Vérifie sur Discord que le log `#suivi-achat-essence` est bien apparu (avec ton message)
- Si oui, le bot a peut-être eu un souci → contacte le Responsable Pompiste
- Si non, ta commande RP n'a pas été enregistrée par le serveur (bug FiveM)

### « Quel prix au litre je dois mettre sur cette station ? »
Voir avec le Responsable Pompiste / direction. Stratégie historique :
- Vinewood (Clinton) : **5,50 $** (zone aisée)
- Favélas (Palomino) : **6 $** (peu de concurrence)
- Cholla / Algonquin : **4,50 $** (bas, attire les gros pleins)
- Reste : **5 $** (référence)

---

## Paie / Salaire

### « Mon salaire estimé est trop bas par rapport à mes performances »
Possibilités :
- Tu n'as pas atteint ton quota (pompiste) ou ton CA n'est pas haut (vendeur)
- Tu débutes la semaine, le compteur va monter au fur et à mesure
- Tu es plafonné par ton grade (Novice = 13k max, etc.)
- Vendeur : salaire = `(CA / 50 000) × plafond_CA` + `score_fab × 5 000 $`, plafonné au plafond total du grade. Si le quota fabrication n'est pas atteint, le bonus est plus faible.

### « J'ai reçu une paie mais elle n'apparaît pas dans Mes paies »
Probablement **ton ID Perso** qui n'est pas renseigné. Le bot matche les paies via l'ID Perso (in-game). Demande au Patron de vérifier ton profil.

### « Ma paie n'a pas été versée alors que j'ai bossé toute la semaine »
La paie n'est **pas versée automatiquement** par le site — c'est le Patron / DRH qui doit te la verser via Discord (`#paie`) selon ce que le système estime. Si tu vois ton estimation correcte mais rien dans Mes paies → relance la direction RP.

### « Pourquoi ma part CA ne monte plus alors que mon CA grimpe ? »
Au-delà de **50 000 $** de CA commissionnable, la part CA du salaire est **plafonnée** à 8/9/10k selon ton grade. Ce qui se vend au-dessus profite au LTD (et aux primes hebdo collectives) mais pas à ta part CA. Pour aller au-delà de ton plafond CA, atteins ton quota de fabrication (bonus +5 000 $). C'est volontaire (équité TTE).

---

## Comptes / Profils

### « Mon nom RP est mal orthographié dans le site »
Demande à un Patron : **Admin → Modifier ton compte → Prénom / NOM** → corrige.

### « Mon ID Discord ou ID Perso n'est pas le bon »
Idem : Patron va dans Admin → Modifier → corrige.

### « Comment je deviens Vendeur Intermédiaire (ou Expérimenté) ? »
Ce n'est pas automatique. Ça se décide en RP — il faut faire valider le passage par la direction (ancienneté, performances, attitude). Le Patron change ton rôle dans Admin.

### « Comment je quitte le LTD ? »
Préviens la direction. Ton compte sera suspendu (≠ supprimé : tes paies passées restent visibles à la direction pour audit). Si tu veux un effacement complet, demande-le explicitement (ils utiliseront `Admin → Supprimer définitivement`).

---

## Comptabilité / TTE

### « C'est quoi la "masse salariale" et pourquoi elle ne doit pas dépasser 90 % ? »
Masse salariale = total des salaires versés (et estimés) divisé par le CA de la semaine, en pourcentage.

Au-delà de 90 %, l'entreprise n'est plus économiquement viable et **viole le TTE Chap. IV — Secteur 2**. Sanctions RP possibles. C'est pour ça que la direction surveille ce ratio en permanence.

### « Pourquoi vous gardez 100 % de l'historique ? Le TTE dit 6 semaines »
Le TTE dit **minimum** 6 semaines. On garde tout par sécurité (audit RP, contestations, statistiques internes). Aucun risque légal.

### « C'est quoi les primes Art. 4-1.10 et Art. 4-1.11 ? »
Ce sont des primes prévues par le TTE :
- **Art. 4-1.10** : prime hebdomadaire selon le CA total (5k à 15k)
- **Art. 4-1.11** : prime mensuelle selon le bénéfice net du mois (20k à 60k)

Calculées automatiquement, intégrées à la comptabilité.

---

## Tablette FiveM / Mobile

### « Sur la tablette in-game, le menu est trop petit / mal placé »
Le site a 4 breakpoints responsive (1280, 1024, 600, 380 px). Si la tablette FiveM utilise une résolution non standard, dis-le à la direction technique pour ajuster.

### « Quand je clique sur un lien, ça veut ouvrir un nouvel onglet »
Ne devrait pas arriver — aucun lien du site n'a `target="_blank"`. Si ça t'arrive : c'est un comportement du navigateur intégré FiveM (CEF). Essaie un clic simple plutôt que ctrl+clic ou clic-droit.

### « J'ai pas de bouton retour sur la tablette »
Le bouton **←** est dans la topbar, à gauche du titre (à côté du menu hamburger ☰). Sur très petit écran (< 380 px), le titre est masqué pour faire de la place.

### « Le clic ne réagit pas du premier coup »
Les boutons ont une zone tactile minimum de 44 px sur mobile. Si vraiment ça ne réagit pas, c'est probablement la latence Firebase (1-2 sec). Réessaie.

---

## Alertes / Notifications

### « Je vois un badge rouge avec un nombre en haut à droite — c'est quoi ? »
Le **compteur d'alertes actives**. Clique dessus pour voir le détail (rupture stock, station basse, vente sans stock, masse salariale critique).

### « Comment je désactive les notifications Discord ? »
Va dans **Admin → Configuration globale → URL Webhook Discord** → vide le champ → enregistre. Plus rien ne sera posté sur Discord.

### « Comment je sais qu'une alerte a été résolue ? »
Pour l'instant, les alertes sont créées mais **pas marquées comme résolues** automatiquement. Le compteur diminuera quand le problème sera réglé (ex. stock remis, station rechargée). Une UI de gestion d'alertes pourrait être ajoutée plus tard.

---

## Côté technique (direction)

### « La clôture hebdo n'a pas eu lieu »
Console Firebase → Functions → `clotureHebdo` → Logs. Si erreur visible → relancer manuellement (besoin d'un dev). Très rare.

### « Le bot Discord ne répond plus »
Railway → Project LTD Little Seoul → Deployments → Logs. Check si « Disconnected » ou erreur 401.

### « Je vois "Erreur 401 Unauthorized" dans la console »
Le token entre le bot et `botIngest` (Cloud Function) ne correspond plus. Cf. mémoire `feedback_firebase_secrets.md` — utiliser `firebase functions:secrets:set NAME --data-file fichier` (jamais `echo ... | firebase`).

### « Comment je sauvegarde les données Firestore ? »
Pas de backup automatique configuré. Tu peux exporter manuellement via la console Firebase (Storage → Export). Pour une vraie sauvegarde régulière, il faudrait configurer Cloud Storage + scheduled export.

---

## Quand rien ne marche

1. **Recharge la page** (F5)
2. **Vide le cache** (Ctrl+Shift+R)
3. **Console DevTools** (F12) → Onglet Console → cherche les erreurs rouges
4. **Contacte la direction** avec :
   - Capture d'écran du problème
   - Ce que tu faisais quand c'est arrivé
   - L'heure approximative

---

## Tu n'as pas trouvé ta réponse ?

Relis le guide qui correspond à ton rôle (sommaire dans [00-index.md](00-index.md)) ou demande directement sur Discord.
