import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAccount, buildArgs, runnerArgs } from '../../src/jobs/app-verify.js';

const RUNNER = fileURLToPath(new URL('../../runner/app-runner.mjs', import.meta.url));
const WEB_APP = fileURLToPath(new URL('../fixtures/web-app', import.meta.url));
const PW = fileURLToPath(new URL('../../../../node_modules/playwright-core/index.mjs', import.meta.url));

afterEach(() => {
  delete process.env.CHEFJUNO_HOME;
  delete process.env.CHEFJUNO_APP_EMAIL;
  delete process.env.CHEFJUNO_APP_PASSWORD;
});

describe('argumen container uji aplikasi', () => {
  it('runner: kredensial hanya lewat -e NAMA (tanpa nilai), mount read-only kecuali /out, tanpa capability', () => {
    const a = runnerArgs({ image: 'pw:1', appDir: '/j/app', runnerDir: '/j/r', pwDir: '/n/pw', outDir: '/j/out' });
    expect(a.slice(0, 2)).toEqual(['run', '--rm']);
    expect(a[a.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(a[a.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
    expect(a).toEqual(expect.arrayContaining(['/j/app:/app:ro', '/j/r:/runner:ro', '/n/pw:/pw:ro', '/j/out:/out']));
    const envs = a.filter((_, i) => a[i - 1] === '-e');
    expect(envs).toEqual(
      expect.arrayContaining(['CHEFJUNO_APP_EMAIL', 'CHEFJUNO_APP_PASSWORD', 'CHEFJUNO_APP_CHECK_DEBUG_TOKEN']),
    );
    expect(envs.filter((e) => e.startsWith('CHEFJUNO_APP_')).every((e) => !e.includes('='))).toBe(true);
    expect(a.slice(-3)).toEqual(['pw:1', 'node', '/runner/app-runner.mjs']);
  });
  it('build: salinan kode saja yang di-mount, tanpa capability', () => {
    const a = buildArgs({ image: 'flutter', dir: '/j/src', script: 'flutter build web' });
    expect(a).toContain('/j/src:/src');
    expect(a[a.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(a.at(-1)).toBe('flutter build web');
  });
});

describe('akun testing', () => {
  it('dibaca per repo dari ~/.chefjuno/app-accounts.json; env menang', () => {
    const home = mkdtempSync(join(tmpdir(), 'cj-home-'));
    process.env.CHEFJUNO_HOME = home;
    expect(appAccount('tim/aplikasi-mobile')).toBeNull();
    writeFileSync(
      join(home, 'app-accounts.json'),
      JSON.stringify({ 'tim/aplikasi-mobile': { email: 'qa@x.id', password: 'p', appCheckDebugToken: 'dbg' } }),
    );
    expect(appAccount('tim/aplikasi-mobile')).toEqual({
      email: 'qa@x.id',
      password: 'p',
      appCheckDebugToken: 'dbg',
    });
    expect(appAccount('tim/lain')).toBeNull();
    process.env.CHEFJUNO_APP_EMAIL = 'env@x.id';
    process.env.CHEFJUNO_APP_PASSWORD = 'e';
    expect(appAccount('tim/lain')).toEqual({ email: 'env@x.id', password: 'e' });
  });
});

describe('runner di browser sungguhan (Chromium Playwright)', () => {
  it('login akun testing, memicu bug, screenshot JPEG, debug token App Check dikunci, kredensial disamarkan', () => {
    const out = mkdtempSync(join(tmpdir(), 'cj-runner-'));
    mkdirSync(out, { recursive: true });
    const plan = {
      viewport: { width: 412, height: 800 },
      flutterSemantics: false,
      blockHosts: ['*.amplitude.com'],
      timeoutMs: 60_000,
      login: [
        { do: 'fill', label: 'Email', value: '{{email}}' },
        { do: 'fill', label: 'Kata sandi', value: '{{password}}' },
        { do: 'click', role: 'button', name: 'Masuk' },
        { do: 'wait', text: 'Beranda' },
      ],
      scenarios: [
        {
          index: 1,
          steps: [
            { do: 'goto', path: '/keranjang' },
            { do: 'click', role: 'button', name: 'Tambah buku' },
            { do: 'screenshot', shot: 'setelah-tambah' },
            { do: 'expectNoText', text: 'NaN' },
            { do: 'expectText', text: 'tester@contoh.id' },
          ],
        },
        {
          index: 2,
          steps: [
            { do: 'goto', path: '/' },
            { do: 'click', text: 'Tidak ada tombol ini' },
            { do: 'screenshot', shot: 'tidak-sampai' },
          ],
        },
        // index.html menulis FIREBASE_APPCHECK_DEBUG_TOKEN = true; runner harus menang dengan token tetap
        {
          index: 3,
          steps: [
            { do: 'goto', path: '/' },
            { do: 'expectText', text: 'App Check: token tetap' },
          ],
        },
      ],
    };
    writeFileSync(join(out, 'plan.json'), JSON.stringify(plan));
    const r = spawnSync(process.execPath, [RUNNER], {
      env: {
        ...process.env,
        APP_DIR: WEB_APP,
        OUT_DIR: out,
        PLAN_FILE: join(out, 'plan.json'),
        PW_MODULE: PW,
        CHEFJUNO_APP_EMAIL: 'tester@contoh.id',
        CHEFJUNO_APP_PASSWORD: 'rahasia-uji',
        CHEFJUNO_APP_CHECK_DEBUG_TOKEN: 'debug-token-uji-1234',
      },
      encoding: 'utf8',
      timeout: 90_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const raw = readFileSync(join(out, 'result.json'), 'utf8');
    const res = JSON.parse(raw);
    expect(res.loginOk).toBe(true);
    const [s1, s2, s3] = res.scenarios;
    expect(s3.steps.map((s: { ok: boolean }) => s.ok)).toEqual([true, true]);
    expect(s3.aria).toContain('App Check: token tetap [disamarkan]');
    expect(s1.steps.map((s: { do: string; ok: boolean }) => `${s.do}:${s.ok}`)).toEqual([
      'goto:true',
      'click:true',
      'screenshot:true',
      'expectNoText:false',
      'expectText:false', // email tidak tampil di keranjang
    ]);
    expect(s1.aria).toContain('Total: Rp NaN');
    expect(s1.shots.map((x: { name: string }) => x.name)).toEqual(['setelah-tambah', 'akhir']);
    expect(readFileSync(join(out, s1.shots[0].file)).subarray(0, 3).toString('hex')).toBe('ffd8ff');
    // aksi gagal → skenario berhenti dengan screenshot "gagal-langkah-n"; screenshot berikutnya tidak diambil
    expect(s2.steps.at(-1)).toMatchObject({ do: 'click', ok: false });
    expect(s2.shots.map((x: { name: string }) => x.name)).toEqual(['gagal-langkah-2', 'akhir']);
    // kredensial tidak pernah ada di hasil (termasuk pesan error "teks ... tidak terlihat")
    expect(raw).not.toContain('rahasia-uji');
    expect(raw).not.toContain('tester@contoh.id');
    expect(raw).not.toContain('debug-token-uji-1234');
    expect(s1.steps[4].error).toContain('[disamarkan]');
  }, 120_000);
});
