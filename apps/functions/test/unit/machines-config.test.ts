import { afterEach, describe, expect, it } from 'vitest';
import { webConfig } from '../../src/machines.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('webConfig (config Firebase untuk daemon)', () => {
  it('produksi tanpa WEB_API_KEY → null (registrasi ditolak), tidak pernah "demo-key"', () => {
    process.env.GCLOUD_PROJECT = 'contoh-prod';
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.WEB_API_KEY;
    expect(webConfig()).toBeNull();
  });
  it('produksi dengan WEB_API_KEY → dipakai', () => {
    process.env.GCLOUD_PROJECT = 'contoh-prod';
    delete process.env.FUNCTIONS_EMULATOR;
    process.env.WEB_API_KEY = 'contoh-api-key-web-publik';
    expect(webConfig()).toEqual({
      apiKey: 'contoh-api-key-web-publik',
      authDomain: 'contoh-prod.firebaseapp.com',
      projectId: 'contoh-prod',
    });
  });
  it('emulator demo → demo-key', () => {
    process.env.GCLOUD_PROJECT = 'demo-chefjuno';
    delete process.env.WEB_API_KEY;
    expect(webConfig()?.apiKey).toBe('demo-key');
  });
});
