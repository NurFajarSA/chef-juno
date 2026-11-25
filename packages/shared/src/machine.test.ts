import { describe, it, expect } from 'vitest';
import { CODE_ALPHABET, OFFLINE_AFTER_MS } from './constants.js';
import { MACHINE_STATUS_LABEL, REGISTRATION_CODE_RE, machineStatus, normalizeRegistrationCode } from './machine.js';

describe('machineStatus (§12.7)', () => {
  const now = 1_800_000_000_000;

  it('offline threshold default 90 detik', () => {
    expect(OFFLINE_AFTER_MS).toBe(90_000);
  });

  it('revoked menang atas semua status lain', () => {
    expect(machineStatus({ revoked: true, lastSeenAtMs: now, currentJobIds: [] }, now)).toBe('revoked');
    expect(machineStatus({ revoked: true, lastSeenAtMs: null }, now)).toBe('revoked');
  });

  it('offline kalau lastSeenAt > 90 detik lalu', () => {
    expect(machineStatus({ lastSeenAtMs: now - 90_001 }, now)).toBe('offline');
    expect(machineStatus({ lastSeenAtMs: now - 3_600_000, currentJobIds: ['j1'] }, now)).toBe('offline');
  });

  it('tepat 90 detik masih online', () => {
    expect(machineStatus({ lastSeenAtMs: now - 90_000 }, now)).toBe('online');
  });

  it('lastSeenAt kosong → offline', () => {
    expect(machineStatus({ lastSeenAtMs: null }, now)).toBe('offline');
    expect(machineStatus({}, now)).toBe('offline');
  });

  it('busy kalau jumlah job >= concurrency (default 1)', () => {
    expect(machineStatus({ lastSeenAtMs: now, currentJobIds: ['j1'] }, now)).toBe('busy');
    expect(machineStatus({ lastSeenAtMs: now, currentJobIds: ['j1', 'j2'], concurrency: 2 }, now)).toBe('busy');
    expect(machineStatus({ lastSeenAtMs: now, currentJobIds: ['j1', 'j2', 'j3'], concurrency: 2 }, now)).toBe('busy');
  });

  it('online kalau masih ada slot', () => {
    expect(machineStatus({ lastSeenAtMs: now - 1000 }, now)).toBe('online');
    expect(machineStatus({ lastSeenAtMs: now, currentJobIds: [] }, now)).toBe('online');
    expect(machineStatus({ lastSeenAtMs: now, currentJobIds: ['j1'], concurrency: 2 }, now)).toBe('online');
  });

  it('offlineAfterMs bisa di-override', () => {
    expect(machineStatus({ lastSeenAtMs: now - 5_000 }, now, 3_000)).toBe('offline');
    expect(machineStatus({ lastSeenAtMs: now - 2_000 }, now, 3_000)).toBe('online');
  });

  it('label Indonesia', () => {
    expect(MACHINE_STATUS_LABEL).toEqual({ online: 'Online', offline: 'Offline', busy: 'Sibuk', revoked: 'Dicabut' });
  });
});

describe('kode registrasi', () => {
  it('normalizeRegistrationCode: huruf besar, buang spasi/tanda, format XXXX-XXXX', () => {
    expect(normalizeRegistrationCode('abcd-efgh')).toBe('ABCD-EFGH');
    expect(normalizeRegistrationCode(' abcd efgh ')).toBe('ABCD-EFGH');
    expect(normalizeRegistrationCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(normalizeRegistrationCode('ab-cd_ef.gh')).toBe('ABCD-EFGH');
  });

  it('panjang bukan 8 tidak diberi tanda hubung', () => {
    expect(normalizeRegistrationCode('abc')).toBe('ABC');
    expect(normalizeRegistrationCode('abcd-efghj')).toBe('ABCDEFGHJ');
    expect(normalizeRegistrationCode('')).toBe('');
  });

  it('REGISTRATION_CODE_RE menerima kode dari CODE_ALPHABET', () => {
    expect(REGISTRATION_CODE_RE.test('ABCD-EFGH')).toBe(true);
    expect(REGISTRATION_CODE_RE.test('2345-6789')).toBe(true);
    expect(REGISTRATION_CODE_RE.test(normalizeRegistrationCode('k7m2 p9qz'))).toBe(true);
  });

  it('REGISTRATION_CODE_RE menolak karakter ambigu, huruf kecil, dan format salah', () => {
    for (const bad of [
      'ABCD-EFG0',
      'ABCD-EFGO',
      'ABCD-EFG1',
      'ABCD-EFGI',
      'ABCD-EFGL',
      'abcd-efgh',
      'ABCDEFGH',
      'ABC-DEFGH',
      'ABCD-EFGHJ',
      ' ABCD-EFGH',
    ])
      expect(REGISTRATION_CODE_RE.test(bad), bad).toBe(false);
  });

  it('REGISTRATION_CODE_RE konsisten dengan CODE_ALPHABET', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(REGISTRATION_CODE_RE.test(`${ch.repeat(4)}-${ch.repeat(4)}`), ch).toBe(CODE_ALPHABET.includes(ch));
    }
  });
});
