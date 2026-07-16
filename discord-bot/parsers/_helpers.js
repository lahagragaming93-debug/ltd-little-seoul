// ============================================================
// Helpers communs aux parsers
// ============================================================

export function firstEmbed(msg) {
  return msg.embeds && msg.embeds.length > 0 ? msg.embeds[0] : null;
}

/**
 * Récupère la valeur d'un champ d'embed par nom (insensible casse/accents/espaces).
 * Cherche aussi dans la description sous forme "**clef:** valeur".
 */
export function getField(embed, name) {
  if (!embed) return null;
  const norm = (s) => normalize(s);
  const target = norm(name);

  if (embed.fields) {
    for (const f of embed.fields) {
      if (norm(f.name) === target || norm(f.name).includes(target)) {
        return stripFieldPrefix(cleanValue(f.value), f.name);
      }
    }
  }
  // Description : "Clé : valeur" ou "**Clé :** valeur"
  if (embed.description) {
    const re = new RegExp(`\\*?\\*?\\s*${escapeReg(name)}\\s*\\*?\\*?\\s*[:=]\\s*([^\\n]+)`, 'i');
    const m = embed.description.match(re);
    if (m) return cleanValue(m[1]);
  }
  return null;
}

// precise=true : conserve les decimales (centimes), utile pour les prix
// au litre ou les montants ou la precision compte. Par defaut, arrondi
// a l'entier pour rester compatible avec les anciens parsers.
export function getMoney(value, precise = false) {
  if (value == null) return 0;
  const s = String(value).replace(/[^\d,.-]/g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return precise ? n : Math.round(n);
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]+/g, '');
}
function cleanValue(s) {
  return String(s || '').replace(/^`+|`+$/g, '').replace(/\*\*/g, '').trim();
}
// Faab'Hook (logs-ig) formate ses fields ainsi :
//   name  = "owner"
//   value = "owner:action-27166-0-1"
// On retire le préfixe "{nom_du_field}:" pour récupérer la vraie valeur.
function stripFieldPrefix(value, fieldName) {
  if (!value || !fieldName) return value;
  const re = new RegExp(`^\\s*${escapeReg(fieldName)}\\s*[:=]\\s*`, 'i');
  return value.replace(re, '').trim();
}
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
