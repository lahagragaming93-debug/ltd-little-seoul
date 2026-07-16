// Crée le doc engagement initial : remboursement essence 300k$ (contrat THORPE 14/05/2026)
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');
initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

// Engagement : remboursement subvention essence
// Contrat signé Abraham THORPE (Governor SA / IRS) le 14/05/2026
// Virement 790 000$ dont 300 000$ essence à rembourser sous 4 semaines
const ID = 'subvention-essence-2026-05-14';
const DATE_RECEPTION = new Date('2026-05-14T11:51:00');
const DATE_ECHEANCE = new Date(DATE_RECEPTION.getTime() + 28 * 24 * 3600 * 1000); // +4 semaines

const docData = {
  id: ID,
  type: 'subvention-rembours',
  beneficiaire: 'Governor of San Andreas (IRS)',
  signataire: 'Abraham THORPE',
  objet: 'Subvention Essence à rembourser (TTE Art. 4-2.16 sous réserve)',
  montantInitial: 300000,
  montantRembourse: 0,
  montantRestant: 300000,
  devise: 'USD',
  dateReception: Timestamp.fromDate(DATE_RECEPTION),
  dateEcheance: Timestamp.fromDate(DATE_ECHEANCE),
  statut: 'actif',
  source: {
    type: 'subvention-gouvernement',
    transactionBanqueLtdId: 'ZlaJTunFdOwhQT8q6AmB',
    contratTotal: 790000,
    detail: [
      { item: 'Brickadeta',  montant: 345000, statut: 'accorde', remboursable: false },
      { item: 'Pounder 3',   montant: 375000, statut: 'refuse',  remboursable: false },
      { item: 'Jogger',      montant: 145000, statut: 'accorde', remboursable: false },
      { item: 'Essence',     montant: 300000, statut: 'accorde-sous-reserve', remboursable: true, delai: '4 semaines' }
    ]
  },
  notes: 'Contrat IRS signé par Abraham THORPE, Governor of San Andreas. Document à conserver min 6 sem (Art. 4-1.1). Subvention non imposable (Art. 4-2.16). Auto-détection remboursement via raison "remboursement subvention essence" dans /depenses.',
  dateCreation: new Date().toISOString(),
  dateMaj: Timestamp.fromDate(new Date())
};

await db.collection('engagements').doc(ID).set(docData);
console.log(`✓ Engagement créé : /engagements/${ID}`);
console.log(`   Montant restant à rembourser : ${docData.montantRestant} $`);
console.log(`   Échéance : ${DATE_ECHEANCE.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`);
const joursRestants = Math.ceil((DATE_ECHEANCE - Date.now()) / (24 * 3600 * 1000));
console.log(`   Jours restants : ${joursRestants}`);

process.exit(0);
