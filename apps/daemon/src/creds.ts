import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './env.js';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

export interface Credentials {
  server: string;
  machineId: string;
  machineSecret: string;
  firebaseConfig: FirebaseWebConfig;
}

const file = () => join(cfg.home(), 'credentials.json');

export function saveCreds(c: Credentials) {
  mkdirSync(cfg.home(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), JSON.stringify(c, null, 2), { mode: 0o600 });
  chmodSync(file(), 0o600);
}

export function loadCreds(): Credentials | null {
  if (!existsSync(file())) return null;
  return JSON.parse(readFileSync(file(), 'utf8')) as Credentials;
}

export function deleteCreds(): boolean {
  if (!existsSync(file())) return false;
  rmSync(file());
  return true;
}
