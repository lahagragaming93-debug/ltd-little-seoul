// ============================================================
// API Firestore — wrapper léger pour le frontend
// ============================================================

import { db, auth } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, Timestamp, writeBatch,
  serverTimestamp, getAggregateFromServer, sum, count
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { dateKeyLocal } from './utils/formatters.js';

export { Timestamp, serverTimestamp };

// ----- Cloud Functions helper -----
// Centralise l'URL de base + auth Bearer + content-type. Tout appel a une
// Cloud Function passe par ici pour eviter de copier-coller le boilerplate
// (8 sites d'appel avant ce helper).
// En LOCAL (hostname=localhost/127.0.0.1) : pointe sur l'emulator Firebase
// Functions (port 5001) pour tester sans deployer.
export const CF_BASE = (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))
  ? 'http://localhost:5001/ltd-little-seoul-fa/europe-west1'
  : 'https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net';
export async function callFunction(name, body = {}) {
  const idToken = await auth.currentUser.getIdToken();
  const resp = await fetch(`${CF_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify(body)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

// ----- Logs site (audit) — fire-and-forget -----
// Poste un événement vers la Cloud Function logSite, qui le relaie dans le salon
// de logs dédié du serveur BLA. Ne DOIT JAMAIS bloquer ni casser l'action métier
// (erreurs avalées). channel : connexions | comptes-acces | stocks | ventes |
// livraisons | notes-frais | compta | config.
export function logSite(channel, title, fields = []) {
  (async () => {
    try {
      if (!auth.currentUser) return;
      const idToken = await auth.currentUser.getIdToken();
      await fetch(`${CF_BASE}/logSite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ channel, title, fields })
      });
    } catch (e) { /* silencieux */ }
  })();
}

