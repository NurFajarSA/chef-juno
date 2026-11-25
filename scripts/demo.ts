// npm run demo — satu perintah, offline (§11.1). Dibungkus `firebase emulators:exec --project demo-chefjuno`.
// Mencetak ✅/❌/⏭️ per langkah; exit ≠ 0 kalau ada yang gagal. Output disimpan ke docs/evidence/demo-output.txt.
import { mkdirSync, writeFileSync } from 'node:fs';
import { clearAuth, clearFirestore } from '../apps/functions/test/helpers.js';
import { createHarness, type Harness } from '../apps/functions/test/harness.js';
import { demoSteps } from './demo-steps.js';

const lines: string[] = [];
const log = (s: string) => {
  lines.push(s);
  console.log(s);
};

export interface Ctx {
  h: Harness;
  log: (s: string) => void;
  state: Record<string, unknown>;
}

export type Step = { n: number; title: string; run?: (c: Ctx) => Promise<string | void> };

async function main() {
  const t0 = Date.now();
  log(`# chefjuno-ai — npm run demo (${new Date().toISOString()})`);
  log(
    'Emulator project demo-chefjuno · GitHub palsu http://127.0.0.1:4010 · fake-claude & fake-codex (tidak ada model sungguhan)\n',
  );
  await clearFirestore();
  await clearAuth();
  const h = await createHarness();
  const ctx: Ctx = { h, log, state: {} };
  let failed = 0;
  let skipped = 0;
  for (const s of demoSteps) {
    if (!s.run) {
      skipped++;
      log(`⏭️  ${String(s.n).padStart(2)}. ${s.title} — BELUM DIBUAT`);
      continue;
    }
    const st = Date.now();
    try {
      const detail = await s.run(ctx);
      log(
        `✅ ${String(s.n).padStart(2)}. ${s.title}${detail ? ` — ${detail}` : ''} (${((Date.now() - st) / 1000).toFixed(1)}s)`,
      );
    } catch (e) {
      failed++;
      log(`❌ ${String(s.n).padStart(2)}. ${s.title} — ${(e as Error).message}`);
    }
  }
  await h.stop();
  log(
    `\nSelesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s · ✅ ${demoSteps.length - failed - skipped} · ❌ ${failed} · ⏭️ ${skipped}`,
  );
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync('docs/evidence/demo-output.txt', lines.join('\n') + '\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ demo berhenti:', e);
  process.exit(1);
});
