import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../../src/webhook.js';

const body = Buffer.from('{"action":"created"}');
const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const SECRET = 'a'.repeat(64);

describe('verifySignature (tanda tangan webhook GitHub)', () => {
  it('cocok dengan secret yang sama; salah secret / tanpa header / format lain ditolak', () => {
    expect(verifySignature(body, sign(SECRET), SECRET)).toBe(true);
    expect(verifySignature(body, sign('lain'), SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, 'sha1=abc', SECRET)).toBe(false);
  });
  it('secret tersimpan dengan baris baru di ujung (dari `openssl rand -hex 32 > file`) tetap cocok dengan secret di GitHub', () => {
    // GitHub memotong spasi saat secret ditempel; Secret Manager menyimpan file apa adanya
    expect(verifySignature(body, sign(SECRET), SECRET + '\n')).toBe(true);
  });
  it('secret kosong (atau hanya spasi) selalu ditolak', () => {
    expect(verifySignature(body, sign(''), '')).toBe(false);
    expect(verifySignature(body, sign(''), ' \n')).toBe(false);
  });
});
