// ============================================================
// CLI : régénère le Dashboard Compta (thin wrapper sur lib/dashboard-core)
// ============================================================
// Usage : node scripts/refaire-dashboard-pro.js
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { google } from 'googleapis';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { regenererDashboard } from '../lib/dashboard-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

try {
  await regenererDashboard({ db, sheets, verbose: true });
  process.exit(0);
} catch (e) {
  console.error('Erreur :', e.message);
  console.error(e.stack);
  process.exit(2);
}
