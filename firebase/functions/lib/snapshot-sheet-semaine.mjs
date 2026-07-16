// ============================================================
// Module : Snapshot Sheet d'une semaine cloturee (audit IRS)
// ============================================================
// A chaque cloture (manuelle bouton /comptabilite ou cron clotureHebdo
// lundi 00h00 Paris), cree/met-a-jour un onglet dedie dans le Sheet
// Comptabilite LTD figeant l'integralite des ventes/depenses/paies de la
// semaine. L'onglet est cree au premier appel et reecrit a l'identique
// aux suivants (idempotent : meme sheetId, contenu remplace).
//
// Importe par index.js (cloturerSemaine + clotureHebdo) via try/catch
// englobant — ne doit JAMAIS faire echouer la cloture.
//
// Decision design 2026-05-18 :
//  - Couleurs C.* dupliquees localement pour eviter la dependance circulaire
//    avec dashboard-core.mjs et garder le module autonome.
//  - weekIsoLabel / snapshotSheetTitle extraits dans lib/week-iso.mjs (3e
//    usage -> shared).
// ============================================================

import { Timestamp } from 'firebase-admin/firestore';
import { SHEET_ID } from './dashboard-core.mjs';
import { snapshotSheetTitle, weekIsoLabel } from './week-iso.mjs';

// ============================================================
// Palette (miroir de dashboard-core.mjs C)
// ============================================================
const C = {
  blood:  { red: 0.545, green: 0,     blue: 0     },
  blood2: { red: 0.70,  green: 0.10,  blue: 0.10  },
  bone:   { red: 0.961, green: 0.941, blue: 0.91  },
  bone2:  { red: 0.98,  green: 0.97,  blue: 0.95  },
  gold:   { red: 0.788, green: 0.663, blue: 0.380 },
  green:  { red: 0.29,  green: 0.49,  blue: 0.18  },
  greenL: { red: 0.85,  green: 0.95,  blue: 0.80  },
  orange: { red: 0.79,  green: 0.50,  blue: 0.10  },
  orangeL:{ red: 1.00,  green: 0.93,  blue: 0.78  },
  blue:   { red: 0.29,  green: 0.42,  blue: 0.54  },
  blueL:  { red: 0.85,  green: 0.90,  blue: 0.96  },
  red:    { red: 0.79,  green: 0.20,  blue: 0.20  },
  redL:   { red: 1.00,  green: 0.85,  blue: 0.82  },
  white:  { red: 1, green: 1, blue: 1 },
  black:  { red: 0, green: 0, blue: 0 },
  gray:   { red: 0.45, green: 0.45, blue: 0.45 },
  grayL:  { red: 0.92, green: 0.92, blue: 0.92 }
};

// ============================================================
// Helpers locaux
// ============================================================
function pad(n) { return String(n).padStart(2, '0'); }
function tsToDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return isNaN(d.getTime()) ? null : d;
}
function fmtDateTimeParis(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || '00';
  // Format dd/MM/yyyy HH:mm:ss (lisible humain, identique au reste du Sheet).
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
function fmtDateParis(ts) {
  const d = tsToDate(ts);
  if (!d) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}
function moneyStr(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('fr-FR') + ' $';
}
function cleanNomBot(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = s.match(/([A-ZÀ-Ÿ][a-zà-ÿ\-']+(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ\-']+)+)/);
  return m ? m[1] : s;
}
function resolveUserLabel(raw, usersByDiscord) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^<@!?undefined>$/i.test(s)) return '— (non résolu)';
  const m = s.match(/^<@!?(\d+)>$/);
  if (m) {
    const did = m[1];
    return usersByDiscord[did] || `Discord #${did}`;
  }
  if (/^\d{15,21}$/.test(s)) {
    return usersByDiscord[s] || `Discord #${s}`;
  }
  return s;
}

async function loadUsersByDiscordMap(db) {
  const snap = await db.collection('users').limit(500).get();
  const map = {};
  for (const d of snap.docs) {
    const u = d.data();
    if (u.idDiscord) {
      const label = `${u.prenom || ''} ${u.nom || ''}`.trim() || u.email || d.id;
      map[String(u.idDiscord)] = label;
    }
  }
  return map;
}

