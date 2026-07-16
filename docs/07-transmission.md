# 7 — Procédure de transmission au vrai patron

> **Contexte** : la plateforme a été initialement mise en place par un intendant
> technique (compte `lahagragaming93@gmail.com`, joueur RP `boulalahagra`) pour
> le compte du vrai patron du LTD (`maximegreaume@gmail.com`). Une fois la
> plateforme stabilisée et le vrai patron à l'aise, l'intendant transfère tous
> les accès techniques puis se retire.
>
> Ce document décrit la passation **complète** étape par étape.

---

## ⚠️ Règle d'or — l'ordre compte

**Toujours donner les nouveaux accès AVANT de retirer les anciens.**

Si l'intendant supprime son compte Firebase ou retire ses droits avant que le
vrai patron ait été ajouté comme propriétaire, le projet peut devenir
inaccessible (« orphelin ») et seul le support Google peut le récupérer.

Ordre recommandé :

```
  1. Firebase     ← d'abord (le plus sensible, impossible à récupérer si raté)
  2. GitHub       ← ensuite (le code reste public donc moins critique)
  3. Railway      ← ensuite (le bot peut être recréé si besoin)
  4. Discord Bot  ← ensuite (l'app peut être recréée à zéro)
  5. Compte applicatif (site)  ← seulement à la fin
```

---

## 1. Firebase — transfert de propriété

### 1.1 Ajouter le vrai patron comme propriétaire

