# Guide des automatismes

> Tu n'as quasiment **rien à saisir manuellement** : le bot Discord, les Cloud Functions et les listeners temps réel font 95 % du travail. Voici comment tout marche en coulisse.

Ce guide est utile pour **comprendre pourquoi quelque chose s'est passé tout seul**, ou **pourquoi quelque chose ne s'est PAS passé** (et comment le corriger).

---

## Le bot Discord — Le cœur du système

### Comment il fonctionne
Le bot écoute **8 canaux** sur le Discord du LTD. Dès qu'un embed (message structuré FiveM) apparaît, il :
1. Parse le contenu (extrait nom, montant, item, IDs…)
2. Envoie un payload JSON au site (`botIngest` Cloud Function)
3. Le site enregistre l'info dans la base de données Firestore
4. Tous les écrans connectés se mettent à jour en temps réel

Le bot tourne **24/7 sur Railway** (serveur cloud gratuit). Si tu ne vois rien arriver alors que les logs existent dans Discord :
- Vérifie sur Railway que le bot est bien « Running »
- Vérifie les permissions du bot sur les canaux Discord (View Channels + Read Message History)

### Les 12 parsers et ce qu'ils font

#### Phase 1 — parsers initiaux (8)

| Canal Discord | Parser | Ce qui est extrait | Où ça arrive sur le site |
|---------------|--------|---------------------|--------------------------|
| `#logs-ig` | inventory | Type (add/remove), item, quantité, qui | **Stocks épicerie** + quotas pompistes |
| `#logs-services` | service | Action (start/end), employé, IDs | **RH → heures de service**, **Mon espace** |
| `#suivi-service-vendeur` | service | Idem pour les vendeurs | **RH → heures de service** |
| `#suivi-facture` | facture | N° facture, vendeur, client, montant, items, paiement | **Ventes** + Mon espace vendeur |
| `#suivi-achat-essence` | redistribution | Station, litres, prix, stock après | **Stations essence → redistributions** |
| `#depenses` | depense | Compte, utilisateur, montant, raison, type | **Comptabilité → charges** + colonne `soldeApres` (sortie) |
| `#paie` | paie | Payeur, bénéficiaire (IDs Discord + Perso), montant | **Mes paies** + RH salaires versés |
| `#suivi-coffre` | coffre | Transactions coffre LTD | `/coffre` (audit) |

#### Phase 2 — parsers avancés (5 — ajoutés récemment)

| Canal Discord | Parser | Ce qui est extrait | Où ça arrive |
|---------------|--------|---------------------|--------------|
| `#logs-ig` (en plus de inventory) | **xbankaccount** | Entrées d'argent (`addmoney` sur iban LTDSEOUL) avec solde après | **Page Banque LTD** + KPI Dashboard Solde temps réel |
| `#logs-ig` (en plus de inventory) | **factureCancel** | Suppressions de facture IG (`xbankaccount - cancel` / `logType=cancel`, `category=xbill`) : billId, qui a annulé, motif | **Marque la vente `annulee:true, cachee:true`** → disparaît du panel "à déclarer" du vendeur, badge `Annulée` côté RH avec motif et date. Alerte direction si la vente avait été déclarée manuellement avant l'annulation IG (potentielle fraude). |
| `#auto-rh` | **autoRh** | 3 events : `EMBAUCHE` / `EXCLUSION` / `DÉPART` (volontaire) avec IDs Discord + perso | **Admin → Embauches à traiter** (nouveau panneau) + suspension auto sur exclusion/départ |
| `#autorankup` | **autorankup** | Promotion (Vendeur → Resp Vente, etc.) avec ancien + nouveau rôle | **MAJ rôle automatique** côté site (plafond salaire ajusté) |
| `#statsbank` | **statsbank** | Récap hebdo officiel FiveM (CA, sorties, déficit/bénéfice, factures, **impôt estimé** + tranche TTE, top vendeurs) | **Comptabilité → Comparaison cross-source** |
| `#pompiste` | **rapportPompiste** | Rapport quotidien : niveau % de chaque station | **MAJ stockActuel** des 8 stations en 1 seul log |
| `#ventes` | **venteAuto** | Ventes du distributeur LTD (Vendeur=LTD), items + total | `/ventes` avec `source='ventes-auto'` (mapping items à venir) |

> Le canal `#logs-ig` a maintenant **3 parsers en cascade** : factureCancel (testé en 1er, filtre `logType=cancel`+`category=xbill`), xbankaccount (filtre IBAN LTDSEOUL), puis inventory (fallback). Permet de gérer 3 types d'embeds sur le même canal.

> **Outil de découverte** : Admin → bouton « Découverte items FiveM » liste tous les noms d'items uniques observés pour aider au mapping nom commercial ↔ nom FiveM interne.

