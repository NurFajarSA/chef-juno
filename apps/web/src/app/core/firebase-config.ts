/**
 * Config Firebase web. Di localhost/127.0.0.1 → emulator project `demo-chefjuno`.
 * Di produksi config dibaca saat runtime dari Firebase Hosting (`/__/firebase/init.json`, disediakan otomatis untuk
 * project tempat dashboard di-deploy) — jadi kode tidak terikat ke satu project dan tidak menyimpan ID project.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export const EMULATOR_CONFIG: FirebaseWebConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-chefjuno.firebaseapp.com',
  projectId: 'demo-chefjuno',
  appId: 'demo-app',
};

export const EMULATOR_PORTS = { auth: 9099, firestore: 8085, functions: 5001 };

export function useEmulators(): boolean {
  if (typeof location === 'undefined') return true;
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

let prod: FirebaseWebConfig | null = null;

/** Muat config produksi dari Hosting sebelum aplikasi dijalankan (tidak dipakai di emulator). */
export async function loadFirebaseConfig(fetcher: typeof fetch = fetch): Promise<void> {
  if (useEmulators()) return;
  const r = await fetcher('/__/firebase/init.json');
  if (!r.ok) throw new Error(`Config Firebase tidak bisa dimuat dari Hosting (HTTP ${r.status})`);
  const c = (await r.json()) as Partial<FirebaseWebConfig>;
  if (!c.apiKey || !c.projectId || !c.appId || !c.authDomain) throw new Error('Config Firebase dari Hosting tidak lengkap');
  prod = { apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, appId: c.appId };
}

/** Config aktif: emulator di localhost, selain itu config produksi yang sudah dimuat. */
export function firebaseConfig(): FirebaseWebConfig {
  if (useEmulators()) return EMULATOR_CONFIG;
  if (!prod) throw new Error('Config Firebase belum dimuat (loadFirebaseConfig)');
  return prod;
}