// ============================================================
// Construction des lignes de l'onglet snapshot (9 colonnes)
// ============================================================
// Layout (cols A-I) :
//   0: BANDEAU titre (3 lignes mergees)
//   3-7: KPI recap (3 colonnes x 3 KPI, 2 lignes : valeur+detail)
//   puis sections Ventes / Depenses / Paies (headers + lignes).
//
// Retourne { rows, sections } : sections sert au formatage pour reperer
// les index de debut/fin de chaque table (header / data start / data end).
// ============================================================
function buildSnapshot({ weekKey, debut, fin, semaineData, ventes, depenses, paies, usersByDiscord }) {
  const rows = [];
  const sections = {};

  const titre = snapshotSheetTitle(weekKey, debut, fin);
  const periode = `${weekIsoLabel(weekKey)} — du ${fmtDateParis(debut)} au ${fmtDateParis(fin)}`;
  const generePar = `Snapshot fige le ${new Date().toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })}`;

  // === BANDEAU TITRE (rows 0-2) ===
  rows.push([`🤠 ${titre} — LTD LITTLE SEOUL`, null, null, null, null, null, null, null, null]);
  rows.push([periode, null, null, null, null, null, null, null, null]);
  rows.push([generePar, null, null, null, null, null, null, null, null]);
  rows.push(['', '', '', '', '', '', '', '', '']); // spacer (row 3)

  // === KPI RECAP (rows 4-7) ===
  // 3 colonnes x 3 KPI valeur + 1 row detail
  // Donnees figees : on lit semaineData (doc /semaines/{weekKey}) en priorite,
  // mais on recalcule a partir des collections pour tracabilite croisee.
  const caProduits  = Number(semaineData?.caProduits ?? 0) || ventes.reduce((s, v) => s + ((!v.categorieFiscale || v.categorieFiscale === 'vente') ? (Number(v.montant) || 0) : 0), 0); // fallback : dons hors CA (cohérent avec clôture)
  const caCarburant = Number(semaineData?.caCarburant ?? 0);
  const caTotal     = Number(semaineData?.ca ?? (caProduits + caCarburant));
  const depTotal    = Number(semaineData?.depensesTotales ?? semaineData?.depenses ?? depenses.reduce((s, d) => s + (Number(d.montant) || 0), 0));
  const chargesDedu = Number(semaineData?.chargesDeductibles ?? depenses.filter(d => d.deductible !== false).reduce((s, d) => s + (Number(d.montant) || 0), 0));
  const masseSal    = Number(semaineData?.masseSalariale ?? paies.reduce((s, p) => s + (Number(p.montant) || 0), 0));
  const beneficeNet = Number(semaineData?.beneficeNet ?? (caTotal - depTotal - masseSal));
  // Dons reçus : encaissés mais HORS CA, imposables à part (10/30% Art 3-1.5).
  const donsRecus = Number(semaineData?.donsRecus ?? 0) || ventes.reduce((s, v) => s + (v.categorieFiscale === 'don-recu' ? (Number(v.montant) || 0) : 0), 0);

  // KPI ligne 1 (rows 4-5) : CA total · Charges dedu · Benefice net
  rows.push([
    '💚 CA TOTAL', null, null,
    '❤ CHARGES DÉDUCTIBLES', null, null,
    '🎯 BÉNÉFICE NET', null, null
  ]); // row 4 : labels
  rows.push([
    moneyStr(caTotal), null, null,
    moneyStr(chargesDedu), null, null,
    moneyStr(beneficeNet), null, null
  ]); // row 5 : valeurs
  rows.push([
    `Produits ${moneyStr(caProduits)} · ⛽ Carburant ${moneyStr(caCarburant)} · ${ventes.length} ventes`, null, null,
    `${depenses.filter(d => d.deductible !== false).length}/${depenses.length} dépenses dédu · Total dépenses ${moneyStr(depTotal)}`, null, null,
    `CA − dépenses − salaires versés · ${beneficeNet >= 0 ? 'positif' : '⚠ déficitaire'}`, null, null
  ]); // row 6 : details
  if (donsRecus > 0) {
    rows.push([`🎁 DONS REÇUS ${moneyStr(donsRecus)}`, null, null, 'hors CA · imposable 30% (Art 3-1.5)', null, null, 'À déclarer en « Montant Dons Reçu »', null, null]); // row don
  }
  rows.push(['', '', '', '', '', '', '', '', '']); // row 7 spacer

  // === SECTION VENTES ===
  const idxVentesHeader = rows.length; // row 8
  rows.push([`💵 VENTES DE LA SEMAINE (${ventes.length})`, null, null, null, null, null, null, null, null]);
  rows.push(['Date', 'N° Facture IG', 'Vendeur', 'Client', 'Montant', 'Paiement', 'Raison', '', '']);
  const idxVentesDataStart = rows.length;
  if (ventes.length === 0) {
    rows.push(['—', 'Aucune vente sur cette semaine', '', '', '', '', '', '', '']);
  } else {
    for (const v of ventes) {
      const vendeur = v.vendeurNom || resolveUserLabel(v.vendeurDiscord, usersByDiscord);
      rows.push([
        fmtDateTimeParis(v.timestamp),
        v.factureId || '',
        vendeur || '',
        v.clientNom || v.client || '',
        Number(v.montant) || 0,
        v.paiement || '',
        v.raison || '',
        '',
        ''
      ]);
    }
  }
  const idxVentesDataEnd = rows.length; // exclusif
  sections.ventes = { header: idxVentesHeader, sub: idxVentesHeader + 1, dataStart: idxVentesDataStart, dataEnd: idxVentesDataEnd };
  rows.push(['', '', '', '', '', '', '', '', '']); // spacer

  // === SECTION DEPENSES ===
  const idxDepHeader = rows.length;
  rows.push([`💸 DÉPENSES DE LA SEMAINE (${depenses.length})`, null, null, null, null, null, null, null, null]);
  rows.push(['Date', 'Raison', 'Montant', 'Type', 'Déductible', 'Fournisseur', 'Validé', 'Utilisateur', '']);
  const idxDepDataStart = rows.length;
  if (depenses.length === 0) {
    rows.push(['—', 'Aucune dépense sur cette semaine', '', '', '', '', '', '', '']);
  } else {
    for (const d of depenses) {
      rows.push([
        fmtDateTimeParis(d.timestamp),
        d.raison || '',
        Number(d.montant) || 0,
        d.type || '',
        d.deductible !== false ? 'oui' : 'non',
        d.fournisseurLabel || '',
        d.valideParPatron ? 'oui' : 'non',
        resolveUserLabel(d.utilisateur, usersByDiscord),
        ''
      ]);
    }
  }
  const idxDepDataEnd = rows.length;
  sections.depenses = { header: idxDepHeader, sub: idxDepHeader + 1, dataStart: idxDepDataStart, dataEnd: idxDepDataEnd };
  rows.push(['', '', '', '', '', '', '', '', '']);

  // === SECTION PAIES ===
  const idxPaiesHeader = rows.length;
  rows.push([`💰 PAIES VERSÉES (fenêtre lundi-S 00h → lundi-S+1 02h Paris) — ${paies.length}`, null, null, null, null, null, null, null, null]);
  rows.push(['Date', 'Payeur', 'Bénéficiaire', 'ID Discord bénéf.', 'Montant', 'Période', '', '', '']);
  const idxPaiesDataStart = rows.length;
  if (paies.length === 0) {
    rows.push(['—', 'Aucune paie versée pour cette semaine', '', '', '', '', '', '', '']);
  } else {
    for (const p of paies) {
      const payeur       = (p.payeurDiscord       && usersByDiscord[String(p.payeurDiscord)])       || cleanNomBot(p.payeurNom)       || resolveUserLabel(p.payeurDiscord,       usersByDiscord);
      const beneficiaire = (p.beneficiaireDiscord && usersByDiscord[String(p.beneficiaireDiscord)]) || cleanNomBot(p.beneficiaireNom) || resolveUserLabel(p.beneficiaireDiscord, usersByDiscord);
      const periodeStr = p.periode || weekIsoLabel(p.weekKeyAttribuee || weekKey);
      // ID Discord du beneficiaire conserve pour audit IRS (le patron peut
      // revenir verifier le matricule meme si le compte a ete supprime apres).
      rows.push([
        fmtDateTimeParis(p.timestamp),
        payeur || '',
        beneficiaire || '',
        String(p.beneficiaireDiscord || ''),
        Number(p.montant) || 0,
        periodeStr,
        '', '', ''
      ]);
    }
  }
  const idxPaiesDataEnd = rows.length;
  sections.paies = { header: idxPaiesHeader, sub: idxPaiesHeader + 1, dataStart: idxPaiesDataStart, dataEnd: idxPaiesDataEnd };
  rows.push(['', '', '', '', '', '', '', '', '']);

  // Footer
  rows.push(['🔒 Snapshot fige — Toute modification ulterieure des collections n\'est PAS repercutee ici. Pour audit IRS.', null, null, null, null, null, null, null, null]);

  return { rows, sections, kpis: { caTotal, caProduits, caCarburant, depTotal, chargesDedu, masseSal, beneficeNet } };
}

