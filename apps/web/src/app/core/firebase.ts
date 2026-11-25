import { Injectable } from '@angular/core';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { DB_ID, REGION } from '@chefjuno/shared';
import { EMULATOR_CONFIG, EMULATOR_PORTS, firebaseConfig, useEmulators } from './firebase-config';

/** Inisialisasi Firebase sekali; emulator disambungkan sebelum operasi pertama. */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  readonly emulator = useEmulators();
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly db: Firestore;
  readonly functions: Functions;

  constructor() {
    this.app = initializeApp(firebaseConfig());
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app, DB_ID);
    this.functions = getFunctions(this.app, REGION);
    if (this.emulator) {
      const host = location.hostname === 'localhost' ? 'localhost' : '127.0.0.1';
      connectAuthEmulator(this.auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
      connectFirestoreEmulator(this.db, host, EMULATOR_PORTS.firestore);
      connectFunctionsEmulator(this.functions, host, EMULATOR_PORTS.functions);
    }
  }

  call<I, O>(name: string) {
    const fn = httpsCallable<I, O>(this.functions, name);
    return async (data: I): Promise<O> => (await fn(data)).data;
  }

  /** Base URL Functions untuk perintah `chefjuno login --server …`. */
  functionsBaseUrl(): string {
    return this.emulator
      ? `http://127.0.0.1:${EMULATOR_PORTS.functions}/${EMULATOR_CONFIG.projectId}/${REGION}`
      : `https://${REGION}-${firebaseConfig().projectId}.cloudfunctions.net`;
  }
}
