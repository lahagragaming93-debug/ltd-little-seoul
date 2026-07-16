// ============================================================
// Parser : forum #Dossiers-Employers (threads)
// ============================================================
// Format observé (1er post du thread, contenu texte) :
//   🖇️ - Nom & Prénom de l'employé : Liam Mars
//   📞 - Numéro de téléphone de l'employé : 903-4274
//   🏦 - Iban de l'employé : UCYA1Z
//   🪪 - Carte identité :
//   🚘 - Permis de Conduire :
//   🗒️ - Pôle occupé : Pompiste novice
// ============================================================
// Le routing s'appuie sur msg.channel.parentId (= ID du forum).
// Capture aussi les edits (la fiche peut être complétée après création).
// ============================================================

import { firstEmbed } from './_helpers.js';

// Patterns par champ — match dans UNE seule ligne (split avant lookup).
// Supporte les apostrophes droite et courbe (' ') et les variations de casse.
const LINE_PATTERNS = {
  nomPrenom: /Nom\s*&\s*Pr[ée]nom\s*de\s*l['’]employ[ée]\s*:[ \t]*(.*)$/i,
  telephone: /Num[ée]ro\s*de\s*t[ée]l[ée]phone\s*de\s*l['’]employ[ée]\s*:[ \t]*(.*)$/i,
  iban:      /Iban\s*de\s*l['’]employ[ée]\s*:[ \t]*(.*)$/i,
  cni:       /Carte\s*identit[ée]\s*:[ \t]*(.*)$/i,
  permis:    /Permis\s*de\s*Conduire\s*:[ \t]*(.*)$/i,
  pole:      /P[ôo]le\s*occup[ée]\s*:[ \t]*(.*)$/i
};

function parseFichefromText(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    for (const [key, regex] of Object.entries(LINE_PATTERNS)) {
      if (fields[key] !== undefined) continue;
      const m = line.match(regex);
      if (m) { fields[key] = m[1].trim(); break; }
    }
  }
  return fields;
}

export function parseDossierEmployeMessage(msg) {
  // Le contenu peut être dans msg.content OU dans la description d'un embed
  const text = msg.content || firstEmbed(msg)?.description || '';
  if (!text) return null;

  const fields = parseFichefromText(text);
  // Doit contenir au moins le champ nom+prenom pour être considéré comme une fiche
  const nomPrenom = fields.nomPrenom || '';
  if (!nomPrenom) return null;

  // Split prénom / nom selon la convention "Prénom Nom" observée.
  // Si un seul mot, on prend tout en prénom et nom vide.
  const tokens = nomPrenom.split(/\s+/);
  const prenom = tokens[0] || '';
  const nom    = tokens.slice(1).join(' ').toUpperCase();

  return {
    type:               'dossierEmploye',
    threadId:           msg.channel?.id || '',
    threadName:         msg.channel?.name || '',
    parentForumId:      msg.channel?.parentId || '',
    auteurDiscordId:    msg.author?.id || '',
    auteurUsername:     msg.author?.username || '',
    nomPrenom,
    prenom,
    nom,
    telephone:          fields.telephone || '',
    iban:               fields.iban || '',
    cni:                fields.cni || '',
    permis:             fields.permis || '',
    pole:               fields.pole || ''
  };
}