// ============================================================
// Requetes batchUpdate pour formatage (palette + bordures + money)
// ============================================================
function buildFormatRequests(sheetId, rows, sections) {
  const reqs = [];
  const nbRows = rows.length;
  const nbCols = 9;

  // Reset general
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: nbRows, startColumnIndex: 0, endColumnIndex: nbCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.white,
          textFormat: { foregroundColor: C.black, fontSize: 10, bold: false },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP'
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)'
    }
  });

  // === BANDEAU TITRE (rows 0-2) ===
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.blood,
          textFormat: { foregroundColor: C.bone, bold: true, fontSize: 16, fontFamily: 'Georgia' },
          horizontalAlignment: 'CENTER',
          padding: { top: 10, bottom: 10, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.blood2,
          textFormat: { foregroundColor: C.bone, italic: true, fontSize: 11 },
          horizontalAlignment: 'CENTER',
          padding: { top: 4, bottom: 4, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 9 },
      cell: {
        userEnteredFormat: {
          backgroundColor: C.gold,
          textFormat: { foregroundColor: C.black, fontSize: 10 },
          horizontalAlignment: 'CENTER',
          padding: { top: 3, bottom: 3, left: 8, right: 8 }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });

  // === KPI BLOCS (rows 4-6) — 3 colonnes x label / valeur / detail
  const kpiBlocks = [
    { col0: 0, color: C.greenL,  borderColor: C.green  },
    { col0: 3, color: C.redL,    borderColor: C.red    },
    { col0: 6, color: C.blueL,   borderColor: C.blue   }
  ];
  for (const blk of kpiBlocks) {
    // Label (row 4)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.borderColor, textFormat: { foregroundColor: C.white, bold: true, fontSize: 11 }, horizontalAlignment: 'CENTER', padding: { top: 6, bottom: 6 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Valeur (row 5)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.color, textFormat: { foregroundColor: C.black, bold: true, fontSize: 20, fontFamily: 'Georgia' }, horizontalAlignment: 'CENTER', padding: { top: 12, bottom: 12 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Detail (row 6)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: blk.col0, endColumnIndex: blk.col0 + 3 },
        cell: { userEnteredFormat: { backgroundColor: blk.color, textFormat: { foregroundColor: C.gray, fontSize: 9, italic: true }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 6 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
  }

  // === Helper formatage section (header + sub-header + lignes + bordures + money col)
  // sectionConfig : { header, sub, dataStart, dataEnd, headerColor, moneyCols: [colIndex...] }
  function formatSection({ header, sub, dataStart, dataEnd, headerColor, moneyCols, nbColsUsed }) {
    // Header (titre section)
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: header, endRowIndex: header + 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: header, endRowIndex: header + 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { backgroundColor: headerColor, textFormat: { foregroundColor: C.white, bold: true, fontSize: 12 }, horizontalAlignment: 'LEFT', padding: { top: 6, bottom: 6, left: 10 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Sub-header (colonnes)
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: sub, endRowIndex: sub + 1, startColumnIndex: 0, endColumnIndex: nbColsUsed },
        cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { bold: true, fontSize: 9 }, horizontalAlignment: 'CENTER', padding: { top: 3, bottom: 3 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
      }
    });
    // Lignes data : zebra ivoire / blanc + centrage texte
    if (dataEnd > dataStart) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: nbColsUsed },
          cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { fontSize: 10 }, padding: { left: 6, right: 6, top: 3, bottom: 3 } } },
          fields: 'userEnteredFormat(horizontalAlignment,textFormat,padding)'
        }
      });
      // Zebra : background ivoire2 sur les lignes paires (relatives au debut data)
      for (let r = dataStart; r < dataEnd; r++) {
        if ((r - dataStart) % 2 === 1) {
          reqs.push({
            repeatCell: {
              range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: nbColsUsed },
              cell: { userEnteredFormat: { backgroundColor: C.bone2 } },
              fields: 'userEnteredFormat(backgroundColor)'
            }
          });
        }
      }
      // Formatage money sur les colonnes monetaires
      for (const col of moneyCols || []) {
        reqs.push({
          repeatCell: {
            range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: col, endColumnIndex: col + 1 },
            cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '# ##0 "$"' }, horizontalAlignment: 'RIGHT' } },
            fields: 'userEnteredFormat(numberFormat,horizontalAlignment)'
          }
        });
      }
      // Bordure basse fine sur toutes les lignes data
      reqs.push({
        updateBorders: {
          range: { sheetId, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: nbColsUsed },
          innerHorizontal: { style: 'SOLID', width: 1, color: C.grayL },
          top: { style: 'SOLID', width: 1, color: C.gray },
          bottom: { style: 'SOLID', width: 1, color: C.gray }
        }
      });
    }
  }

  // Ventes : 7 cols (Date, Facture, Vendeur, Client, Montant, Paiement, Raison) -> money col 4
  formatSection({
    ...sections.ventes,
    headerColor: C.green,
    moneyCols: [4],
    nbColsUsed: 7
  });
  // Depenses : 8 cols (Date, Raison, Montant, Type, Dedu, Fournisseur, Valide, Utilisateur) -> money col 2
  formatSection({
    ...sections.depenses,
    headerColor: C.red,
    moneyCols: [2],
    nbColsUsed: 8
  });
  // Paies : 6 cols (Date, Payeur, Beneficiaire, ID Discord beneficiaire, Montant, Periode) -> money col 4
  formatSection({
    ...sections.paies,
    headerColor: C.orange,
    moneyCols: [4],
    nbColsUsed: 6
  });

  // Footer (derniere ligne) : merged + gris discret
  const lastRow = nbRows - 1;
  reqs.push({ mergeCells: { range: { sheetId, startRowIndex: lastRow, endRowIndex: lastRow + 1, startColumnIndex: 0, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: lastRow, endRowIndex: lastRow + 1, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: C.grayL, textFormat: { foregroundColor: C.gray, italic: true, fontSize: 9 }, horizontalAlignment: 'CENTER', padding: { top: 4, bottom: 4 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)'
    }
  });

  // Hauteurs
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 46 }, fields: 'pixelSize' } });
  reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 56 }, fields: 'pixelSize' } });

  // Largeurs colonnes
  const widths = [150, 130, 160, 160, 110, 110, 220, 160, 130];
  for (let c = 0; c < nbCols; c++) {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: widths[c] || 130 },
        fields: 'pixelSize'
      }
    });
  }

  // Pas de quadrillage par defaut
  reqs.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { hideGridlines: true } },
      fields: 'gridProperties.hideGridlines'
    }
  });

  return reqs;
}

