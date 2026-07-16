# Guide complet — LTD Little Seoul

> Le manuel d'utilisation officiel de la plateforme de gestion du LTD.
> Dernière mise à jour : **2026-05-14** — ajout fichier **10 (référence T.T.E. intégrale)**

Bienvenue. Ce guide est organisé **par rôle** : chaque employé n'a besoin de lire que la partie qui le concerne. La direction lit tout.

> **Astuce** : ce guide est intégré au site. Sur n'importe quelle page, clique l'onglet **« Guide »** dans la sidebar — le bon chapitre se sélectionne automatiquement selon ton rôle. Bouton **Imprimer / PDF** disponible en haut pour exporter.

---

## Comment utiliser ce guide

| Tu es… | Lis dans cet ordre |
|--------|--------------------|
| **Patron / Co-Patron** | 01 → 02 → 03 → 04 → 07 → 08 → **09** (tout) |
| **Admin Technique** | **09** (compta) → 07 → 01 |
| **DRH** | 02 → 07 → 08 → 09 |
| **Responsable Vente** | 03 → 07 → 08 |
| **Responsable Pompiste** | 04 → 07 → 08 |
| **Vendeur** (novice / inter / exp) | 05 → 08 |
| **Pompiste** (novice / inter / exp) | 06 → 08 |
| **Contrôleur IRS RP** (audit ponctuel) | **09** uniquement (section 4-5 : lire le Dashboard + comprendre les onglets) |

Tu peux aussi tout lire si tu veux comprendre comment marche l'entreprise.

---

## Sommaire

| Fichier | Contenu | Pour qui |
|---------|---------|----------|
| **[01-direction.md](01-direction.md)** | Tout le site : dashboard, comptabilité, admin, conformité TTE | Patron, Co-Patron |
| **[02-drh.md](02-drh.md)** | Ressources humaines, paies, conformité salariale | DRH (et direction) |
| **[03-responsable-vente.md](03-responsable-vente.md)** | Stocks épicerie, ventes, prix, alertes stock | Responsable Vente |
| **[04-responsable-pompiste.md](04-responsable-pompiste.md)** | Stations essence, redistributions, quotas | Responsable Pompiste |
| **[05-vendeur.md](05-vendeur.md)** | Ton espace, tes paies, comprendre ta commission | Vendeurs |
| **[06-pompiste.md](06-pompiste.md)** | Ton espace, tes paies, comprendre les quotas | Pompistes |
| **[07-automatismes.md](07-automatismes.md)** | Bot Discord, clôture hebdo, alertes — comment ça marche | Tout le monde |
| **[08-faq-depannage.md](08-faq-depannage.md)** | « Je vois pas mes ventes », « Ma paie est fausse », etc. | Tout le monde |
| **[09-comptabilite.md](09-comptabilite.md)** | Compta complète : accès Sheet, saisies, clôture, Dashboard, partage IRS | Direction, Admin Tech, audit IRS |
| **[10-tte-reference.md](10-tte-reference.md)** | **Référence T.T.E. intégrale** (12 chapitres) — Code des Taxes, du Travail & des Entreprises avec annotations LTD (Secteur 2) | Direction, audit IRS, juriste |

---

## Adresse du site

*L'URL t'a été transmise par la direction sur ta tablette.*

Le site fonctionne sur :
- **Ordinateur** (navigateur classique : Chrome, Firefox, Edge…)
- **Téléphone** (responsive complet, boutons tactiles)
- **Tablette in-game FiveM** (optimisé CEF, navigation sans nouvel onglet)

Aucune application à installer. Juste l'URL.

---

## Comment je me connecte ?

1. Ouvre l'URL ci-dessus.
2. Saisis **email + mot de passe** transmis par la direction.
3. Au **premier accès**, le site te demande de **changer ton mot de passe** (8 caractères minimum). Choisis bien : il n'y aura plus de mot de passe par défaut après.
4. Tu arrives directement sur **ta page d'accueil** selon ton rôle :
   - Direction / DRH → **Dashboard**
   - Responsable Vente → **Ventes**
   - Responsable Pompiste → **Stations essence**
   - Vendeur / Pompiste → **Mon espace**

> **Important** : tu ne peux pas créer ton compte toi-même. Tous les comptes sont créés par un Patron via **Administration**.

---

## Comment je me déplace dans le site ?

### Sur ordinateur
- **Sidebar à gauche** : tous les modules accessibles à ton rôle.
- **Topbar en haut** : titre de la page + **cloche d'alertes** (cliquable, ouvre la liste des alertes actives — chaque alerte est cliquable et te redirige vers la page concernée) + ton avatar (initiales) + ton nom + **badge de rôle coloré** (différent par grade) + bouton de déconnexion (`⎋`).

### Sur tablette FiveM ou téléphone
La sidebar disparaît automatiquement et est remplacée par :
- **Bouton ☰** (en haut à gauche) : ouvre/ferme le menu de navigation.
- **Bouton ←** : retour à la page précédente.
- Touche **Échap** : ferme le menu.

Le menu se referme tout seul après chaque clic, donc tu n'as jamais à le faire manuellement.

---

## Tout est en temps réel

Tu n'as **jamais besoin de rafraîchir la page**. Dès qu'une vente, une dépense, une paie, un service ou un mouvement de stock est fait via le bot Discord (logs in-game), ça apparaît immédiatement sur le site, partout (ordi + tablette + téléphone). Pareil pour les alertes (rupture de stock, station basse, masse salariale critique).

Idem pour les modifications faites depuis le site (prix, quotas, salaires) : elles sont visibles instantanément par tous les utilisateurs connectés.

---

## Confirmations en 3 secondes

Pour les actions **dangereuses ou irréversibles**, le site ouvre un modal rouge **« ACTION CRITIQUE »** :

- Le bouton « Confirmer » est **bloqué pendant 3 secondes** (compte à rebours visible).
- Pour les actions très destructives (suppression de compte, suppression de station), tu dois aussi **taper le mot `SUPPRIMER`** pour activer le bouton.

C'est volontaire : ça évite les clics accidentels qui détruiraient des données.

> Pas de popup de navigateur (les `confirm()` JavaScript classiques) — uniquement des modals dans le site, pour que ça marche aussi sur la tablette FiveM in-game.

---

## En cas de souci

1. **Lis [08-faq-depannage.md](08-faq-depannage.md)** : 90 % des problèmes courants y sont expliqués.
2. **Si le site ne charge pas** → vérifie ta connexion et contacte la direction
3. **Si le bot Discord ne remonte rien** → contacte la direction
4. **Si tu vois quelque chose d'incohérent** → fais une capture et envoie-la à la direction sur Discord

---

## Mot de la direction

Cet outil est fait pour vous **simplifier la vie**, pas vous compliquer. Tout est automatisé au maximum — vous n'avez **rien à saisir manuellement** dans 95 % des cas, le bot Discord remonte tout depuis les logs in-game.

Votre rôle, c'est de **faire votre boulot RP** : vendre, redistribuer l'essence, encadrer l'équipe. Le site fait le reste : calcule les commissions, vérifie la conformité TTE, alerte sur les stocks bas, sort les paies.

Bonne lecture, et bon boulot au LTD.
