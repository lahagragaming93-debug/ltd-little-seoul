// ============================================================
// Authentification — gestion session, rôles, redirections
// ============================================================

import { auth } from './firebase-config.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { getUserDoc, setUserDoc, listUsers, logSite } from './api.js';
import { canAccess, defaultLandingPage, ROLES } from './utils/permissions.js';
import { infoModal } from './utils/confirmation.js';
import { normalizePrenom, normalizeNom, dateKeyLocal } from './utils/formatters.js';

let currentUser = null;
let currentProfile = null;

// === Mode "Voir le site comme..." (admin only) ===
// Stocke un role simule dans localStorage. Si actif + l'utilisateur est admin
// reel, requireAuth surcharge profile.role par cette valeur (UI uniquement).
// Cote serveur, les rules Firestore voient toujours le vrai role -> l'admin
// garde TOUS ses droits en ecriture, c'est juste l'affichage qui change.
const VIEW_AS_KEY = 'ltd_viewAsRole';
const ADMIN_ROLES_REELS = ['patron', 'co-patron', 'admin-technique'];
export function getViewAsRole() {
  try { return localStorage.getItem(VIEW_AS_KEY) || ''; } catch { return ''; }
}
export function setViewAsRole(role) {
  try {
    if (role) localStorage.setItem(VIEW_AS_KEY, role);
    else localStorage.removeItem(VIEW_AS_KEY);
  } catch {}
}
export function clearViewAsRole() { setViewAsRole(''); }

// === Inscription publique — DÉSACTIVÉE ===
// L'inscription publique a été utilisée une seule fois pour bootstrapper le
// premier patron. Depuis, tous les comptes (Co-Patron, DRH, employés) sont
// créés exclusivement par un Patron via le module Administration.
// Les rules Firestore renforcent cette restriction côté serveur (un
// utilisateur authentifié ne peut pas s'auto-créer un profil avec rôle
// patron ou co-patron).

export async function inscrireDirection(/* email, password, prenom, nom, role */) {
  throw new Error('Inscription publique fermée. Demande à un patron de créer ton compte depuis Administration.');
}

// === Création par admin (patron crée des comptes employés) ===
// IMPORTANT : createUserWithEmailAndPassword connecte automatiquement le nouvel
// utilisateur. Pour éviter de déconnecter le patron, on utilise une instance
// Firebase secondaire le temps de la création.

import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth as getAuth2 } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// Domaine interne fictif : Firebase Auth a besoin d'un email mais l'employe
// ne le voit jamais. Username "blake" devient "blake@ltd-little-seoul.local"
// cote Firebase Auth, le user voit / saisit juste "blake".
const INTERNAL_DOMAIN = 'ltd-little-seoul.local';

// Convertit un identifiant saisi par le user en email Firebase Auth.
// - Si contient "@" → utilise tel quel (backward compat anciens comptes mail)
// - Sinon → "{username}@ltd-little-seoul.local"
export function identifiantToEmail(identifiant) {
  const v = (identifiant || '').trim();
  if (!v) return '';
  return v.includes('@') ? v : `${v.toLowerCase()}@${INTERNAL_DOMAIN}`;
}

export async function creerCompteEmploye({ username, prenom, nom, idDiscord, idPerso, role, motDePasse, creePar }) {
  if (!username) throw new Error("Username obligatoire.");
  const cleanUsername = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
    throw new Error("Username : 3-30 caracteres, lettres/chiffres/. _ - uniquement.");
  }
  const email = `${cleanUsername}@${INTERNAL_DOMAIN}`;

  const tmpApp = initializeApp(firebaseConfig, 'tmp-auth-' + Date.now());
  const tmpAuth = getAuth2(tmpApp);
  try {
    const cred = await createUserWithEmailAndPassword(tmpAuth, email, motDePasse);
    // Normalisation silencieuse : evite que la detection bot/site echoue sur
    // une casse non canonique (ex: "ilyes" -> matching case-insensitive
    // necessaire avant le 2026-05-11).
    await setUserDoc(cred.user.uid, {
      username: cleanUsername,
      email,                                 // interne, jamais affiche
      prenom: normalizePrenom(prenom),
      nom: normalizeNom(nom),
      idDiscord: (idDiscord || '').trim(),
      idPerso: (idPerso || '').trim(),
      role,
      statut: 'actif',
      dateEntree: dateKeyLocal(new Date()),
      creePar: creePar || '',
      motDePasseProvisoire: true
    });
    await signOut(tmpAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(tmpApp);
  }
}