// ============================================================
// API publique
// ============================================================
//
// snapshotSheetSemaine({ db, sheets, weekKey, weekDebut, weekFin, semaineData })
//
// - db          : Firestore admin
// - sheets      : Google Sheets API v4 client (deja authentifie par caller)
// - weekKey     : "YYYY-MM-DD" du lundi de la semaine
// - weekDebut   : Date (lundi 00:00 Paris en UTC reel)
// - weekFin     : Date (dim 23:59:59.999 Paris en UTC reel)
// - semaineData : doc /semaines/{weekKey} (objet plain JS, deja charge par
//                 le caller) — sert pour les KPI figes.
//
// Retourne : { sheetId, sheetTitle, rowsWritten, status: 'created'|'updated' }
//
// Garanties :
//  - Idempotent : meme onglet (meme sheetId) reutilise si deja present.
//  - Try/catch englobant cote caller : ne JAMAIS faire echouer la cloture.
// ============================================================
export async function snapshotSheetSemaine({ db, sheets, weekKey, weekDebut, weekFin, semaineData }) {
  if (!db || !sheets) throw new Error('snapshotSheetSemaine: db et sheets requis');
  if (!weekKey || !weekDebut || !weekFin) throw new Error('snapshotSheetSemaine: weekKey/weekDebut/weekFin requis');

  // Fenetre paie : lundi-S 02h00 -> lundi-S+1 02h00 Paris (decalee de 2h, coherent
  // avec cloturerSemaine et clotureHebdoPaies).
  // EXCLUT explicitement les paies lun-S 00h-02h (= paies S-1 en creneau accelere legacy).
  // Patch 2026-05-25 v3.
  const debutFenetrePaie = new Date(weekDebut.getTime() + 2 * 3600 * 1000);
  const finFenetrePaie = new Date(weekFin.getTime() + 1 + 2 * 3600 * 1000);

  const [ventesSnap, depensesSnap, paiesSnap, usersByDiscord] = await Promise.all([
    db.collection('ventes')
      .where('timestamp', '>=', Timestamp.fromDate(weekDebut))
      .where('timestamp', '<=', Timestamp.fromDate(weekFin))
      .orderBy('timestamp', 'desc').get(),
    db.collection('depenses')
      .where('timestamp', '>=', Timestamp.fromDate(weekDebut))
      .where('timestamp', '<=', Timestamp.fromDate(weekFin))
      .orderBy('timestamp', 'desc').get(),
    db.collection('paies')
      .where('timestamp', '>=', Timestamp.fromDate(debutFenetrePaie))
      .where('timestamp', '<=', Timestamp.fromDate(finFenetrePaie))
      .orderBy('timestamp', 'desc').get(),
    loadUsersByDiscordMap(db)
  ]);

  // Ventes : on prend UNIQUEMENT les ventes source='discord' (= remontees par
  // le bot Faab'Hook), meme cachees (matchees avec une declaration manuelle).
  // Raison : le controleur IRS doit retrouver chaque vente par son numero de
  // facture IG original (ex: "1923212") dans son menu IRS — pas le numero
  // "M20260517-0040" genere par le site lors de la declaration manuelle.
  // On exclut juste les annulees (supprimees IG par l'employe via F1).
  const ventes = ventesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(v => v.source === 'discord' && !v.annulee);

  // Depenses : exclure type=='paie' (doublon) ET type=='impot-paye' (paiement
  // d'impot = hors assiette, coherent avec cloture + portail BLA).
  const depenses = depensesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.type !== 'paie' && d.type !== 'impot-paye');

  // Paies de la semaine = paies de la fenetre horaire (non taggees ou taggees pour CETTE
  // semaine) + paies explicitement rattachees a cette semaine via weekKeyAttribuee, MEME
  // versees en retard (ex. patron malade : la paie est versee 2-3 jours apres la cloture
  // mais compte pour la semaine concernee). On exclut les paies de la fenetre taggees pour
  // une AUTRE semaine -> aucun double comptage.
  const taggedPaiesSnap = await db.collection('paies').where('weekKeyAttribuee', '==', weekKey).get();
  const paiesById = {};
  paiesSnap.docs.forEach(d => { const p = { id: d.id, ...d.data() }; if (!p.weekKeyAttribuee || p.weekKeyAttribuee === weekKey) paiesById[d.id] = p; });
  taggedPaiesSnap.docs.forEach(d => { paiesById[d.id] = { id: d.id, ...d.data() }; });
  const paies = Object.values(paiesById);

  const { rows, sections } = buildSnapshot({
    weekKey, debut: weekDebut, fin: weekFin, semaineData: semaineData || {},
    ventes, depenses, paies, usersByDiscord
  });

  const sheetTitle = snapshotSheetTitle(weekKey, weekDebut, weekFin);

  // Recherche onglet existant
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, includeGridData: false });
  const existing = (meta.data.sheets || []).find(s => s.properties.title === sheetTitle);
  let sheetId;
  let status;
  if (existing) {
    sheetId = existing.properties.sheetId;
    status = 'updated';
  } else {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetTitle,
              gridProperties: { rowCount: Math.max(rows.length + 20, 100), columnCount: 9, hideGridlines: true },
              tabColor: C.blood
            }
          }
        }]
      }
    });
    sheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    status = 'created';
  }

  // Effacement contenu et fusions (large : 500 lignes pour couvrir grosses semaines)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 26 } } },
        { updateCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 26 },
            fields: 'userEnteredValue,userEnteredFormat'
        } }
      ]
    }
  });

  // Ecriture des valeurs
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows.map(r => r.map(c => c == null ? '' : c)) }
  });

  // Application des formats (par batchs de 30 pour rester sous la limite)
  const formatReqs = buildFormatRequests(sheetId, rows, sections);
  const BATCH = 30;
  for (let i = 0; i < formatReqs.length; i += BATCH) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: formatReqs.slice(i, i + BATCH) }
    });
  }

  return { sheetId, sheetTitle, rowsWritten: rows.length, status };
}
