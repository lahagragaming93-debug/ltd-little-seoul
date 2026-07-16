// ============================================================
// Met en forme proprement les onglets du Sheet Compta
// ============================================================
// Sur chaque onglet de données (Depenses, Ventes, Paies, resumé) :
//   1. Header (ligne 1) : fond rouge sang LTD + texte blanc bold + center
//   2. Colonnes auto-resize (autoResize en pixels selon contenu)
//   3. Colonne "Justification" (sur Depenses) : wrap text + largeur max 300px
//   4. Cellules data : wrap par défaut pour éviter les textes qui débordent
//   5. Freeze ligne 1 (figée au scroll)
//
// IDEMPOTENT : on ré-applique le format à chaque appel.
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');
const SHEET_ID = '1NmiFVZF0gRKObIifbd-kf67BhsaYClD4ansy6Ev88cA';
const ONGLETS_DATA = ['Depenses', 'Ventes', 'Paies', 'resumé'];

// Couleurs LTD (sang, doré, ivoire) — alignées avec sheets-apps-script.js
const COLOR_BLOOD = { red: 0.545, green: 0, blue: 0 };       // #8B0000
const COLOR_BONE  = { red: 0.961, green: 0.941, blue: 0.91 }; // #F5F0E8
const COLOR_WHITE = { red: 1, green: 1, blue: 1 };
// Bordures : grises pour aérer les cellules
const BORDER_OUTER = { red: 0.30, green: 0.30, blue: 0.30 };  // #4d4d4d (cadre)
const BORDER_INNER = { red: 0.75, green: 0.75, blue: 0.75 };  // #bfbfbf (grille)
// Zebra (bandes) et couleurs conditionnelles
const COLOR_VERT_PALE  = { red: 0.88, green: 0.96, blue: 0.88 };  // #e1f5e1 (déductible)
const COLOR_ROUGE_PALE = { red: 1.00, green: 0.90, blue: 0.90 };  // #ffe5e5 (non déductible)

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function main() {
  // includeGridData: false suffit, mais on demande explicitement les bandedRanges
  // et conditionalFormats pour pouvoir les supprimer avant d'en recréer (script idempotent).
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets(properties,bandedRanges,conditionalFormats)'
  });
  const onglets = meta.data.sheets || [];
  const requests = [];

  for (const ong of onglets) {
    const title = ong.properties.title;
    if (!ONGLETS_DATA.includes(title)) continue;
    const sheetId = ong.properties.sheetId;

    // Lire pour connaître les dimensions + identifier la colonne "Justification"
    let headers = [];
    let nbRows = 1000, nbCols = 10;
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: title
      });
      const data = resp.data.values || [];
      headers = (data[0] || []).map(h => String(h).trim());
      nbRows = Math.max(2, data.length);
      nbCols = Math.max(2, headers.length);
    } catch (e) {
      console.log(`  ⚠ ${title} lecture impossible : ${e.message}`);
      continue;
    }

    const idxJustification = headers.findIndex(h => /justif/i.test(h));
    const idxRaison        = headers.findIndex(h => /^raison$/i.test(h));

    // 1. HEADER en rouge sang, texte blanc bold center, SANS WRAP
    //    (sinon "Montant" se coupe en "Montan / t" — moche).
    //    L'auto-resize plus bas va calculer la largeur nécessaire pour
    //    tenir le header sur 1 ligne.
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: nbCols
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLOR_BLOOD,
            textFormat: {
              foregroundColor: COLOR_WHITE,
              bold: true,
              fontSize: 11
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'OVERFLOW_CELL',   // pas de wrap sur le header
            padding: { top: 6, bottom: 6, left: 4, right: 4 }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)'
      }
    });

    // 2. Cellules data : pas de wrap par défaut (CLIP) + centrage horizontal.
    //    On force WRAP + alignement LEFT uniquement sur Justification + Raison.
    if (nbRows > 1) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: nbRows,
            startColumnIndex: 0,
            endColumnIndex: nbCols
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: 'CLIP',
              verticalAlignment: 'MIDDLE',
              horizontalAlignment: 'CENTER',
              padding: { top: 3, bottom: 3, left: 4, right: 4 }
            }
          },
          fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,padding)'
        }
      });

      // 2b. Colonne Justification + Raison : WRAP + alignement LEFT (texte long, lisible)
      for (const idx of [idxJustification, idxRaison]) {
        if (idx < 0) continue;
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              endRowIndex: nbRows,
              startColumnIndex: idx,
              endColumnIndex: idx + 1
            },
            cell: {
              userEnteredFormat: {
                wrapStrategy: 'WRAP',
                verticalAlignment: 'MIDDLE',
                horizontalAlignment: 'LEFT'
              }
            },
            fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment)'
          }
        });
      }
    }

    // 3. Freeze ligne 1
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 }
        },
        fields: 'gridProperties.frozenRowCount'
      }
    });

    // 4. Auto-resize toutes les colonnes
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: nbCols
        }
      }
    });

    // 5. Colonne Justification : largeur fixe 320px (autoResize aurait fait
    // trop long pour cette colonne de texte). Idem pour Raison sur Depenses.
    if (idxJustification >= 0) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: idxJustification,
            endIndex: idxJustification + 1
          },
          properties: { pixelSize: 320 },
          fields: 'pixelSize'
        }
      });
    }
    if (idxRaison >= 0) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: idxRaison,
            endIndex: idxRaison + 1
          },
          properties: { pixelSize: 220 },
          fields: 'pixelSize'
        }
      });
    }

    // 6. Bordures grises sur toutes les cellules (cadre foncé + grille claire)
    //    Aère le rendu compact qui collait les lignes les unes aux autres.
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: nbRows,
          startColumnIndex: 0,
          endColumnIndex: nbCols
        },
        top:             { style: 'SOLID_MEDIUM', color: BORDER_OUTER },
        bottom:          { style: 'SOLID_MEDIUM', color: BORDER_OUTER },
        left:            { style: 'SOLID_MEDIUM', color: BORDER_OUTER },
        right:           { style: 'SOLID_MEDIUM', color: BORDER_OUTER },
        innerHorizontal: { style: 'SOLID',        color: BORDER_INNER },
        innerVertical:   { style: 'SOLID',        color: BORDER_INNER }
      }
    });

    // 7. Auto-resize TOUTES les lignes (header + data) à la hauteur de leur
    //    contenu. Garantit que les lignes avec texte wrappé (Justification,
    //    Raison) sont lisibles entièrement, sans tronquer.
    //    On le pushe en FIN de boucle (voir plus bas) pour qu'il prenne en
    //    compte le wrap appliqué par les requests précédentes.

    // 8. SUPPRIMER bandings et conditional formats existants (idempotence) AVANT
    //    d'en recréer. On les met en TÊTE de requests pour qu'ils s'appliquent
    //    avant les nouvelles règles dans le même batchUpdate.
    const supprDavant = [];
    for (const b of ong.bandedRanges || []) {
      supprDavant.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
    }
    const condCount = (ong.conditionalFormats || []).length;
    for (let i = condCount - 1; i >= 0; i--) {
      supprDavant.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    }
    requests.unshift(...supprDavant);

    // 9a. Format date sur colonne Date : "dd/MM/yyyy HH:mm:ss"
    //     (les valeurs CSV sont en ISO "yyyy-MM-dd HH:mm:ss" depuis comptaExport,
    //      Sheets les reconnaît comme datetime et le numberFormat les affiche FR)
    //     Sur 'resumé', plusieurs colonnes commencent par "Date" — on les
    //     traite dans le bloc dédié plus bas (format date sans heure).
    const isResume = title === 'resumé';
    const idxDate = isResume ? -1 : headers.findIndex(h => /^date/i.test(h));
    if (idxDate >= 0 && nbRows > 1) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: nbRows,
            startColumnIndex: idxDate,
            endColumnIndex: idxDate + 1
          },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy HH:mm:ss' }
            }
          },
          fields: 'userEnteredFormat.numberFormat'
        }
      });
      // Largeur fixe 150px pour la colonne Date (sinon autoresize trop juste)
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: idxDate,
            endIndex: idxDate + 1
          },
          properties: { pixelSize: 150 },
          fields: 'pixelSize'
        }
      });
    }

    // 9. Format monétaire sur colonne Montant : "25 000 $" + alignement DROITE
    const idxMontant = headers.findIndex(h => /^montant$/i.test(h));
    if (idxMontant >= 0 && nbRows > 1) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: nbRows,
            startColumnIndex: idxMontant,
            endColumnIndex: idxMontant + 1
          },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'NUMBER', pattern: '#,##0" $"' },
              horizontalAlignment: 'RIGHT'
            }
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)'
        }
      });
    }

    // 9b. Onglet 'resumé' : formats colonnes spécifiques (non couvert par les regex
    //     génériques car la col Semaine ressemble à une date pour Sheets, et plusieurs
    //     colonnes commencent par "Date").
    //     Layout fixe : A=Semaine, B=Date début, C=Date fin, D=CA, E=Bénéfice brut,
    //     F=Dépenses totales, G=Charges déductibles, H=Masse salariale, I=Prime hebdo,
    //     J=Prime mensuelle, K=Bénéfice net, L=Nb ventes, M=Nb dépenses, N=Statut.
    if (isResume && nbRows > 1) {
      // Col A (Semaine) : forcer le format texte pour empêcher Sheets de parser "S2026-05-11"
      // ou un weekKey nu en serial date.
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: nbRows, startColumnIndex: 0, endColumnIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      });
      // Cols B-C (Date début, Date fin) : format date sans heure
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: nbRows, startColumnIndex: 1, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/MM/yyyy' } } },
          fields: 'userEnteredFormat.numberFormat'
        }
      });
      // Cols D-K (CA → Bénéfice net) : format monétaire FR "266 174 $" + align droite
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: nbRows, startColumnIndex: 3, endColumnIndex: 11 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'NUMBER', pattern: '#,##0" $"' },
              horizontalAlignment: 'RIGHT'
            }
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment)'
        }
      });
      // Col N (Statut) : largeur 150px pour éviter la troncature "cloturee-manuelle"
      if (nbCols > 13) {
        requests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 },
            properties: { pixelSize: 150 },
            fields: 'pixelSize'
          }
        });
      }
      // Cols B-C (Date) : largeur 110px (date courte, pas besoin de 150)
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 },
          properties: { pixelSize: 110 },
          fields: 'pixelSize'
        }
      });
    }

    // 10a. Sur Depenses : couleur conditionnelle par ligne selon Déductible.
    //      Vert pâle si "oui", rouge pâle si "non". Pas de zebra (le conditionnel prime).
    // 10b. Sur les autres feuilles : zebra ivoire/blanc.
    const isDepenses = title === 'Depenses';
    if (isDepenses && nbRows > 1) {
      const idxDedu = headers.findIndex(h => /d[ée]ductible/i.test(h));
      if (idxDedu >= 0) {
        const col = String.fromCharCode(65 + idxDedu);
        const range = { sheetId, startRowIndex: 1, endRowIndex: nbRows, startColumnIndex: 0, endColumnIndex: nbCols };
        // Rule "oui" → vert pâle
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [range],
              booleanRule: {
                condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${col}2="oui"` }] },
                format: { backgroundColor: COLOR_VERT_PALE }
              }
            },
            index: 0
          }
        });
        // Rule "non" → rouge pâle
        requests.push({
          addConditionalFormatRule: {
            rule: {
              ranges: [range],
              booleanRule: {
                condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${col}2="non"` }] },
                format: { backgroundColor: COLOR_ROUGE_PALE }
              }
            },
            index: 1
          }
        });
      }
    } else if (nbRows > 1) {
      // Zebra ivoire/blanc (bandes alternées) pour Ventes, Paies, resumé
      requests.push({
        addBanding: {
          bandedRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: nbRows, startColumnIndex: 0, endColumnIndex: nbCols },
            rowProperties: {
              firstBandColor:  COLOR_WHITE,
              secondBandColor: COLOR_BONE
            }
          }
        }
      });
    }

    // 11. AUTO-RESIZE des lignes en TOUT DERNIER : prend en compte le wrap
    //     et le padding appliqués au-dessus, calcule la hauteur juste pour que
    //     le contenu (même wrappé) soit entièrement visible.
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: nbRows
        }
      }
    });

    const extras = [];
    if (idxDate >= 0)    extras.push('format date');
    if (idxMontant >= 0) extras.push('format monétaire Montant');
    if (isResume)        extras.push('formats resumé (Semaine texte + dates B-C + money D-K + Statut 150px)');
    if (isDepenses) extras.push('couleurs conditionnelles Déductible');
    else extras.push('zebra ivoire/blanc');
    console.log(`  ✓ ${title} : header rouge + wrap + autoResize cols+rows + freeze + bordures${idxJustification >= 0 ? ' + col Justif 320px' : ''}${idxRaison >= 0 ? ' + col Raison 220px' : ''}${extras.length ? ' + ' + extras.join(' + ') : ''}`);
  }

  if (requests.length === 0) {
    console.log('Aucun onglet traité.');
    process.exit(0);
  }

  console.log(`\nApplication de ${requests.length} request(s) batchUpdate...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests }
  });
  console.log('✓ Mise en forme appliquée. Recharge ton Sheet (F5) pour voir.');
  process.exit(0);
}

main().catch(e => { console.error('Erreur :', e.message); process.exit(2); });