// === Connexion ===
// Accepte un username (ex: "blake") OU un email (ex: "blake@gmail.com" pour
// les anciens comptes). Firebase Auth ne voit que l'email construit.
export async function connecter(identifiant, password) {
  const email = identifiantToEmail(identifiant);
  if (!email) throw new Error("Identifiant requis.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  logSite('connexions', 'Connexion réussie', [{ name: 'Identifiant', value: identifiant, inline: true }]);
  return cred.user;
}

export async function deconnecter() {
  await signOut(auth);
  window.location.href = 'index.html';
}

export async function envoyerResetMotDePasse(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function changerMotDePasse(nouveauMdp) {
  if (!auth.currentUser) throw new Error('Pas connecté.');
  await updatePassword(auth.currentUser, nouveauMdp);
  await setUserDoc(auth.currentUser.uid, { motDePasseProvisoire: false });
}

// === Mot de passe provisoire généré ===
export function genererMotDePasseProvisoire(length = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ!@#';
  let p = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) p += chars[arr[i] % chars.length];
  return p;
}

// === Voile de chargement (anti écran-noir au démarrage) ===
// Affiché IMMÉDIATEMENT par requireAuth, avant la résolution de l'auth + le 1er
// fetch. renderShell() remplace document.body.innerHTML → le voile disparaît
// tout seul au rendu de la page. N'altère PAS la logique d'auth. Garde-fou :
// auto-retrait après 8 s pour qu'il ne puisse jamais rester bloqué.
function showBootLoader() {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('boot-loader')) return;
  const el = document.createElement('div');
  el.id = 'boot-loader';
  el.setAttribute('style', 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0a0a0a;color:#c9a961;font-family:system-ui,sans-serif;');
  el.innerHTML = '<div style="width:34px;height:34px;border:3px solid rgba(201,169,97,0.25);border-top-color:#c9a961;border-radius:50%;animation:bl-spin .8s linear infinite;"></div><div style="font-size:0.9rem;letter-spacing:0.04em;">LTD Little Seoul — chargement…</div><style>@keyframes bl-spin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(el);
  setTimeout(() => { const l = document.getElementById('boot-loader'); if (l) l.remove(); }, 8000);
}

// === Garde de page : redirige si non autorisé ===
export function requireAuth(pageKey) {
  showBootLoader();
  return new Promise(resolve => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = 'index.html';
        return;
      }
      const profile = await getUserDoc(user.uid);
      if (!profile) {
        window.location.href = 'index.html';
        return;
      }
      if (profile.statut === 'suspendu') {
        await signOut(auth);
        await infoModal({
          titre: 'Compte suspendu',
          message: 'Votre compte a été suspendu. Contactez la direction du LTD pour plus d\'informations.',
          type: 'danger'
        });
        window.location.href = 'index.html';
        return;
      }
      // Calcule le flag bloque (3 avertissements actifs). Direction exemptee.
      const isDir = profile.role === 'patron' || profile.role === 'co-patron'
        || profile.role === 'admin-technique';
      profile.bloque = !isDir && (profile.avertsActifs || 0) >= 3;

      // === Mode "Voir comme..." ===
      // Si le vrai role est admin ET viewAsRole valide -> on stocke le vrai role
      // dans profile.roleReel et on surcharge profile.role pour l'UI.
      // Cote Firestore, l'ecriture utilise toujours request.auth.uid -> les
      // rules voient l'utilisateur Firebase (admin), donc droits intacts.
      profile.roleReel = profile.role;
      profile.viewingAs = null;
      const viewAs = getViewAsRole();
      const rolesValides = Object.values(ROLES);
      if (viewAs && ADMIN_ROLES_REELS.includes(profile.role) && rolesValides.includes(viewAs)) {
        profile.viewingAs = viewAs;
        profile.role = viewAs;
        // Re-eval bloque selon le role simule
        const isDirSimule = ADMIN_ROLES_REELS.includes(viewAs);
        profile.bloque = !isDirSimule && (profile.avertsActifs || 0) >= 3;
      }

      currentUser = user;
      currentProfile = profile;

      if (pageKey && !canAccess(profile.role, pageKey, profile.accesSupp)) {
        await infoModal({
          titre: 'Accès refusé',
          message: 'Ton rôle ne te permet pas d\'accéder à ce module.\nTu vas être redirigé vers ta page d\'accueil.',
          type: 'warn'
        });
        window.location.href = defaultLandingPage(profile.role);
        return;
      }

      resolve({ user, profile });
    });
  });
}

export function getCurrentUser()    { return currentUser; }
export function getCurrentProfile() { return currentProfile; }
