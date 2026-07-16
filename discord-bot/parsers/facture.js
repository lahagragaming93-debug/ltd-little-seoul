// ============================================================
// Parser : suivi-facture
// Format observé :
//   Facture #ID — Payée
//   Émetteur: @Discord — Prénom NOM (vendeur)
//   Destinataire: @Discord — Prénom NOM (client)
//   Montant: X $
//   Raison: ...
//   Paiement: Espèces / Carte
// ============================================================

import { firstEmbed, getField, getMoney } from './_helpers.js';

export function parseFactureEmbed(msg) {
  const e = firstEmbed(msg);
  if (!e) return null;

  const title = (e.title || '') + ' ' + (e.description || '');
  if (!/facture/i.test(title)) return null;

  const idMatch = title.match(/#?(\d{3,})/);
  const factureId = idMatch ? idMatch[1] : `${msg.id}`;

  const emetteur     = getField(e, 'émetteur')     || getField(e, 'emetteur')     || getField(e, 'vendeur') || '';
  const destinataire = getField(e, 'destinataire') || getField(e, 'client')       || '';

  const { discord: vendeurDiscord, nom: vendeurNom } = parseUserField(emetteur);
  const { discord: clientDiscord, nom: clientNom }    = parseUserField(destinataire);

  const montantField = getField(e, 'montant') || '';
  const montant = getMoney(montantField);
  const raison = getField(e, 'raison') || '';
  const paiement = (getField(e, 'paiement') || '').toLowerCase().includes('carte') ? 'carte' : 'especes';

  // Tenter de détecter des items (raison souvent : "5 x Bonbon, 2 x Cola Zero")
  const items = parseItems(raison);

  return {
    factureId,
    vendeurDiscord,
    vendeurNom,
    clientDiscord,
    clientNom,
    montant,
    raison,
    paiement,
    items
  };
}

function parseUserField(s) {
  const discord = ((s || '').match(/<@!?(\d+)>/) || [])[1] || '';
  // "Prénom NOM" après un tiret
  const nomMatch = (s || '').match(/[—–-]\s*([A-ZÀ-Ÿ][a-zà-ÿ\-']+\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ\-']+)/);
  return { discord, nom: nomMatch ? nomMatch[1] : (s || '').replace(/<@!?\d+>/g, '').trim() };
}

function parseItems(raison) {
  if (!raison) return [];
  const out = [];
  // Pattern 1 : "Nx Item" ou "N x Item" (quantité d'abord) — format vendeurs particulier
  // Ex : "5x Bonbon, 2 x Cola Zero"
  const re1 = /(\d+)\s*[xX×]\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]+?)(?=,|;|$|\s+\d+\s*[xX×])/gi;
  let m;
  while ((m = re1.exec(raison))) {
    out.push({ quantite: parseInt(m[1], 10), nom: m[2].trim() });
  }
  if (out.length > 0) return out;

  // Pattern 2 : "Item xN" ou "Item Xn" (quantité après) — format direction (vente pro)
  // Ex : "EAU PURIFIER X5000", "Corde x1500 vigneron", "lampe x29", "ferti x300"
  const re2 = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\- ]*?)\s*[xX×]\s*(\d+)/g;
  while ((m = re2.exec(raison))) {
    const nom = m[1].trim();
    const qte = parseInt(m[2], 10);
    if (nom && qte > 0) {
      out.push({ quantite: qte, nom });
    }
  }
  return out;
}
