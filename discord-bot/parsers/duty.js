// ============================================================
// Parser : duty (prise / fin de service — format FlashFA)
// Format observé (2026-07-16, salon #logs-little-seoul) :
//   Title : "duty - setStatus"
//   Desc  : "Nouveau status pour un membre"
//   Champs (valeurs préfixées "clef:") : source, properName, characterId,
//   discord, name, status (true|false), groupId
// "duty - setUsername" (changement de pseudo) est ignoré : pas un événement
// de service.
// Le payload est calqué sur ce qu'attend onService côté botIngest :
//   { employeId, employeIdDiscord, employeNom, action: 'start'|'end', timestamp }
// employeId = characterId (l'idPerso des fiches employés du site).
// ============================================================

import { firstEmbed, getField } from './_helpers.js';

// Groupe de l'entreprise (filtre défensif : le webhook du groupe ne relaie en
// principe que ses propres logs, mais on vérifie quand même quand le champ est là).
const GROUP_ID = '4946';

export function parseDutyEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = (e.title || '').toLowerCase();
  if (!title.includes('duty')) return null;
  if (!title.includes('setstatus')) return null; // setUsername & co : ignorés

  const groupId = (getField(e, 'groupId') || '').trim();
  if (groupId && GROUP_ID && groupId !== GROUP_ID) return null;

  const statusRaw = (getField(e, 'status') || '').trim().toLowerCase();
  if (statusRaw !== 'true' && statusRaw !== 'false') return null;

  const characterId = (getField(e, 'characterId') || '').trim();
  const discord     = (getField(e, 'discord') || '').trim();
  const properName  = (getField(e, 'properName') || '').trim();

  return {
    employeId: characterId || null,
    employeIdDiscord: discord || null,
    employeNom: properName || null,
    action: statusRaw === 'true' ? 'start' : 'end',
    timestamp: msg.createdTimestamp ? new Date(msg.createdTimestamp).toISOString() : new Date().toISOString()
  };
}
