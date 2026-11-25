#!/usr/bin/env node
// Runner uji aplikasi Chef Juno. Dijalankan di container Playwright (atau langsung di host saat test).
/* global self, document, MouseEvent, InputEvent -- dipakai di dalam halaman browser (addInitScript / evaluate) */
// Tidak mengeksekusi kode dari agent: hanya menafsirkan langkah terbatas (goto/click/fill/press/scroll/wait/
// screenshot/expectText/expectNoText) dari plan.json.
//
// Env: APP_DIR (hasil build web), OUT_DIR (hasil + screenshot), PLAN_FILE, PW_MODULE (path playwright-core),
//      CHEFJUNO_APP_EMAIL / CHEFJUNO_APP_PASSWORD (akun testing; hanya untuk langkah login milik repo).
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const APP_DIR = resolve(process.env.APP_DIR ?? '/app');
const OUT_DIR = resolve(process.env.OUT_DIR ?? '/out');
const plan = JSON.parse(readFileSync(process.env.PLAN_FILE ?? join(OUT_DIR, 'plan.json'), 'utf8'));
const { chromium } = await import(process.env.PW_MODULE ?? '/pw/index.mjs');
const EMAIL = process.env.CHEFJUNO_APP_EMAIL ?? '';
const PASSWORD = process.env.CHEFJUNO_APP_PASSWORD ?? '';
const APP_CHECK_TOKEN = process.env.CHEFJUNO_APP_CHECK_DEBUG_TOKEN ?? '';
const MAX_SHOTS = 6;
const deadline = Date.now() + (plan.timeoutMs ?? 300_000);
mkdirSync(OUT_DIR, { recursive: true });

/** Hapus kredensial dari teks apa pun yang masuk hasil. */
const scrub = (s, max = 600) => {
  let t = String(s ?? '').slice(0, max);
  for (const secret of [EMAIL, PASSWORD, APP_CHECK_TOKEN]) if (secret) t = t.split(secret).join('[disamarkan]');
  // kunci/token yang bisa muncul di URL atau log aplikasi (mis. API key web Firebase di ?key=…, token akses)
  t = t
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[kunci-disamarkan]')
    .replace(/\b(gh[pousr]_[0-9A-Za-z]{20,})/g, '[token-disamarkan]');
  t = t.replace(/([?&](?:key|token|access_token|auth|sig|signature)=)[^&\s]+/gi, '$1[disamarkan]');
  return t;
};
/** URL request tanpa query string (query bisa membawa kunci/token). */
const bareUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return String(u).split('?')[0];
  }
};
const cap = (arr, n = 30) => arr.slice(0, n).map((x) => scrub(x, 300));

// ---------- server statis (SPA fallback) ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(APP_DIR, urlPath));
  if (!file.startsWith(APP_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const idx = join(file, 'index.html');
    file = existsSync(idx) ? idx : join(APP_DIR, 'index.html');
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // Flutter wasm butuh isolasi lintas origin untuk multi-thread; aman untuk server lokal
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

// Mode emulator: port emulator di mesin diteruskan ke 127.0.0.1 di container, jadi aplikasi yang dibangun untuk
// EMU_HOST=127.0.0.1 tetap menjangkau emulator di laptop (pengaman "host harus lokal" di aplikasi tidak dilonggarkan).
const forwarders = [];
if (plan.forward?.ports?.length) {
  for (const port of plan.forward.ports) {
    const f = net.createServer((client) => {
      const upstream = net.connect({ host: plan.forward.host, port });
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    });
    await new Promise((r, j) => f.once('error', j).listen(port, '127.0.0.1', r));
    forwarders.push(f);
  }
}
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- browser ----------
// Host yang diblokir lewat aturan DNS Chromium, bukan context.route: mencegat semua request membuat aplikasi
// Flutter Wasm tidak pernah tampil (layar putih).
const blockedHosts = (plan.blockHosts ?? []).filter((h) => /^[a-z0-9.*-]+$/i.test(h));
const browser = await chromium.launch({
  headless: true,
  args: [
    // container tanpa GPU: Chromium tidak lagi otomatis memakai SwiftShader untuk WebGL, padahal Flutter web butuh WebGL
    '--enable-unsafe-swiftshader',
    ...(blockedHosts.length
      ? [`--host-resolver-rules=${blockedHosts.map((h) => `MAP ${h} ~NOTFOUND`).join(', ')}`]
      : []),
  ],
});
const context = await browser.newContext({
  viewport: plan.viewport ?? { width: 412, height: 915 },
  serviceWorkers: 'block',
  locale: 'id-ID',
  timezoneId: 'Asia/Jakarta',
});
if (APP_CHECK_TOKEN) {
  // Debug token App Check tetap (sudah didaftarkan di Firebase Console). Dikunci sebelum skrip aplikasi jalan supaya
  // `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` di index.html (token acak per browser) tidak menimpanya.
  await context.addInitScript((token) => {
    Object.defineProperty(self, 'FIREBASE_APPCHECK_DEBUG_TOKEN', {
      get: () => token,
      set() {},
      configurable: false,
    });
  }, APP_CHECK_TOKEN);
}

const result = { loginOk: true, error: null, scenarios: [] };
const writeResult = () => writeFileSync(join(OUT_DIR, 'result.json'), JSON.stringify(result, null, 2));
const hardKill = setTimeout(
  () => {
    result.error = 'batas waktu uji habis';
    writeResult();
    process.exit(0);
  },
  Math.max(10_000, deadline - Date.now() + 15_000),
);

/**
 * Tunggu aplikasi siap: halaman termuat, lalu tenang — tidak ada navigasi halaman utama selama 4 detik (aplikasi bisa
 * memuat ulang dirinya saat start, mis. setelah status login berubah) dan, untuk Flutter, pohon semantics sudah ada.
 * Maks 60 detik.
 */
async function settle(page) {
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
  let lastNav = Date.now();
  const onNav = (f) => {
    if (f === page.mainFrame()) lastNav = Date.now();
  };
  page.on('framenavigated', onNav);
  try {
    for (const end = Date.now() + 60_000; Date.now() < end;) {
      if (plan.flutterSemantics) await ensureSemantics(page);
      const ready = plan.flutterSemantics
        ? await page.evaluate(() => !!document.querySelector('flt-semantics')).catch(() => false)
        : true;
      if (ready && Date.now() - lastNav > (plan.flutterSemantics ? 4000 : 200)) return;
      await page.waitForTimeout(plan.flutterSemantics ? 500 : 100);
    }
  } finally {
    page.off('framenavigated', onNav);
  }
}

/**
 * Pohon semantics Flutter web hanya aktif setelah placeholder "Enable accessibility" diklik, dan klik diabaikan selama
 * aplikasi masih di splash. Dicoba ulang (klik sungguhan) setiap kali placeholder masih ada.
 */
async function ensureSemantics(page) {
  if (!plan.flutterSemantics) return;
  // klik DOM dengan koordinat di tengah placeholder, diulang
  // sampai pohon semantics muncul (klik diabaikan selama aplikasi belum siap)
  for (let k = 0; k < 24; k++) {
    const state = await page
      .evaluate(() => {
        if (document.querySelector('flt-semantics')) return 'ok';
        const e = document.querySelector('flt-semantics-placeholder');
        if (!e) return 'none';
        const r = e.getBoundingClientRect();
        e.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }),
        );
        return 'tried';
      })
      .catch(() => 'none');
    if (state !== 'tried') return;
    await page.waitForTimeout(250);
  }
}