> Tous les **canaux logs bruts** (#suivi-coffre-secondaire, #alerte-coffre, #revenu, #factures, #logs-licenciement, #logs-avertissement) sont archivés sans parsing pour audit.

### Ce qu'il faut absolument savoir

#### Pour les ventes : le bot matche le vendeur sur l'**ID Discord**
Si un vendeur n'a pas d'ID Discord renseigné dans son profil, ses ventes apparaîtront avec « (Vendeur inconnu) » et il ne touchera **aucune commission**.

→ Solution : Patron va dans **Admin → Modifier** sur le compte du vendeur → renseigne l'ID Discord.

#### Pour les paies : le bot matche le bénéficiaire sur l'**ID Perso**
Si un employé n'a pas d'ID Perso renseigné dans son profil, les paies versées via Discord ne lui seront pas attribuées.

→ Solution : Patron va dans **Admin → Modifier** → renseigne l'ID Perso.

#### Pour les stocks : aucun matching nécessaire
Le bot lit l'item depuis le log et met à jour le stock global directement. Pas d'attribution individuelle.

#### Pour les services (heures) : matching sur **ID Discord**
Idem que les ventes. Sans ID Discord, les heures ne sont pas comptabilisées au bon employé.

---

## Clôture hebdomadaire automatique

### Quand
- **Tous les lundis à 00:00** heure de Paris (Europe/Paris)
- Cron déclenché par la Cloud Function `clotureHebdo`

### Ce qui se passe automatiquement
1. La Cloud Function calcule la **semaine qui vient de finir** (lundi précédent 00:00 → dimanche 23:59:59)
2. Elle agrège : ventes, dépenses, paies, masse salariale, bénéfice net
3. Crée un document `/semaines/{weekKey}` avec :
   - CA, bénéfice brut, dépenses, charges déductibles, masse salariale, bénéfice net
   - Statut : `cloturee`
   - Date de clôture
4. La nouvelle semaine démarre avec des compteurs à 0

### Conservation des données
- **Toutes les semaines passées sont conservées** (pas de purge)
- Tu peux consulter n'importe quelle semaine archivée dans **Comptabilité → Sélecteur de semaine**
- C'est la conformité TTE Chap. IV qui demande min. 6 semaines — on en garde 100 % par sécurité

### Que faire si la clôture échoue
- Vérifie sur la console Firebase → Functions → Logs
- Préviens la direction technique (l'utilisateur ou Maxime BLAKE)
- Les données ne sont pas perdues : la clôture peut être relancée manuellement par un développeur

---

## Alertes automatiques

Le système crée des alertes en temps réel via 3 Cloud Functions Firestore (déclenchées par changement de données).

### 1. Alerte stock épicerie (`alerteStock`)

**Déclencheur** : changement dans `/stocks/{produit}`

**Conditions** :
- Si quantité = 0 → alerte **rupture** (gravité danger)
- Si 0 < quantité ≤ seuil → alerte **bas** (gravité warning)

**Anti-doublon** : si une alerte non résolue identique existe déjà, n'en crée pas de nouvelle.

**Notification Discord** : si l'URL webhook est configurée (Admin → Configuration globale → Webhook Discord), un message est posté sur le canal Discord choisi.

### 2. Alerte station essence (`alerteStation`)

**Déclencheur** : changement dans `/stations/{id}`

**Condition** : si stock actuel < seuil d'alerte → alerte **station-bas** (gravité warning)

**Notification Discord** : idem, via webhook si configuré.

### 3. Alerte vente sans stock (`alerteVenteSansStock`)

**Déclencheur** : nouvelle vente créée dans `/ventes/{id}`

**Condition** : si la vente a `stockVerifie === false` (= pas de sortie de stock détectée corrélée) → alerte **vente-sans-stock** (gravité warning)

**Pourquoi c'est important** : ça veut dire qu'un vendeur a fait une facture sans qu'on retrouve la marchandise sortie de l'inventaire. Causes possibles :
- Bug bot Discord (les deux logs n'ont pas été parsés ensemble)
- Vente fictive (test, erreur)
- **Vol** (le vendeur a facturé mais sorti l'item dans son inventaire perso)

→ La direction doit toujours **investiguer** ces alertes.

---

## Webhook Discord pour les alertes

### Comment l'activer
1. Sur le serveur Discord du LTD, crée un canal `#alertes-app`
2. Modifier le canal → Intégrations → **Webhooks** → Nouveau webhook → copie l'URL
3. Site → **Administration → Configuration globale → URL Webhook Discord** → colle l'URL
4. Sauvegarde

### Ce que tu vas recevoir
À chaque nouvelle alerte créée :
- Rupture de stock : « Rupture de stock : Bonbon (qte = 0) »
- Stock bas : « Stock bas : Bouteille d'eau (4/5) »
- Station basse : « Station Aérodrome : 800 L restants (seuil 1000) »
- Vente sans stock : « Vente sans sortie de stock corrélée »
- Masse salariale : « Masse > 85 % du CA »

C'est utile pour ne **pas avoir à checker le site en continu** — tu sais quand quelque chose nécessite ton attention.

---

## Audit trail des prix

Chaque modification de **prix d'achat** ou **prix de vente** d'un produit est automatiquement enregistrée dans la collection `historiquePrix` avec :
- Le produit concerné
- L'ancien prix achat / vente
- Le nouveau prix achat / vente
- Le timestamp

Ça permet de retrouver après coup **qui a changé un prix et quand** (utile en cas de plainte client RP, ou de désaccord).

> Cet audit n'est pas affiché dans l'UI actuellement (pas de page « Historique des prix »). Il est consultable via la console Firebase ou peut être ajouté en feature plus tard.

---

## Le temps réel sur tous les écrans

Toutes les pages utilisent les **listeners Firebase** (`onSnapshot`). Ça veut dire que :
- Pas besoin de **recharger la page** : les données s'actualisent toutes seules
- Marche sur **ordi, téléphone, tablette FiveM in-game**
- Multi-utilisateurs : si le Patron modifie un prix pendant que le Responsable Vente regarde la page Stocks, le Responsable Vente le voit en direct
- Latence ≈ 1-2 secondes maximum

### Listeners actifs sur chaque page
| Page | Données temps réel |
|------|---------------------|
| Dashboard | Stations, stocks, alertes, ventes |
| Stocks | Stocks |
| Stations | Stations |
| Ventes | Ventes de la semaine |
| RH | Utilisateurs, services, paies |
| Admin | Utilisateurs |

---

## Sécurité — Qui peut quoi (rappel)

| Action | Qui peut faire | Qui ne peut PAS |
|--------|----------------|------------------|
| Voir le Dashboard | Patron, Co-Patron, DRH | Tous les autres |
| Modifier les prix produits | Patron, Co-Patron, DRH, Resp Vente | Vendeurs, Pompistes |
| Créer un nouveau produit au catalogue | Patron, Co-Patron, DRH | Resp Vente, Vendeurs, Pompistes |
| Modifier les stations | Patron, Co-Patron, Resp Pompiste | Tous les autres |
| Ajouter une dépense | Patron, Co-Patron | DRH (lecture), tous les autres |
| Décider un salaire | Patron, Co-Patron, DRH | Responsables, employés |
| Créer / supprimer un compte | Patron (tous), Co-Patron (sauf Patron), DRH (sauf direction), Resp Vente (vendeurs), Resp Pompiste (pompistes) | Vendeurs, Pompistes |
| Configuration globale (quotas, webhook) | Patron, Co-Patron uniquement | Tous les autres y compris DRH |

### Hiérarchie de gestion des comptes
| Tu es… | Tu peux gérer (créer/modifier/suspendre/supprimer) |
|--------|---------------------------------------------------|
| Patron | Tous (y compris autres Patron) |
| Co-Patron | Tous sauf Patron |
| DRH | Tous sauf Patron + Co-Patron (peut gérer un autre DRH) |
| Responsable Vente | Vendeurs uniquement (Novice / Inter / Exp) |
| Responsable Pompiste | Pompistes uniquement (Novice / Inter / Exp) |

Ces règles sont appliquées **côté serveur** (rules Firestore) — on ne peut pas les contourner en bidouillant le navigateur. Si quelqu'un essaie d'agir hors de son périmètre, Firestore refuse l'écriture.

---

## Que faire si le système est en panne

### Symptôme : les logs Discord arrivent mais rien n'apparaît sur le site
- Le bot est probablement déconnecté
- Va sur Railway → Project LTD Little Seoul → Deployments → Logs
- Si « Disconnected » → restart du bot
- Si erreur 401 → token a expiré ou Firebase a un souci, contacter la direction technique

### Symptôme : le site est en blanc / écran vide
- Probablement un souci d'hébergement ou Firebase
- Ouvre la console DevTools (F12) et regarde les erreurs rouges
- Contacte la direction technique si ça persiste

### Symptôme : les alertes Discord ne tombent plus
- Vérifie l'URL du webhook (peut être révoquée si le canal a été supprimé)
- Recrée le webhook et remets l'URL dans Admin → Configuration globale

### Symptôme : la clôture du dimanche n'a pas eu lieu
- Très rare (jamais arrivé)
- Vérifier la console Firebase → Functions → `clotureHebdo` → Logs
- Si erreur, relancer manuellement (besoin d'un développeur)

---

## La suite

- **[08-faq-depannage.md](08-faq-depannage.md)** : 20+ questions courantes avec leurs solutions
