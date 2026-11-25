import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { DB_ID } from '@chefjuno/shared';
import type { Credentials } from './creds.js';
import { mintToken } from './api.js';

export interface FbSession {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  idToken: () => Promise<string>;
  close: () => Promise<void>;
}

let n = 0;
/** Login mesin: mint custom token dari secret, lalu signInWithCustomToken (sesi hanya di memori). */
export async function connect(c: Credentials): Promise<FbSession> {
  const app = initializeApp(c.firebaseConfig, `chefjuno-${c.machineId}-${n++}`);
  const auth = getAuth(app);
  const db = getFirestore(app, DB_ID);
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, h, Number(p));
  }
  const token = await mintToken(c);
  await signInWithCustomToken(auth, token);
  return {
    app,
    auth,
    db,
    idToken: async () => {
      const u = auth.currentUser;
      if (!u) throw new Error('Belum login.');
      return u.getIdToken();
    },
    close: () => deleteApp(app),
  };
}