1. Aller sur [Console Firebase](https://console.firebase.google.com/project/ltd-little-seoul-fa/settings/iam)
2. Onglet **« Users and permissions »** (Paramètres → Utilisateurs et autorisations)
3. **« Add member »**
4. Email : `maximegreaume@gmail.com`
5. Rôle : **« Owner »** (Propriétaire)
6. **Send invitation**

→ Le vrai patron reçoit un email d'invitation Google. Il accepte, et il a alors
les **mêmes droits que l'intendant** sur Firebase.

### 1.2 Faire vérifier au vrai patron qu'il a accès

Le vrai patron doit confirmer qu'il peut :
- Ouvrir la console Firebase et voir le projet
- Aller dans Firestore Database et voir les collections
- Aller dans Functions et voir les 5 fonctions déployées
- Aller dans Authentication et voir les comptes
- Aller dans Usage and billing et voir le budget

### 1.3 (Optionnel mais recommandé) Le vrai patron installe la CLI

Sur sa machine, il fait :
```bash
npm install -g firebase-tools
firebase login         # avec son compte maximegreaume@gmail.com
cd <repo>/firebase
firebase use --add ltd-little-seoul-fa --alias default
```

Pour vérifier qu'il peut déployer :
```bash
firebase deploy --only firestore:rules --dry-run
```

(Le `--dry-run` valide les règles sans les déployer.)

### 1.4 Retirer l'intendant (à faire À LA FIN, pas tout de suite)

Quand tout le reste est transféré et que la plateforme tourne depuis quelques
jours sans souci, le vrai patron retourne sur Users and permissions et
**retire** `lahagragaming93@gmail.com`.

### 1.5 Compte de facturation Google Cloud

Le **plan Blaze** est lié à un compte de facturation Google Cloud (carte
bancaire de l'intendant). Deux options :

**Option A** — Le vrai patron crée son propre compte de facturation et le
LTD bascule dessus :
1. Le vrai patron va sur https://console.cloud.google.com/billing
2. Crée un nouveau compte de facturation avec sa CB
3. Sur le projet Firebase → Usage and billing → **« Modify plan »** → choisir
   son nouveau compte de facturation
4. L'intendant peut alors fermer son compte de facturation

**Option B** — Garder le compte de facturation de l'intendant (acceptable si
l'intendant accepte). Dans ce cas, l'intendant garde un accès Billing seul
(pas Owner) — Console Cloud → IAM → ajouter `lahagragaming93@gmail.com` avec
rôle `Billing Account Administrator` uniquement.

---

## 2. GitHub — transfert du dépôt

Le dépôt est `lahagragaming93-debug/ltd-little-seoul` (public).

### 2.1 Option A — Transfert de propriété (recommandé)

1. Aller sur [Settings du dépôt](https://github.com/lahagragaming93-debug/ltd-little-seoul/settings)
2. Tout en bas → section **« Danger Zone »** → **« Transfer ownership »**
3. Saisir le nom d'utilisateur GitHub du vrai patron (à demander)
4. Confirmer

→ L'URL du dépôt change : `https://github.com/<vrai-patron>/ltd-sandy-shores`.

**⚠️ Conséquence côté Firebase Auth** : le domaine GitHub Pages change.
Nouveau domaine : `<vrai-patron>.github.io`. Il faut donc :
1. Console Firebase → Authentication → Settings → Authorized domains
2. **Ajouter** `<vrai-patron>.github.io`
3. (Optionnel) **Retirer** `lahagragaming93-debug.github.io` une fois la
   bascule confirmée.

### 2.2 Option B — Ajouter comme collaborateur (plus simple si transfert pas voulu)

1. [Settings → Collaborators](https://github.com/lahagragaming93-debug/ltd-little-seoul/settings/access)
2. **« Add people »** → nom d'utilisateur GitHub du vrai patron
3. Rôle : **Admin**
4. Le vrai patron accepte l'invitation

Dans ce cas, le dépôt reste sous le compte de l'intendant. Le vrai patron a
les pleins pouvoirs en lecture/écriture mais pas la propriété finale (ne peut
pas le supprimer).

### 2.3 Mise à jour de Railway après transfert

Si transfert effectué (option A), Railway perd l'accès au repo. Le vrai
patron doit :
1. Se connecter à Railway avec son GitHub
2. Reconnecter l'intégration GitHub (autoriser Railway sur le nouveau owner)
3. Le service continue de tourner sans interruption (le code est cloné, pas
   « live linké »)

---

## 3. Railway — transfert du projet bot

### 3.1 Option A — Transfert du projet (gratuit)

1. Sur Railway, ouvrir le projet du bot
2. **Settings → Transfer Project** (en bas)
3. Saisir le username/email Railway du vrai patron
4. Confirmer

Le vrai patron reçoit la notification et accepte. Le projet bascule sous
son compte, l'intendant n'y a plus accès.

⚠️ Les **variables d'environnement** (DISCORD_TOKEN, INGEST_TOKEN, etc.)
sont **conservées** lors du transfert. Pas besoin de les ressaisir.

### 3.2 Option B — Recréer chez le vrai patron

Si le transfert pose problème :
1. Le vrai patron se connecte à Railway avec son GitHub
2. New Project → Deploy from GitHub repo → `ltd-sandy-shores`
3. Root directory : `discord-bot`
4. Variables : copier le contenu du `.env` local (ou récupérer depuis Railway
   actuel via Settings → Variables → Raw Editor → Copy)
5. Deploy
6. Vérifier dans les logs que le bot se connecte (`✅ Bot connecté`)
7. **Avant de couper l'ancien Railway**, vérifier que le nouveau pousse bien
   vers Firestore (poster un test message dans #logs-ig, vérifier la collection
   `mouvementsStock`)
8. Une fois validé, **arrêter** l'ancien projet Railway de l'intendant

---

## 4. Bot Discord — transfert de l'application

### 4.1 Option A — Transfert de propriété

1. Aller sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Ouvrir l'application **« LTD Little Seoul Bot »**
3. **« General Information » → « Transfer App »** (en bas)
4. Saisir l'username Discord ou l'ID du vrai patron
5. Confirmer

⚠️ **Le token Discord ne change pas** lors du transfert. Si vous voulez le
réinitialiser pour des raisons de sécurité (intendant qui se retire) :
1. Vrai patron se connecte au Developer Portal
2. Application → Bot → **Reset Token**
3. Met à jour `DISCORD_TOKEN` dans Railway → variables → redéploie

### 4.2 Option B — Recréer le bot à zéro

Si le transfert ne se fait pas proprement (Discord est parfois capricieux) :
1. Le vrai patron crée un nouveau bot Discord (Developer Portal → New Application → Bot → Reset Token), l'invite sur le serveur LTD Little Seoul avec scope `bot` + permissions `Read Messages/View Channels` + `Read Message History`
2. Crée un nouveau bot, récupère un nouveau token, l'invite sur le serveur
   LTD SandyShores avec les mêmes permissions
3. Met à jour `DISCORD_TOKEN` dans Railway
4. **Avant** de désactiver l'ancien bot, vérifier que le nouveau remonte les
   logs (cf. logs Railway)
5. Une fois validé, supprimer l'ancienne application Discord depuis le
   Developer Portal de l'intendant

---

## 5. Suppression du compte applicatif de l'intendant

C'est la **dernière étape**, après que tout le reste a été transféré et
fonctionne depuis quelques jours.

### 5.1 Le vrai patron supprime le compte côté site

1. Se connecter sur l'app : https://[domaine].github.io/ltd-sandy-shores/
2. Aller dans **Administration**
3. Trouver la ligne `boulalahagra` (lahagragaming93@gmail.com)
4. Cliquer le bouton rouge **« × »**
5. Confirmer

→ Le profil Firestore est supprimé, l'utilisateur ne peut plus se connecter.

### 5.2 Supprimer aussi côté Firebase Auth

Le bouton « × » de l'admin supprime le profil Firestore mais **pas** le
compte Firebase Auth lui-même. Pour finaliser :

1. [Console Firebase → Authentication → Users](https://console.firebase.google.com/project/ltd-little-seoul-fa/authentication/users)
2. Trouver `lahagragaming93@gmail.com`
3. Trois points sur la ligne → **Delete account**

### 5.3 Vérification finale

Le vrai patron tente de se connecter avec `lahagragaming93@gmail.com` →
doit échouer avec « Email ou mot de passe incorrect » (ou « Account disabled »).

→ Transmission complète terminée.

---

## Checklist récapitulative

À cocher au fur et à mesure :

- [ ] Vrai patron ajouté comme **Owner** sur Firebase
- [ ] Vrai patron a vérifié son accès console Firebase + déploie en `--dry-run`
- [ ] (Optionnel) Compte de facturation Google Cloud transféré au vrai patron
- [ ] Dépôt GitHub transféré OU vrai patron ajouté comme Admin
- [ ] Domaine GitHub Pages mis à jour dans Firebase Auth → Authorized domains
- [ ] Projet Railway transféré OU recréé par le vrai patron
- [ ] Bot Discord transféré OU recréé par le vrai patron
- [ ] (Recommandé) Token Discord réinitialisé après transfert
- [ ] (Recommandé) Secret `LTD_BOT_INGEST_TOKEN` Firebase régénéré et redéployé
- [ ] **Quelques jours d'observation : tout fonctionne sans intervention**
- [ ] Compte applicatif intendant supprimé via Admin
- [ ] Compte Firebase Auth intendant supprimé
- [ ] Intendant retiré de Firebase IAM (Owner → retiré)

---

## En cas de problème

| Symptôme                                            | Cause probable / Solution |
|-----------------------------------------------------|---------------------------|
| Le vrai patron ne reçoit pas l'invitation Firebase | Vérifier les spams, l'email exact, retenter l'add member |
| Bot Railway ne tourne plus après transfert         | Variables d'env disparues → les recopier depuis backup local du `.env` |
| Le site renvoie `auth/unauthorized-domain`         | Nouveau domaine GitHub Pages pas encore ajouté dans Firebase Auth |
| Erreur 401 sur botIngest après reset token Firebase | Oublié de redéployer la fonction → `firebase deploy --only functions:botIngest --force` |
| Compte intendant impossible à supprimer            | Le bouton × est désactivé pour le compte du user connecté → c'est le vrai patron qui doit le faire, pas l'intendant lui-même |

---

## Backup recommandé avant transmission

L'intendant peut, par sécurité, faire une copie locale de :
- Le `.env` du bot (avec tous les tokens à jour)
- Un export Firestore : `firebase firestore:export gs://[bucket]/backup-YYYYMMDD`
  (nécessite un bucket Cloud Storage activé)
- Un export Auth : `firebase auth:export auth-backup.json`

Ces backups peuvent être transmis au vrai patron en parallèle pour qu'il
ait un filet de sécurité.

---

> **Document maintenu par** : Claude Code (intendant technique)
> **Dernière révision** : 2026-05-09