const cssStr = (s) => s.replace(/["\\]/g, '\\$&');
function locate(page, s) {
  let loc;
  if (s.role) loc = page.getByRole(s.role, s.name ? { name: s.name } : {});
  else if (s.label) loc = page.getByLabel(s.label).or(page.locator(`[aria-label*="${cssStr(s.label)}"]`));
  else loc = page.getByText(s.text).or(page.locator(`[aria-label*="${cssStr(s.text)}"]`));
  return loc.nth(s.nth ?? 0);
}

/** Jalankan satu langkah. Kembalikan error (string) atau null. Expect* gagal tidak menghentikan skenario. */
async function step(page, s, ctx) {
  const t = { timeout: 8000 };
  switch (s.do) {
    case 'goto':
      await page.goto(base + s.path, { timeout: 45_000 });
      await settle(page);
      return null;
    case 'click':
      await locate(page, s).click(t);
      await page.waitForTimeout(400);
      return null;
    case 'fill':
      return fillField(page, locate(page, s), s.value, t);
    case 'press':
      await page.keyboard.press(s.key);
      await page.waitForTimeout(300);
      return null;
    case 'scroll': {
      const v = page.viewportSize() ?? { width: 400, height: 800 };
      await page.mouse.move(v.width / 2, v.height / 2);
      await page.mouse.wheel(0, s.dy);
      await page.waitForTimeout(500);
      return null;
    }
    case 'wait':
      if (s.text) await locate(page, { text: s.text }).waitFor({ state: 'visible', timeout: 10_000 });
      else await page.waitForTimeout(s.ms ?? 0);
      return null;
    case 'screenshot':
      await shot(page, ctx, s.shot);
      return null;
    case 'expectText': {
      const ok = await locate(page, { text: s.text })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      return ok ? null : `teks "${s.text}" tidak terlihat`;
    }
    case 'expectNoText': {
      await page.waitForTimeout(300);
      const n = await locate(page, { text: s.text, nth: null })
        .count()
        .catch(() => 0);
      return n === 0 ? null : `teks "${s.text}" terlihat`;
    }
    default:
      return `langkah tidak dikenal: ${s.do}`;
  }
}

const FOCUSED_VALUE = () => {
  const n = document.activeElement;
  return n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') ? n.value : null;
};
/**
 * Isi kolom teks. Flutter web baru membaca kolom beberapa frame setelah fokus (teks yang masuk lebih awal hilang),
 * dan Chrome headless kadang tidak memasukkan ketikan keyboard. Jadi: ketuk kolom, isi `value` + event `input`
 * (seperti input method), lalu cek ulang sampai isinya benar.
 */
async function fillField(page, loc, value, t) {
  await loc.click(t);
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    await page.waitForTimeout(250);
    const v = await page.evaluate(FOCUSED_VALUE);
    if (v === value) return null;
    if (v === null) break; // fokus bukan di kolom teks → coba cara biasa
    await page.evaluate((text) => {
      const n = document.activeElement;
      n.value = text;
      try {
        n.setSelectionRange(text.length, text.length);
      } catch {
        // input type email/number tidak mendukung seleksi; isi tetap masuk
      }
      n.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
    }, value);
  }
  await loc.fill(value, t);
  return null;
}

async function shot(page, ctx, name) {
  if (ctx.shots.length >= MAX_SHOTS) return;
  const file = `s${ctx.index}-${
    String(name)
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 40) || 'layar'
  }.jpg`;
  if (ctx.shots.some((x) => x.file === file)) return;
  await page.screenshot({ path: join(OUT_DIR, file), type: 'jpeg', quality: 70 }).catch(() => undefined);
  if (existsSync(join(OUT_DIR, file))) ctx.shots.push({ name, file });
}

const isAction = (s) => !['expectText', 'expectNoText', 'screenshot'].includes(s.do);

/** strict = semua langkah harus berhasil (dipakai untuk login: pengecekan gagal = login gagal). */
async function runSteps(page, steps, ctx, record, offset = 0, strict = false) {
  for (let i = 0; i < steps.length; i++) {
    if (Date.now() > deadline) {
      record.push({ i: i + offset, do: steps[i].do, ok: false, error: 'batas waktu habis' });
      return false;
    }
    let err;
    try {
      await ensureSemantics(page);
      err = await step(page, steps[i], ctx);
    } catch (e) {
      err = scrub(String(e?.message ?? e).split('\n')[0]);
    }
    record.push({ i: i + offset, do: steps[i].do, ok: !err, error: err ? scrub(err) : null });
    if (err && (strict || isAction(steps[i]))) {
      await shot(page, ctx, `gagal-langkah-${i + 1 + offset}`);
      return false;
    }
  }
  return true;
}

function watch(page) {
  const w = { console: [], pageErrors: [], failedRequests: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.console.push(m.text());
  });
  page.on('pageerror', (e) => w.pageErrors.push(String(e?.message ?? e)));
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_BLOCKED_BY_CLIENT')
      w.failedRequests.push(`${r.failure()?.errorText} ${bareUrl(r.url())}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) w.failedRequests.push(`${r.status()} ${bareUrl(r.url())}`);
  });
  return w;
}

try {
  // login sekali; sesi (cookie, IndexedDB Firebase Auth) dipakai semua skenario
  if ((plan.login ?? []).length) {
    const page = await context.newPage();
    await page.goto(base + '/', { timeout: 45_000 });
    await settle(page);
    const fill = (v) =>
      typeof v === 'string' ? v.split('{{email}}').join(EMAIL).split('{{password}}').join(PASSWORD) : v;
    const steps = plan.login.map((s) => ({ ...s, value: fill(s.value) }));
    const rec = [];
    result.loginOk = await runSteps(page, steps, { index: 'login', shots: [] }, rec, 0, true);
    if (!result.loginOk) result.error = `login gagal: ${rec.find((r) => !r.ok)?.error ?? ''}`;
    await page.waitForTimeout(1500);
    await page.close();
  }

  for (const sc of plan.scenarios ?? []) {
    const started = Date.now();
    const page = await context.newPage();
    const w = watch(page);
    const ctx = { index: sc.index, shots: [] };
    const rec = [];
    try {
      await page.goto(base + (sc.steps[0]?.do === 'goto' ? sc.steps[0].path : '/'), { timeout: 45_000 });
      await settle(page);
      // langkah goto pertama sudah dijalankan di atas; nomor langkah tetap mengikuti rencana asli
      const first = sc.steps[0]?.do === 'goto';
      if (first) rec.push({ i: 0, do: 'goto', ok: true, error: null });
      await runSteps(page, first ? sc.steps.slice(1) : sc.steps, ctx, rec, first ? 1 : 0);
    } catch (e) {
      rec.push({ i: rec.length, do: 'goto', ok: false, error: scrub(String(e?.message ?? e).split('\n')[0]) });
    }
    await ensureSemantics(page);
    await shot(page, ctx, 'akhir');
    const aria = await page
      .locator('body')
      .ariaSnapshot({ timeout: 5000 })
      .catch(() => '');
    result.scenarios.push({
      index: sc.index,
      steps: rec,
      shots: ctx.shots,
      console: cap(w.console),
      pageErrors: cap(w.pageErrors),
      failedRequests: cap(w.failedRequests),
      aria: scrub(aria, 6000),
      url: scrub(page.url().replace(base, ''), 300),
      durationMs: Date.now() - started,
    });
    await page.close();
    writeResult();
  }
} catch (e) {
  result.error = scrub(String(e?.message ?? e).split('\n')[0]);
} finally {
  writeResult();
  clearTimeout(hardKill);
  await browser.close().catch(() => undefined);
  server.close();
  for (const f of forwarders) f.close();
}
