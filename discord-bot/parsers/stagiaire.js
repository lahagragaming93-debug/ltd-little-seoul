// ============================================================
// Parser : stagiaire (Jéssica) — nouvel employé détaillé
// ============================================================
// Format observé :
//   Title       : ***__NOUVEL EMPLOYÉ__*** (parfois STAGIAIRE / EMBAUCHE)
//   Description :
//     👤 • **Employé**: barbaez (<@857198359911989259>)
//     🆔 • **ID Personnage**: `94762`
//     📝 • **Nom**: `Broas`
//     📝 • **Prénom**: `Nesquik`
//     📞 • **N° Portable**: `Non renseigné`
//     💳 • **IBAN**: `Non renseigné`
//     🔒 • **Casier**: `Non attribué`
//     📅 • **Date d'embauche**: 07/05/2026 10:12:30
//     👔 • **Recruteur**: ... (champ tronqué dans l'aperçu)
//
// Bien plus détaillé que #auto-rh : ce parser sert à enrichir /users
// (téléphone, IBAN, casier) en plus de logger un événement RH.
// ============================================================

import { firstEmbed } from './_helpers.js';

function cleanDescription(s) {
  return String(s || '').replace(/\*\*/g, '').replace(/`/g, '');
}

function extract(desc, label) {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i');
  const m = desc.match(re);
  return m ? m[1].trim() : '';
}

function extractDiscordId(s) {
  return ((s || '').match(/<@!?(\d+)>/) || [])[1] || '';
}

// "Non renseigné" / "Non attribué" => null (pas une vraie valeur)
function nullIfPlaceholder(s) {
  if (!s) return null;
  const v = String(s).trim();
  if (/^(non\s+renseign|non\s+attribu|aucun|n\/?a|—|-)/i.test(v)) return null;
  return v;
}

function parseDateFr(s) {
  // Format observé : "07/05/2026 10:12:30"
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '0', mn = '0', sc = '0'] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mn), Number(sc));
  return isNaN(dt.getTime()) ? null : dt;
}

export function parseStagiaireEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const titleClean = String(e.title || '').replace(/[*_`]/g, '').toUpperCase();
  // Match large : NOUVEL EMPLOYÉ / EMBAUCHE / STAGIAIRE / RECRUTEMENT
  if (!titleClean.includes('NOUVEL EMPLOY') &&
      !titleClean.includes('EMBAUCHE') &&
      !titleClean.includes('STAGIAIRE') &&
      !titleClean.includes('RECRUTEMENT')) return null;

  const desc = cleanDescription(e.description);
  const employeRaw   = extract(desc, 'Employé');
  const employeDiscord = extractDiscordId(employeRaw);
  // "barbaez (<@857198359911989259>)" => username = "barbaez"
  const employeUsername = (employeRaw.replace(/<@!?\d+>/g, '').replace(/[()]/g, '').trim()) || '';
  const idPerso     = extract(desc, 'ID Personnage') || extract(desc, 'Character ID');
  const nom         = extract(desc, '\\bNom\\b');
  const prenom      = extract(desc, 'Prénom') || extract(desc, 'Prenom');
  const telephone   = nullIfPlaceholder(extract(desc, 'N°\\s*Portable') || extract(desc, 'Portable') || extract(desc, 'Téléphone') || extract(desc, 'Telephone'));
  const iban        = nullIfPlaceholder(extract(desc, 'IBAN'));
  const casier      = nullIfPlaceholder(extract(desc, 'Casier'));
  const dateEmbauche = parseDateFr(extract(desc, 'Date d\'embauche') || extract(desc, "Date d'embauche") || extract(desc, 'Date embauche'));
  const recruteurRaw = extract(desc, 'Recruteur') || extract(desc, 'Recrut');
  const recruteurDiscord = extractDiscordId(recruteurRaw);

  return {
    employeDiscord,
    employeUsername,
    idPerso,
    nom,
    prenom,
    telephone,
    iban,
    casier,
    dateEmbauche: dateEmbauche ? dateEmbauche.toISOString() : null,
    recruteurDiscord
  };
}
