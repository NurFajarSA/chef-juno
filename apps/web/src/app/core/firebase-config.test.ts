import { afterEach, describe, expect, it, vi } from 'vitest';

// dashboard tidak menyimpan ID project: di produksi config dibaca dari Firebase Hosting (/__/firebase/init.json)
const setHost = (hostname: string | null) => {
  if (hostname === null) delete (globalThis as { location?: unknown }).location;
  else (globalThis as { location?: unknown }).location = { hostname };
};
const fresh = async () => {
  vi.resetModules(); // config produksi disimpan di modul — mulai bersih tiap test
  return import('./firebase-config');
};
const res = (status: number, body: unknown) =>
  (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;

afterEach(() => setHost(null));

describe('config Firebase dashboard', () => {
  it('localhost → emulator tanpa membaca Hosting', async () => {
    setHost('localhost');
    const m = await fresh();
    let called = false;
    await m.loadFirebaseConfig((async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch);
    expect(called).toBe(false);
    expect(m.firebaseConfig().projectId).toBe('demo-chefjuno');
  });

  it('produksi → config dari /__/firebase/init.json; belum dimuat / tidak lengkap / gagal → error jelas', async () => {
    setHost('reviewer.example.com');
    const m = await fresh();
    expect(() => m.firebaseConfig()).toThrow(/belum dimuat/);
    await expect(m.loadFirebaseConfig(res(404, {}))).rejects.toThrow('HTTP 404');
    await expect(m.loadFirebaseConfig(res(200, { apiKey: 'k' }))).rejects.toThrow(/tidak lengkap/);
    await m.loadFirebaseConfig(
      res(200, { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: 'a', storageBucket: 'x' }),
    );
    expect(m.firebaseConfig()).toEqual({ apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: 'a' });
  });
});
