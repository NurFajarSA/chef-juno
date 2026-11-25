# Contributing

## Setup

```bash
nvm use                          # Node from .nvmrc
npm install
npx playwright install chromium  # once
npm run dev                      # emulators + dashboard + demo data
npm run verify                   # guard → lint → typecheck → build → all tests
```

Requirements: Node 24, Java 21+ (Firebase emulators), npm. Do not use bun, pnpm or yarn in this repository.

## Before opening a pull request

- `npm run verify` passes.
- Behaviour changes come with a test that exercises the code the way it runs: a unit test for pure logic, an emulator test (`apps/functions/test/emulator`) for anything that crosses Functions, Firestore rules and the daemon, an e2e test (`e2e/`) for dashboard behaviour.
- Tests never call a real `claude` or `codex`: use the fake agents in `apps/daemon/test` (`CHEFJUNO_CLAUDE_BIN`, `CHEFJUNO_CODEX_BIN`). Tests run against the `demo-chefjuno` emulator project only.
- Never skip, comment out or weaken a test or assertion to make it pass. `scripts/guard-tests.mjs` enforces part of this in `verify`.
- Never add an API-key mode for Anthropic or OpenAI. Machines use subscription logins only.
- Never put real repository names, people, accounts, project IDs or secrets in code, tests, fixtures or screenshots. Use `tim/sample-repo`, `example.com` and the seed data in `scripts/seed-*.mjs`.
- Security rules changes (`firestore.rules`) come with tests in `apps/functions/test/emulator/rules.test.ts` for what is allowed and what is still refused.
- Data shapes shared between apps are zod schemas in `packages/shared`. TypeScript is strict; avoid `any` unless a comment says why.
- Dashboard text, bot comments and the in-dashboard guide are Indonesian. If you change behaviour the guide describes, update `docs/guide/` and run `node scripts/gen-guide.mjs`.

After a UI change, `npm run screenshots` regenerates screenshots from demo data; copy the ones the README uses into `docs/images`.
