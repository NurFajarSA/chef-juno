import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { DB_ID } from '@chefjuno/shared';

if (!getApps().length) initializeApp();

let _db: Firestore | null = null;
export function db(): Firestore {
  if (!_db) _db = getFirestore(DB_ID);
  return _db;
}
export const auth = () => getAuth();