// ----- Utilisateurs -----
const MAX_USERS = 200;
export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
// === Cache mémoire (60s) pour listUsers + listSemaines (perf nav inter-pages) ===
// Re-téléchargées sur CHAQUE page (jusqu'à 200 users) alors qu'elles changent
// rarement → cache court comme getConfig, invalidé sur écriture user. Fallback
// naturel : si pas de cache valide, on refait le getDocs (jamais cassé).
let _usersCache = null, _usersCacheTs = 0;
let _semainesCache = null, _semainesCacheTs = 0;
const LIST_TTL_MS = 60_000;
export function invalidateUsersCache() { _usersCache = null; }
export async function setUserDoc(uid, data) {
  await setDoc(doc(db, 'users', uid), data, { merge: true });
  _usersCache = null;
}
export async function listUsers(force = false) {
  const now = Date.now();
  if (!force && _usersCache && (now - _usersCacheTs) < LIST_TTL_MS) return _usersCache.slice();
  const snap = await getDocs(query(collection(db, 'users'), orderBy('nom'), limit(MAX_USERS)));
  _usersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _usersCacheTs = now;
  return _usersCache.slice();
}
export function listenUsers(cb) {
  return onSnapshot(query(collection(db, 'users'), orderBy('nom'), limit(MAX_USERS)), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function updateUser(uid, patch) {
  await updateDoc(doc(db, 'users', uid), patch);
  _usersCache = null;
}
export async function deleteUser(uid) {
  await deleteDoc(doc(db, 'users', uid));
  _usersCache = null;
}

// ----- Produits & stocks -----
const MAX_PRODUITS = 500;
export async function listProduits() {
  const snap = await getDocs(query(collection(db, 'produits'), orderBy('nom'), limit(MAX_PRODUITS)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function deleteProduit(id) {
  // Supprime juste le doc /produits/{id}. Le stock et les mouvements passés
  // restent en base (audit). Si tu veux nettoyer aussi le stock :
  // await deleteDoc(doc(db, 'stocks', id));
  await deleteDoc(doc(db, 'produits', id));
  logSite('stocks', 'Produit supprimé', [{ name: 'Produit', value: id, inline: true }]);
}
export async function setProduit(id, data) {
  // Audit trail : si prixAchat ou prixVente change, on log dans /historiquePrix
  if (data.prixAchat != null || data.prixVente != null) {
    const before = await getDoc(doc(db, 'produits', id));
    const beforeData = before.exists() ? before.data() : {};
    const ancien = { prixAchat: beforeData.prixAchat ?? null, prixVente: beforeData.prixVente ?? null };
    const nouveau = {
      prixAchat: data.prixAchat ?? beforeData.prixAchat ?? null,
      prixVente: data.prixVente ?? beforeData.prixVente ?? null
    };
    if (ancien.prixAchat !== nouveau.prixAchat || ancien.prixVente !== nouveau.prixVente) {
      await addDoc(collection(db, 'historiquePrix'), {
        produitId: id,
        ancien, nouveau,
        timestamp: serverTimestamp()
      });
    }
  }
  await setDoc(doc(db, 'produits', id), data, { merge: true });
  logSite('stocks', 'Produit enregistré', [
    { name: 'Produit', value: data.nom || id, inline: true },
    { name: 'Prix achat', value: String(data.prixAchat ?? '—'), inline: true },
    { name: 'Prix vente', value: String(data.prixVente ?? '—'), inline: true }
  ]);
}
export async function listStocks() {
  const snap = await getDocs(collection(db, 'stocks'));
  const map = {};
  snap.docs.forEach(d => { map[d.id] = d.data(); });
  return map;
}
export function listenStocks(cb) {
  return onSnapshot(collection(db, 'stocks'), s => {
    const map = {};
    s.docs.forEach(d => { map[d.id] = d.data(); });
    cb(map);
  });
}
export async function ajusterStock(produitId, delta, raison, parUid) {
  const ref = doc(db, 'stocks', produitId);
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data().quantite || 0) : 0;
  const nouveau = current + delta;
  await setDoc(ref, {
    quantite: nouveau,
    derniereMaj: serverTimestamp(),
    par: parUid
  }, { merge: true });
  await addDoc(collection(db, 'mouvementsStock'), {
    type: 'ajustement-manuel',
    item: produitId,
    quantite: delta,
    par: parUid,
    raison: raison || '',
    timestamp: serverTimestamp()
  });
  logSite('stocks', 'Stock ajusté', [
    { name: 'Produit', value: produitId, inline: true },
    { name: 'Variation', value: (delta >= 0 ? '+' : '') + delta, inline: true },
    { name: 'Nouveau total', value: String(nouveau), inline: true },
    { name: 'Motif', value: raison || '—', inline: false }
  ]);
}

// ----- Ventes -----
// Les ventes marquees `cachee: true` (doublons bot remplaces par declaration
// manuelle) sont filtrees ici une fois pour toutes — toutes les pages
// consommatrices (compta, rh, dashboard, employee, ventes) en beneficient.
export async function listVentesSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'ventes'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.cachee);
}
export function listenVentesSemaine(dateDebut, dateFin, cb) {
  const q = query(collection(db, 'ventes'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  return onSnapshot(q, s => cb(
    s.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => !v.cachee)
  ));
}
// Variante : inclut TOUTES les ventes (cachees comprises). Utilise pour la
// page RH (detail employe) ou l'audit : permet de comparer bot vs declaration
// manuelle et identifier les doublons caches.
export async function listVentesSemaineIncluantCachees(dateDebut, dateFin) {
  const q = query(collection(db, 'ventes'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Livraisons (déclarations du livreur — traçabilité, SANS CA) -----
const MAX_LIVRAISONS = 300;
// Le livreur déclare une livraison (correspond à une facture émise en jeu). Ne
// génère AUCUN CA : pur enregistrement de traçabilité pour que le patron sache
// ce qui a été livré et juge le versement du fixe de 5 000 $.
export async function ajouterLivraison(data) {
  const ref = await addDoc(collection(db, 'livraisons'), { ...data, createdAt: serverTimestamp() });
  logSite('livraisons', 'Livraison déclarée', [
    { name: 'Client', value: data.client || '—', inline: true },
    { name: 'Produit', value: data.produit || '—', inline: true },
    { name: 'Quantité', value: String(data.quantite ?? '—'), inline: true },
    { name: 'Montant', value: String(data.montant ?? '—') + ' $', inline: true }
  ]);
  return ref;
}
// Historique complet (direction / DRH / super-admin) — toutes les livraisons.
export function listenLivraisons(cb) {
  const q = query(collection(db, 'livraisons'), orderBy('createdAt', 'desc'), limit(MAX_LIVRAISONS));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
// Vue restreinte : uniquement les livraisons d'un livreur (sa propre vue). Tri
// client (évite un index composite livreurId + createdAt).
export function listenLivraisonsLivreur(livreurId, cb) {
  const q = query(collection(db, 'livraisons'), where('livreurId', '==', livreurId), limit(MAX_LIVRAISONS));
  return onSnapshot(q, s => cb(
    s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
  ));
}
// Suppression (direction uniquement — corriger une déclaration erronée).
export async function supprimerLivraison(id) {
  return deleteDoc(doc(db, 'livraisons', id));
}

// ----- Mouvements de stock -----
export async function listMouvementsRecents(n = 50) {
  const q = query(collection(db, 'mouvementsStock'),
    orderBy('timestamp', 'desc'), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Stations essence -----
export async function listStations() {
  const snap = await getDocs(query(collection(db, 'stations'), orderBy('nom')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export function listenStations(cb) {
  return onSnapshot(query(collection(db, 'stations'), orderBy('nom')), s => {
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function setStation(id, data) {
  await setDoc(doc(db, 'stations', id), data, { merge: true });
}

// ----- Subventions reçues (banque) -----
// Lit /banqueLtd ou categorieEntree='subvention' (marquage manuel par patron via
// scripts/marquer-subvention.js). Recette NON IMPOSABLE (TTE Art. 4-2.16).
export async function listSubventionsSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'banqueLtd'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.categorieEntree === 'subvention');
}

// ----- Redistributions essence -----
export async function listRedistributionsSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'redistributions'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// PERF (2026-06-07) : CA carburant de la semaine en AGRÉGATION SERVEUR (somme
// des montants + nombre de redistributions) SANS rapatrier les docs. La
// collection carburant fait des milliers de docs/semaine (ventes NPC auto)
// alors que compta/dashboard n'en veulent que le total + le compte → on les
// calcule côté Firestore (0 doc transféré au lieu de ~3400). Fallback getDocs
// si l'agrégation échoue (index pas encore construit) → ne casse jamais
// l'affichage, au pire = ancien comportement.
export async function getCarburantStatsSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'redistributions'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)));
  try {
    const snap = await getAggregateFromServer(q, { total: sum('montant'), count: count() });
    return { total: snap.data().total || 0, count: snap.data().count || 0 };
  } catch (e) {
    console.warn('[getCarburantStatsSemaine] agrégation indisponible, fallback getDocs:', e?.message || e);
    const docs = await getDocs(q);
    let total = 0; docs.forEach(d => { total += Number(d.data().montant) || 0; });
    return { total, count: docs.size };
  }
}
// Toutes les redistributions d'un pompiste (cumul depuis embauche). Pas
// d'orderBy serveur (eviterait un index composite), on trie cote client.
// Limite a 1000 docs pour proteger les tablettes contre un historique
// runaway — un pompiste qui depasse 1000 ravitaillements est rarissime.
export async function listAllRedistributionsPompiste(pompisteId) {
  const q = query(collection(db, 'redistributions'),
    where('pompisteId', '==', pompisteId),
    limit(1000));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Toutes les redistributions manuel-pompiste sur une plage temporelle
// (classement semaine / mois cote employee). Filtre source serveur pour
// reduire le payload et eviter les docs 'manuel-correction-pompiste'.
export async function listRedistributionsRangeManuel(dateDebut, dateFin) {
  const q = query(collection(db, 'redistributions'),
    where('source', '==', 'manuel-pompiste'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Toutes les redistributions manuel-pompiste (depuis l'origine). Pour le
// classement 'depuis embauche'. Limite generous (5000 docs ≈ ~2 MB) ;
// si on depasse, basculer en agregation pre-calculee dans /statsRedistributions.
export async function listAllRedistributionsManuel() {
  const q = query(collection(db, 'redistributions'),
    where('source', '==', 'manuel-pompiste'),
    limit(5000));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Services (heures travail) -----
export async function listServicesSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'services'),
    where('debut', '>=', Timestamp.fromDate(dateDebut)),
    where('debut', '<=', Timestamp.fromDate(dateFin)),
    orderBy('debut', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Tous les services d'un employe (sans filtre date) — pour le cumul depuis embauche
// Pas d'orderBy cote serveur (eviterait un index composite employeId+debut),
// on trie cote client.
export async function listAllServicesEmploye(employeId) {
  const q = query(collection(db, 'services'), where('employeId', '==', employeId));
  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.debut?.toMillis?.() || 0) - (a.debut?.toMillis?.() || 0));
  return list;
}

// Service en cours d'un employe (1 seul max, doc /servicesOuverts/{employeId})
export async function getServiceOuvert(employeId) {
  const snap = await getDoc(doc(db, 'servicesOuverts', employeId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ----- Quotas pompistes -----
export async function getQuotaPompiste(employeId, weekId) {
  const snap = await getDoc(doc(db, 'quotasPompiste', `${weekId}_${employeId}`));
  return snap.exists() ? snap.data() : { bidons: 0, caoutchoucs: 0 };
}
export async function listQuotasSemaine(weekId) {
  const snap = await getDocs(query(collection(db, 'quotasPompiste'),
    where('semaine', '==', weekId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Quotas vendeurs (fabrication hebdo) -----
// Doc symetrique a quotasPompiste : /quotasVendeur/{weekId}_{uid}
// Champs : { semaine, employeId, 'bouteille-eau-purifiee',
//            'mastic-carrosserie', visseries } — incrementes par CF.
export async function getQuotaVendeur(employeId, weekId) {
  const snap = await getDoc(doc(db, 'quotasVendeur', `${weekId}_${employeId}`));
  return snap.exists() ? snap.data() : {};
}
export function listenQuotaVendeur(employeId, weekId, cb) {
  return onSnapshot(doc(db, 'quotasVendeur', `${weekId}_${employeId}`), s => {
    cb(s.exists() ? s.data() : {});
  });
}
export async function listQuotasVendeurSemaine(weekId) {
  const snap = await getDocs(query(collection(db, 'quotasVendeur'),
    where('semaine', '==', weekId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Dépenses -----
export async function listDepensesSemaine(dateDebut, dateFin) {
  const q = query(collection(db, 'depenses'),
    where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
    where('timestamp', '<=', Timestamp.fromDate(dateFin)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function ajouterDepense(data) {
  await addDoc(collection(db, 'depenses'), {
    ...data,
    timestamp: serverTimestamp()
  });
  logSite('compta', 'Dépense ajoutée', [
    { name: 'Montant', value: String(data.montant ?? '—'), inline: true },
    { name: 'Type', value: String(data.type || data.categorie || 'a-classifier'), inline: true },
    { name: 'Raison', value: String(data.raison || data.description || '—').slice(0, 300), inline: false }
  ]);
}

// Solde du compte bancaire LTD.
// 2 sources combinées :
//   1. /banqueLtd : transactions xbankaccount (entrées + sorties FiveM)
//   2. /depenses  : sorties via #depenses (peut contenir aussi un soldeApres)
// On retourne la plus récente des 2, car la vérité c'est "le dernier mouvement
// quel qu'il soit". Avec banqueLtd actif, on aura la précision la plus fine.
//
// Params optionnels (dateDebut, dateFin) : si fournis, on recupere le solde
// le plus recent A LA FIN DE LA PERIODE (utile pour la page dashboard quand
// l'utilisateur choisit "Semaine -1" -> on veut le solde au dim 23h59 de N-1,
// pas le solde live d'aujourd'hui). Sans params : solde live actuel.
export async function getDernierSoldeBanque(dateDebut = null, dateFin = null) {
  const borneActive = dateDebut && dateFin;
  // Helper : extrait le doc le plus récent avec soldeApres valide
  async function lireDerniereSource(coll) {
    const q = borneActive
      ? query(collection(db, coll),
          where('timestamp', '>=', Timestamp.fromDate(dateDebut)),
          where('timestamp', '<=', Timestamp.fromDate(dateFin)),
          orderBy('timestamp', 'desc'),
          limit(10))
      : query(collection(db, coll), orderBy('timestamp', 'desc'), limit(10));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data();
      if (data.soldeApres != null && data.soldeApres !== '' && Number.isFinite(Number(data.soldeApres))) {
        return {
          solde: Number(data.soldeApres),
          timestamp: data.timestamp,
          raison: data.raison || '',
          source: coll,
          type: data.type || ''
        };
      }
    }
    return null;
  }

  const [banque, depense] = await Promise.all([
    lireDerniereSource('banqueLtd').catch(() => null),
    lireDerniereSource('depenses').catch(() => null)
  ]);

  // Garder la plus récente des 2
  if (!banque) return depense;
  if (!depense) return banque;
  const tsBanque  = banque.timestamp?.toMillis ? banque.timestamp.toMillis() : 0;
  const tsDepense = depense.timestamp?.toMillis ? depense.timestamp.toMillis() : 0;
  return tsBanque >= tsDepense ? banque : depense;
}

// Historique complet des mouvements bancaires LTD (pour audit IRS)
export async function listMouvementsBanqueRecents(n = 50) {
  const q = query(collection(db, 'banqueLtd'), orderBy('timestamp', 'desc'), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// === Stats hebdo officielles FiveM (depuis #statsbank) ===
// Lit les N dernières semaines pour comparer avec nos /semaines
export async function listStatsHebdoOfficielles(n = 10) {
  const q = query(collection(db, 'statsHebdoOfficiels'),
    orderBy('derniereMaj', 'desc'),
    limit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// === RH événements (embauches/exclusions auto depuis #auto-rh) ===
// Lecture des embauches non encore traitées (compte pas créé)
export async function listEmbauchesEnAttente() {
  const q = query(collection(db, 'rhEvenements'),
    where('type', '==', 'embauche'),
    orderBy('timestamp', 'desc'),
    limit(50));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function marquerEmbaucheTraitee(id) {
  await updateDoc(doc(db, 'rhEvenements', id), {
    traitee: true,
    traiteeAt: serverTimestamp()
  });
}

// Liste tous les noms d'items uniques vus dans /mouvementsStock (outil de découverte
// pour aider au mapping nom FiveM → catalogue commercial). Les noms sont déjà
// agrégés et comptés (combien de fois vu, premier passage, dernier passage).
export async function listItemsFiveMUniques(maxLignes = 2000) {
  const q = query(
    collection(db, 'mouvementsStock'),
    orderBy('timestamp', 'desc'),
    limit(maxLignes)
  );
  const snap = await getDocs(q);
  const map = {}; // nomBrut -> { count, premierVu, dernierVu, slug, exemple }
  for (const d of snap.docs) {
    const data = d.data();
    const nomBrut = data.itemNom || data.item || '';
    if (!nomBrut) continue;
    if (!map[nomBrut]) {
      map[nomBrut] = {
        nomFivem: nomBrut,
        slug: data.item || '',
        count: 0,
        premierVu: data.timestamp,
        dernierVu: data.timestamp,
        exempleSource: data.source || '',
        exempleQuantite: data.quantite || 0
      };
    }
    map[nomBrut].count++;
    // Update bornes (timestamp desc → premier doc = plus récent)
    if (data.timestamp) {
      if (!map[nomBrut].dernierVu || data.timestamp.toMillis?.() > map[nomBrut].dernierVu.toMillis?.()) {
        map[nomBrut].dernierVu = data.timestamp;
      }
      if (!map[nomBrut].premierVu || data.timestamp.toMillis?.() < map[nomBrut].premierVu.toMillis?.()) {
        map[nomBrut].premierVu = data.timestamp;
      }
    }
  }
  // Convertit en array trié par fréquence décroissante
  return Object.values(map).sort((a, b) => b.count - a.count);
}

// ----- Paies -----
// Regle business : la cloture compta est le dimanche 23h59. Les paies pour
// la semaine N sont DELIVRES apres cloture, et le patron a jusqu'au mardi
// (jour suivant le lundi de N+1) a 21h pour les verser et faire la decla IRS.
// Donc fenetre de paie de la semaine N = [lundi N+1 00h00, mardi N+1 21h00].
// listPaiesSemaine retourne les paies dont le TIMESTAMP tombe dans cette
// fenetre de paie associee a la semaine demandee (et non pas dans la
// semaine N elle-meme — sinon les paies seraient affichees a la mauvaise
// semaine puisque elles arrivent forcement APRES cloture).
export async function listPaiesSemaine(dateDebut, dateFin, weekKey = null) {
  // dateDebut = lundi 00h00 de la semaine N, dateFin = dimanche 23h59 de N
  // Fenetre paie : lundi N+1 00h00 (= dateFin + 1s arrondi) -> mardi N+1 21h00
  const debutFenetre = new Date(dateFin.getTime() + 1000);
  debutFenetre.setHours(0, 0, 0, 0);    // lundi N+1 00h00 (au cas ou dateFin n'etait pas pile 23:59:59)
  const finFenetre = new Date(debutFenetre);
  finFenetre.setDate(finFenetre.getDate() + 1);   // mardi N+1
  finFenetre.setHours(21, 0, 0, 0);              // mardi N+1 21h00
  const q = query(collection(db, 'paies'),
    where('timestamp', '>=', Timestamp.fromDate(debutFenetre)),
    where('timestamp', '<=', Timestamp.fromDate(finFenetre)),
    orderBy('timestamp', 'desc'));
  const snap = await getDocs(q);
  // Filtre : si une paie a weekKeyAttribuee defini, elle appartient logiquement
  // a cette semaine-la (taggee a la cloture). Exclu celles attribuees a une
  // AUTRE semaine que celle demandee.
  const wKeyCible = weekKey || dateKeyLocal(dateDebut);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => !p.weekKeyAttribuee || p.weekKeyAttribuee === wKeyCible);
}

// Paies reçues par UN employé (utilisé par /paies.html).
// Defaut n=300 : couvre ~5 ans d'historique pour un employe paye hebdo.
// Si un employe depasse cette limite, le KPI "Total reçu depuis ouverture"
// sera tronque silencieusement — surveiller et migrer en agregation pre-calculee
// (collection /paiesAggregatesByUid) si besoin.
export async function listMesPaies(uid, n = 300) {
  const q = query(collection(db, 'paies'),
    where('beneficiaireId', '==', uid),
    orderBy('timestamp', 'desc'),
    limit(n));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ----- Paies estimees (snapshots a la cloture, Option B 2026-05-18) -----
// Une ligne par employe actif x semaine cloturee. Source de verite pour
// /rh "semaine precedente" + KPI "Reste a verser".
export async function listPaiesEstimeesSemaine(weekKey) {
  const q = query(collection(db, 'paiesEstimees'),
    where('weekKey', '==', weekKey));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Pose le flag paye:true (avec datePaiement serveur) + lie eventuellement une
// paie /paies pour audit (montant reel verse). Cote backend, c'est la
// Cloud Function marquerPaieVersee qui ecrit (Admin SDK) — les rules
// Firestore interdisent l'ecriture cote client.
export async function marquerPaieVersee({ snapshotId, paye, paieMatcheeId = null }) {
  const { auth } = await import('./firebase-config.js');
  const idToken = await auth.currentUser.getIdToken();
  const resp = await fetch('https://europe-west1-ltd-little-seoul-fa.cloudfunctions.net/marquerPaieVersee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify({ snapshotId, paye, paieMatcheeId })
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

// ----- Semaines (clôturées) -----
// n = 20 par defaut : couvre ~5 mois d'historique, suffisant pour le selecteur
// semaine sur /ventes, /employee et period-filter. Les appelants peuvent forcer moins.
export async function listSemaines(n = 20) {
  const now = Date.now();
  if (_semainesCache && (now - _semainesCacheTs) < LIST_TTL_MS) return _semainesCache.slice(0, n);
  const snap = await getDocs(query(collection(db, 'semaines'),
    orderBy('dateDebut', 'desc'), limit(Math.max(n, 20))));
  _semainesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _semainesCacheTs = now;
  return _semainesCache.slice(0, n);
}
export async function getSemaineCourante(weekId) {
  const snap = await getDoc(doc(db, 'semaines', weekId));
  return snap.exists() ? snap.data() : null;
}

// ----- Alertes -----
// Une alerte a 2 etats independants : `resolue` (probleme traite, l'item est
// reapprovisionne ou la vente verifiee) et `lu` (le patron a vu, on cache du
// badge mais on garde dans le dropdown grise). Le badge ne compte que les
// non-lues ET non-resolues.
export function listenAlertesActives(cb) {
  const q = query(collection(db, 'alertes'),
    where('resolue', '==', false), orderBy('timestamp', 'desc'));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function resoudreAlerte(id) {
  await updateDoc(doc(db, 'alertes', id), { resolue: true, resolueAt: serverTimestamp() });
}
export async function marquerAlerteLue(id) {
  await updateDoc(doc(db, 'alertes', id), { lu: true, luAt: serverTimestamp() });
}
export async function marquerToutesAlertesLues() {
  const snap = await getDocs(query(collection(db, 'alertes'),
    where('resolue', '==', false)));
  const batch = writeBatch(db);
  for (const d of snap.docs) {
    if (d.data().lu) continue;
    batch.update(d.ref, { lu: true, luAt: serverTimestamp() });
  }
  await batch.commit();
}

// ----- Configuration -----
// === Cache memoire 30s pour getConfig() (v1.11.1 perf CEF) ===
// Plusieurs pages appellent getConfig() 2-3 fois au chargement (KPI + render
// + sub-components). Sur tablette CEF avec reseau RP-limit, chaque getDoc
// fait ~80-150 ms. On cache 30s + on invalide via listenConfig (set ci-dessous
// a chaque snapshot live). Resultat : 1 seul aller-retour reseau par page,
// les appels suivants servent le cache memoire.
let _configCache = null;
let _configCacheTs = 0;
const CONFIG_TTL_MS = 30_000;
export async function getConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTs) < CONFIG_TTL_MS) {
    return _configCache;
  }
  const snap = await getDoc(doc(db, 'config', 'global'));
  _configCache = snap.exists() ? snap.data() : {
    quotaBidons: 1700,
    quotaCaoutchoucs: 800,
    prixEssence: 5,
    seuilAlerteEssence: 1000
  };
  _configCacheTs = now;
  return _configCache;
}
export async function setConfig(patch) {
  await setDoc(doc(db, 'config', 'global'), patch, { merge: true });
  _configCache = null; // invalidate apres ecriture
  _configCacheTs = 0;
  logSite('config', 'Configuration modifiée', Object.keys(patch || {}).slice(0, 12).map(k => ({
    name: k, value: (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : String(patch[k])).slice(0, 200), inline: true
  })));
}
// Listener temps reel sur /config/global. Indispensable pour les tablettes
// in-game (FiveM) qui n'ont pas de F5 : quand la direction modifie les
// quotas, les pages employe ouvertes doivent voir le changement live.
// Renvoie une fonction unsubscribe.
export function listenConfig(cb) {
  return onSnapshot(doc(db, 'config', 'global'), s => {
    const data = s.exists() ? s.data() : {};
    // Synchroniser le cache memoire avec le snapshot live (perf CEF).
    _configCache = data;
    _configCacheTs = Date.now();
    cb(data);
  });
}

// ----- Notes de frais (pompiste avance des frais d'essence vehicule LTD) -----
// Listener temps-reel : MES notes (filtre client par employeId).
// Limite 200 : au-dela, le KPI "Total notes" cote /notes-frais affiche
// "200+" pour indiquer la troncature.
export function listenMesNotesFrais(employeId, cb) {
  const q = query(collection(db, 'notesFrais'),
    where('employeId', '==', employeId),
    orderBy('timestamp', 'desc'),
    limit(200));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
// Listener direction/DRH/resp-pompiste : 200 dernieres notes de frais.
// NB : chaque doc embarque un screenshot base64 jusqu'a ~950 KB. A 200 docs
// on charge potentiellement ~190 MB en RAM cote tablette FiveM — limite
// haute. Si besoin d'historique plus large, migrer les screenshots vers
// Firebase Storage et stocker uniquement l'URL dans le doc.
export function listenAllNotesFrais(cb) {
  const q = query(collection(db, 'notesFrais'),
    orderBy('timestamp', 'desc'),
    limit(200));
  return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ----- Secrets (tokens, accessibles direction uniquement via rules) -----
export async function getSecrets() {
  const snap = await getDoc(doc(db, 'config', 'secrets'));
  return snap.exists() ? snap.data() : {};
}
export async function setSecrets(patch) {
  await setDoc(doc(db, 'config', 'secrets'), patch, { merge: true });
}

// ----- Avertissements -----
// 3 avertissements actifs = compte bloque (lecture OK, ecritures interdites).
// actif=false quand le patron en retire un (jamais delete : on garde l'audit).
export async function listAvertissements(employeId) {
  const snap = await getDocs(query(
    collection(db, 'avertissements'),
    where('employeId', '==', employeId),
    orderBy('dateCreation', 'desc'),
    limit(50)
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export function listenAvertissements(employeId, cb) {
  return onSnapshot(query(
    collection(db, 'avertissements'),
    where('employeId', '==', employeId),
    orderBy('dateCreation', 'desc'),
    limit(50)
  ), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
// Listener global : tous les avertissements actifs, pour le badge admin
// (compteur par employe).
export function listenAvertissementsActifs(cb) {
  return onSnapshot(query(
    collection(db, 'avertissements'),
    where('actif', '==', true),
    limit(500)
  ), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export async function creerAvertissement({ employeId, employeNom, motif, parQui, parQuiNom, auto = false }) {
  await addDoc(collection(db, 'avertissements'), {
    employeId, employeNom: employeNom || '',
    motif: motif || '',
    parQui, parQuiNom: parQuiNom || '',
    auto: !!auto,
    actif: true,
    dateCreation: serverTimestamp()
  });
}
export async function retirerAvertissement(id, parQui, parQuiNom) {
  await updateDoc(doc(db, 'avertissements', id), {
    actif: false,
    dateRetrait: serverTimestamp(),
    parQuiRetrait: parQui,
    parQuiRetraitNom: parQuiNom || ''
  });
}

// ----- Helpers d'écriture brute -----
export {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, writeBatch
};
