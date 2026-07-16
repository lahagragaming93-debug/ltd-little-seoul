// ============================================================
// Backup complet — Firestore + Firebase Auth users
// ============================================================
// Genere un fichier JSON unique avec :
//   - Toutes les collections Firestore (top-level + sub-collections
//     conserves comme champ _subcollections par doc)
//   - Tous les utilisateurs Firebase Auth (uid, email, disabled,
//     customClaims, providerData, metadata)
//   - Metadata du backup (date, version, project_id)
//
// Usage : node scripts/backup-complet.js
// Sortie : ../../backup-{YYYYMMDD-HHmmss}.json a la racine du projet
// ============================================================

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH  = resolve(__dirname, '../../serviceAccountKey.json');
const PROJECT_ROOT = resolve(__dirname, '../../..');

const sa = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();
const adminAuth = getAdminAuth();

// Convertit Firestore Timestamp / DocumentReference en valeurs JSON-friendly
function jsonify(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(jsonify);
  if (typeof value === 'object') {
    // Firestore Timestamp
    if (typeof value.toDate === 'function') return { __type: 'Timestamp', iso: value.toDate().toISOString() };
    // Firestore DocumentReference
    if (typeof value.path === 'string' && typeof value.id === 'string' && typeof value.collection === 'function') {
      return { __type: 'DocumentReference', path: value.path };
    }
    // GeoPoint
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length === 2) {
      return { __type: 'GeoPoint', latitude: value.latitude, longitude: value.longitude };
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = jsonify(value[k]);
    return out;
  }
  return value;
}

async function dumpCollection(colRef, depth = 0) {
  const snap = await colRef.get();
  const docs = [];
  for (const doc of snap.docs) {
    const data = jsonify(doc.data());
    // Sub-collections (depth limit pour eviter recursion infinie)
    let subs = {};
    if (depth < 3) {
      const subCols = await doc.ref.listCollections();
      for (const sc of subCols) {
        subs[sc.id] = await dumpCollection(sc, depth + 1);
      }
    }
    docs.push({
      id: doc.id,
      data,
      ...(Object.keys(subs).length > 0 ? { _subcollections: subs } : {})
    });
  }
  return docs;
}

async function main() {
  const startedAt = new Date();
  console.log(`Backup demarre : ${startedAt.toISOString()}`);
  console.log(`Project : ${sa.project_id}\n`);

  // 1) Liste les collections top-level
  console.log('Scan collections top-level...');
  const topCols = await db.listCollections();
  console.log(`${topCols.length} collections trouvees : ${topCols.map(c => c.id).join(', ')}\n`);

  const firestore = {};
  for (const col of topCols) {
    process.stdout.write(`  ${col.id.padEnd(30)} ... `);
    try {
      const docs = await dumpCollection(col);
      firestore[col.id] = docs;
      console.log(`${docs.length} docs`);
    } catch (e) {
      console.log(`ERR : ${e.message}`);
      firestore[col.id] = { __error: e.message };
    }
  }

  // 2) Firebase Auth users (paginated 1000 par page)
  console.log('\nDump Firebase Auth users...');
  const authUsers = [];
  let nextPageToken;
  do {
    const result = await adminAuth.listUsers(1000, nextPageToken);
    for (const u of result.users) {
      authUsers.push({
        uid: u.uid,
        email: u.email || null,
        emailVerified: u.emailVerified,
        displayName: u.displayName || null,
        disabled: u.disabled,
        customClaims: u.customClaims || null,
        providerData: u.providerData.map(p => ({ providerId: p.providerId, uid: p.uid, email: p.email })),
        metadata: {
          creationTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime
        }
      });
    }
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  console.log(`  ${authUsers.length} users\n`);

  const backup = {
    metadata: {
      backupVersion: 1,
      projectId: sa.project_id,
      generatedAt: startedAt.toISOString(),
      generatedBy: 'backup-complet.js',
      stats: {
        collections: topCols.length,
        totalDocs: Object.values(firestore).reduce((s, d) => s + (Array.isArray(d) ? d.length : 0), 0),
        authUsers: authUsers.length
      }
    },
    firestore,
    auth: { users: authUsers }
  };

  const ts = startedAt.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '').replace(/-(\d{2})$/, '$1');
  const fileName = `backup-${ts}.json`;
  const filePath = resolve(PROJECT_ROOT, fileName);
  writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  const sizeKB = Math.round(JSON.stringify(backup).length / 1024);
  console.log(`✓ Backup ecrit : ${filePath}`);
  console.log(`  Taille : ${sizeKB} KB`);
  console.log(`  Collections : ${topCols.length}`);
  console.log(`  Docs total : ${backup.metadata.stats.totalDocs}`);
  console.log(`  Auth users : ${authUsers.length}`);
  console.log(`  Duree : ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s`);

  process.exit(0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
