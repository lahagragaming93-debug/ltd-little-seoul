// ============================================================
// Parser : logs-ig (inventaire)
// ============================================================
// Format observé (embed type=inventory-add OU inventory-remove) :
//   Champs habituels : discord, name, properName, characterId,
//   source, count, item, metadata, owner.
// Selon le serveur, les noms peuvent être en minuscule, en titre ou
// préfixés de "🟢/🔴". On essaie d'être souple.
// ============================================================

import { firstEmbed, getField } from './_helpers.js';
import { resolveItemId, isLtdSource } from './items-mapping.js';

export function parseInventoryEmbed(msg) {
  const embed = firstEmbed(msg);
  if (!embed) return null;

  const title = (embed.title || '').toLowerCase();
  const desc = (embed.description || '').toLowerCase();
  const haystack = `${title} ${desc}`;

  let type = null;
  if (haystack.includes('inventory-add') || haystack.includes('add')) type = 'inventory-add';
  else if (haystack.includes('inventory-remove') || haystack.includes('remove')) type = 'inventory-remove';
  else return null;

  const source  = getField(embed, 'source');
  const owner   = getField(embed, 'owner');
  const rawItem = getField(embed, 'item');

  // Le coffre FiveM est porté par `owner` (ex: "action-27166-0-1") ;
  // `source` peut être un slot/numéro non significatif. On accepte si
  // l'un OU l'autre matche un préfixe LTD.
  if (!isLtdSource(owner) && !isLtdSource(source)) return null;

  // Skip silencieux : item inconnu du catalogue (parasites, items persos…).
  const itemId = resolveItemId(rawItem);
  if (!itemId) return null;

  return {
    type,
    discord:     getField(embed, 'discord'),
    name:        getField(embed, 'name'),
    properName:  getField(embed, 'properName') || getField(embed, 'proper_name'),
    characterId: getField(embed, 'characterId') || getField(embed, 'character_id') || getField(embed, 'idPerso'),
    source,
    count:       Number(getField(embed, 'count')) || 0,
    item:        itemId,            // ID catalogue résolu (slug stable)
    itemNomBrut: rawItem,           // nom FiveM original conservé pour debug
    metadata:    getField(embed, 'metadata') || '',
    owner:       owner || ''
  };
}
