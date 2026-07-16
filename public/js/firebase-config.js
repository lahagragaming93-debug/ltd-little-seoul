// ============================================================
// Configuration Firebase — À COMPLÉTER avec votre projet
// ============================================================
// Pour obtenir ces valeurs : Firebase Console > Project settings > Web app > Config.
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey:            'AIzaSyBJcvAx_rof8q0y1XvkYnJuPgrapyGOiIM',
  authDomain:        'ltd-little-seoul-fa.firebaseapp.com',
  projectId:         'ltd-little-seoul-fa',
  storageBucket:     'ltd-little-seoul-fa.firebasestorage.app',
  messagingSenderId: '198143273475',
  appId:             '1:198143273475:web:92f4bfd7eaa2885ee07c36'
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

enableIndexedDbPersistence(db).catch(() => { /* multi-tab non critique */ });
