// ============================================================
// Parser : #autorankup (changement de rôle d'un employé)
// Format observé :
//   "Hailey Williams (pepito_ash) | Vendeur Intermédiaire → Pompiste Expérimenté → Vendeur Expérimenté → Responsable Vente | Par: Blake (Patron)"
// On capte uniquement le rôle FINAL (le dernier de la chaîne).
// ============================================================

import { firstEmbed } from './_helpers.js';

// Mapping des libellés FR observés → rôles internes du système
const ROLE_MAP = {
  'patron':                    'patron',
  'co-patron':                 'co-patron',
  'co patron':                 'co-patron',
  'drh':                       'drh',
  'responsable vente':         'responsable-vente',
  'responsable pompiste':      'responsable-pompiste',
  'vendeur novice':            'vendeur-novice',
  'vendeur intermediaire':     'vendeur-intermediaire',
  'vendeur intermédiaire':     'vendeur-intermediaire',
  'vendeur experimente':       'vendeur-experimente',
  'vendeur expérimenté':       'vendeur-experimente',
  'pompiste novice':           'pompiste-novice',
  'pompiste intermediaire':    'pompiste-intermediaire',
  'pompiste intermédiaire':    'pompiste-intermediaire',
  'pompiste experimente':      'pompiste-experimente',
  'pompiste expérimenté':      'pompiste-experimente'
};

function normaliseRole(libelle) {
  const k = String(libelle || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return ROLE_MAP[k] || null;
}

export function parseAutorankupEmbed(msg) {
  const e = firstEmbed(msg);
  let texte;
  if (e) {
    texte = `${e.title || ''} ${e.description || ''}`;
    (e.fields || []).forEach(f => texte += ` ${f.name}: ${f.value}`);
  } else {
    texte = msg.content || '';
  }
  if (!texte || texte.trim() === '') return null;

  // Cherche une chaîne de rôles séparée par → (peut avoir 2+ rôles)
  // On récupère le dernier rôle après le dernier →
  const matchChaine = texte.match(/([^|]+?(?:\s*→\s*[^|]+)+)/);
  if (!matchChaine) return null;

  const chaine = matchChaine[1];
  const rolesBruts = chaine.split('→').map(s => s.trim());
  if (rolesBruts.length < 2) return null;

  const ancienRole  = normaliseRole(rolesBruts[0]);
  const nouveauRole = normaliseRole(rolesBruts[rolesBruts.length - 1]);
  if (!nouveauRole) return null;

  // Nom au début (avant le premier "|" ou le premier "→")
  // Format observé : "Prénom NOM (pseudo) | Vendeur ... → Resp"
  const matchNom = texte.match(/^[^|]*?([\p{L}][\p{L}\s'-]+?\s+[\p{L}][\p{L}'-]+)\s*(?:\(|\|)/u);
  const fullName = matchNom ? matchNom[1].trim() : '';
  const parts = fullName.split(/\s+/);
  const prenom = parts[0] || '';
  const nom = parts.slice(1).join(' ').toUpperCase() || '';

  // ID Discord si présent (15-21 chiffres)
  const idDiscord = (texte.match(/discord\s*:?\s*(\d{15,21})/i) || [])[1] || '';

  // ID Perso : format "(pseudo, ID:90262)" capté directement après le nom
  const idPerso = (texte.match(/\(\s*[^,)]+\s*,\s*ID\s*:\s*(\d+)\s*\)/i) || [])[1] || '';

  // Par qui (Patron qui a fait la promotion)
  const matchPar = texte.match(/par\s*:?\s*([\p{L}\s]+?)(?:\s*\(|\s*\||$)/iu);
  const parQui = matchPar ? matchPar[1].trim() : '';

  return {
    prenom, nom, idDiscord, idPerso,
    ancienRole, nouveauRole,
    parQui
  };
}
