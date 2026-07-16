// ============================================================
// Force le refresh du Dashboard Sheet en local
// Usage : node scripts/force-refresh-dashboard.js
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google as googleapis } from 'googleapis';
import { execSync } from 'child_process';

import { regenererDashboard } from '../lib/dashboard-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = resolve(__dirname, '../../serviceAccountKey.json');

initializeApp({ credential: cert(KEY_PATH) });
const db = getFirestore();

// Récupère le DASHBOARD_SA_KEY via firebase CLI
console.log('→ Récupération du secret DASHBOARD_SA_KEY...');
const dashboardSAKeyRaw = execSync(
  'firebase functions:secrets:access DASHBOARD_SA_KEY --project ltd-little-seoul-fa',
  { cwd: resolve(__dirname, '../..'), encoding: 'utf-8' }
).trim();

const dashboardSAKey = JSON.parse(dashboardSAKeyRaw);
console.log(`→ SA email : ${dashboardSAKey.client_email}`);

const auth = new googleapis.auth.GoogleAuth({
  credentials: dashboardSAKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = googleapis.sheets({ version: 'v4', auth });

console.log('→ Lancement regenererDashboard...');
const result = await regenererDashboard({ db, sheets });
console.log('✅ Terminé :', result);

process.exit(0);
