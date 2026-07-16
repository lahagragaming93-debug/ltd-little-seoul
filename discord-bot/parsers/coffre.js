// ============================================================
// Parser : suivi-coffre
// Format observé :
//   PANEL COFFRE
//   Coffre: action-XXXXX-0-X / Items distincts / MAJ
//   Détail: nom_item → Quantité / Dernière maj / Par
// ============================================================

import { firstEmbed, getField } from './_helpers.js';

export function parseCoffreEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = ((e.title || '') + ' ' + (e.description || '')).toLowerCase();
  if (!title.includes('coffre') && !title.includes('panel')) return null;

  const coffreId       = getField(e, 'coffre') || `coffre_${msg.id}`;
  const itemsDistincts = parseInt(String(getField(e, 'items distincts') || '0').replace(/[^\d]/g, ''), 10) || 0;

  // Détail
  const detail = getField(e, 'détail') || getField(e, 'detail') || e.description || '';
  const items = [];
  const lines = String(detail).split(/\n+/);
  for (const line of lines) {
    // ex : "🟢 Bonbon → 42  (maj : 22:14 par Roger)"
    const m = line.match(/([^→\-:]+)\s*[→\-:]\s*(\d+)/);
    if (m) {
      items.push({
        nom: m[1].replace(/[*`🟢🔴⚠]/g, '').trim(),
        quantite: parseInt(m[2], 10)
      });
    }
  }

  return { coffreId: String(coffreId).trim(), itemsDistincts, items };
}
