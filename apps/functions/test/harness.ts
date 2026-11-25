// Harness alur penuh (dipakai test e2e emulator & `npm run demo`):
// GitHub palsu (server HTTP terpisah) + bare repo fixture + mesin (daemon in-process) dengan fake-claude/fake-codex.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { admin, callFn, FN_BASE, idTokenFor } from './helpers.js';
import { GithubMock } from '../../../scripts/lib/github-mock.mjs';
import { createFixtureRepo, gitUrlTemplate } from '../../../scripts/lib/fixture-repo.mjs';
import { issueComment, sendWebhook, type IssueCommentOpts } from '../../../scripts/lib/payloads.mjs';
import { seedBase } from '../../../scripts/seed-data.mjs';
import { exchangeCode } from '../../daemon/src/api.js';
import { Daemon } from '../../daemon/src/daemon.js';
import { ClaudeRunner } from '../../daemon/src/agents/claude.js';
import { CodexRunner } from '../../daemon/src/agents/codex.js';
import { handleJob } from '../../daemon/src/jobs/handle.js';
import type { AgentRunner } from '../../daemon/src/agents/types.js';

export const FAKE_CLAUDE = fileURLToPath(new URL('../../daemon/test/fake-claude.mjs', import.meta.url));
export const FAKE_CODEX = fileURLToPath(new URL('../../daemon/test/fake-codex.mjs', import.meta.url));
export const REPO_ID = 4242;
export const FULL_NAME = 'tim/sample-repo';

export type Fixture = ReturnType<typeof createFixtureRepo>;

export interface Harness {
  mock: GithubMock;
  repo: Fixture;
  recordDir: string;
  daemons: Daemon[];
  db: ReturnType<typeof admin>['db'];
  startMachine(o?: {
    name?: string;
    claudeAuth?: string;
    codexAuth?: string;
    agents?: ('claude' | 'codex')[];
    /** mesin tanpa emulator (`chefjuno start --no-app`) */
    noApp?: boolean;
  }): Promise<Daemon>;
  comment(body: string, o?: Partial<IssueCommentOpts>): Promise<{ status: number; body: unknown; delivery: string }>;
  waitJob(
    pred: (j: FirebaseFirestore.DocumentData) => boolean,
    timeoutMs?: number,
  ): Promise<{ id: string; data: FirebaseFirestore.DocumentData }>;
  waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs?: number, label?: string): Promise<T>;
  stop(): Promise<void>;
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  label = 'kondisi',
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timeout menunggu ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function createHarness(o: { mockPort?: number } = {}): Promise<Harness> {
  const { db } = admin();
  const mock = await new GithubMock().start(o.mockPort ?? 4010);
  const repo = createFixtureRepo(FULL_NAME);
  const home = mkdtempSync(join(tmpdir(), 'cj-daemon-'));
  const recordDir = join(home, 'recorded');
  process.env.CHEFJUNO_HOME = home;
  process.env.CHEFJUNO_GIT_URL_TEMPLATE = gitUrlTemplate(repo.root);
  process.env.CHEFJUNO_HEARTBEAT_MS = '2000';
  process.env.CHEFJUNO_LEASE_RENEW_MS = '2000';
  mock.addRepo({ fullName: FULL_NAME, id: REPO_ID, bare: repo.bare });
  mock.addPr(FULL_NAME, {
    number: 1,
    title: 'feat: cache option untuk fetchUser',
    body: 'Menambah opsi cache.',
    author: 'dev2',
    baseSha: repo.baseSha,
    headSha: repo.headSha,
    baseRef: 'main',
    headRef: 'feat/cache-user',
  });
  await seedBase(db);
  await db.doc(`repos/${REPO_ID}`).set({
    fullName: FULL_NAME,
    installationId: 777,
    private: true,
    enabled: true,
    defaultBranch: 'main',
    updatedAt: FieldValue.serverTimestamp(),
    index: { status: 'none' },
  });
  const daemons: Daemon[] = [];
  let n = 0;
  const h: Harness = {
    mock,
    repo,
    recordDir,
    daemons,
    db,
    async startMachine(m = {}) {
      const tok = await idTokenFor('uid-dev2', { cj: 'member', cjGh: '2002' });
      const r = await callFn<{ code: string }>('createMachineRegistration', { name: m.name ?? `Mesin ${++n}` }, tok);
      if (!r.ok) throw new Error('registrasi gagal: ' + JSON.stringify(r.error));
      const ex = await exchangeCode(FN_BASE, r.result!.code);
      const env = {
        FAKE_AGENT_RECORD_DIR: recordDir,
        FAKE_CLAUDE_AUTH: m.claudeAuth ?? 'claude.ai',
        FAKE_CODEX_AUTH: m.codexAuth ?? 'chatgpt',
      };
      const runners: AgentRunner[] = [
        new ClaudeRunner({ bin: FAKE_CLAUDE, env }),
        new CodexRunner({ bin: FAKE_CODEX, env }),
      ];
      const d = new Daemon({
        creds: {
          server: FN_BASE,
          machineId: ex.machineId,
          machineSecret: ex.machineSecret,
          firebaseConfig: ex.firebaseConfig,
        },
        runners,
        allowAgents: m.agents,
        noApp: m.noApp,
        handler: handleJob,
        log: process.env.CHEFJUNO_DEBUG ? (m: string) => console.log('[daemon]', m) : () => undefined,
      });
      await d.start();
      daemons.push(d);
      return d;
    },
    comment(body, extra = {}) {
      return sendWebhook(
        FN_BASE,
        'issue_comment',
        issueComment({ fullName: FULL_NAME, repoId: REPO_ID, prNumber: 1, body, ...extra }),
      );
    },
    async waitJob(pred, timeoutMs = 45_000) {
      return waitFor(
        async () => {
          const s = await db.collection('jobs').get();
          const d = s.docs.find((x) => pred(x.data()));
          return d ? { id: d.id, data: d.data() } : null;
        },
        timeoutMs,
        'job',
      );
    },
    waitFor,
    async stop() {
      for (const d of daemons.splice(0)) await d.stop();
      await mock.stop();
    },
  };
  return h;
}

export const tsAgo = (ms: number) => Timestamp.fromMillis(Date.now() - ms);
