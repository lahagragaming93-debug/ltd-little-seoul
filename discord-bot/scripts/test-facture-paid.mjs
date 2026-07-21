// Test unitaire du parser facturePaid (embeds réels du salon logs, 19-20/07).
import { parseFacturePaidEmbed } from '../parsers/facturePaid.js';

const mk = (title, fields) => ({ embeds: [{ title, fields: Object.entries(fields).map(([name, value]) => ({ name, value })) }] });
let pass = 0, fail = 0;
const ok = (label, cond, extra) => { if (cond) { pass++; console.log('  OK  ' + label); } else { fail++; console.log('  FAIL ' + label + (extra ? ' -> ' + JSON.stringify(extra) : '')); } };

// Facture de Morgan (réelle, 19/07)
const r1 = parseFacturePaidEmbed(mk('xbankaccount - paid', {
  billId: 'billId:2037684', amount: 'amount:4000', reason: "reason:200 bidon d'essence pour MOF",
  fromDiscord: 'fromDiscord:607318402087911434', fromPropername: 'fromPropername:Morgan Harper',
  toDiscord: 'toDiscord:449483532876644352', toPropername: 'toPropername:Casey Diaz Mitchell', groupId: 'groupId:4946'
}));
ok('paid Morgan: payload complet', r1 && r1.factureId === '2037684' && r1.montant === 4000 && r1.vendeurDiscord === '607318402087911434' && r1.vendeurNom === 'Morgan Harper' && r1.clientNom === 'Casey Diaz Mitchell' && r1.paiement === 'carte', r1);
ok('paid Morgan: items "200 bidon d\'essence..."', r1.items.length === 1 && r1.items[0].quantite === 200, r1.items);

// Facture Timmy (réelle, 20/07)
const r2 = parseFacturePaidEmbed(mk('xbankaccount - paid', {
  billId: 'billId:2039310', amount: 'amount:18000', reason: 'reason:3000 caoutchouc + 300 vis',
  fromDiscord: 'fromDiscord:692484575732957244', fromPropername: 'fromPropername:Timmy Lasvald',
  toDiscord: 'toDiscord:214863405025067008', toPropername: 'toPropername:Kaela Hawkins'
}));
ok('paid Timmy: 18000 + 2 items (3000 caoutchouc / 300 vis)', r2 && r2.montant === 18000 && r2.items.length === 2 && r2.items[0].quantite === 3000 && r2.items[1].quantite === 300, r2 && r2.items);

// paidCash -> especes ; raison abrégée "HDx2" -> pattern xN
const r3 = parseFacturePaidEmbed(mk('xbankaccount - paidCash', {
  billId: 'billId:99', amount: 'amount:90', reason: 'reason:HDx2',
  fromDiscord: 'fromDiscord:1', fromPropername: 'fromPropername:A B', toDiscord: 'toDiscord:2', toPropername: 'toPropername:C D'
}));
ok('paidCash: paiement especes', r3 && r3.paiement === 'especes', r3);

// Non-factures : ignorés
ok('addmoney -> null', parseFacturePaidEmbed(mk('xbankaccount - addmoney', { iban: 'iban:LTDLS', amount: 'amount:18000', reason: 'reason:Paiement facture N°2039310' })) === null);
ok('create -> null', parseFacturePaidEmbed(mk('xbankaccount - create', { billId: 'billId:1', amount: 'amount:5' })) === null);
ok('withdraw -> null', parseFacturePaidEmbed(mk('xbankaccount - withdraw', { iban: 'iban:LTDLS', amount: 'amount:250' })) === null);
ok('cancel -> null', parseFacturePaidEmbed(mk('xbankaccount - cancel', { billId: 'billId:1' })) === null);

console.log('\nRESULT: ' + pass + ' OK / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
