# Chef Juno — rules for coding agents

Read `README.md` for what this is and `CONTRIBUTING.md` for the checks every change must pass. The in-dashboard guide (`docs/guide/`, Indonesian) describes the current behaviour in depth; treat it as the spec and keep it true.

## Environment

- Node from `.nvmrc`: run `source ~/.nvm/nvm.sh && nvm use` at the start of every shell.
- Package manager: **npm** (workspaces). Never bun, pnpm or yarn here.
- Firebase CLI from the devDependency (`npx firebase …`), not a global one.
- All development and tests use the emulators with the project `demo-chefjuno`. Run commands non-interactively: `CI=1 NG_CLI_ANALYTICS=false`.
- Check the real version of a library (`npm view <pkg> version`) before writing code against a specific API, and follow that version's docs.

## Hard limits

- Do not deploy, and do not run Firebase commands against a real project, unless the owner of that deployment explicitly asks you to in this session.
- Never create GitHub Apps, OAuth Apps, secrets or cloud resources. Describe the steps in `docs/SETUP.md` instead. Fake local secrets for the emulator (`apps/functions/.secret.local`, written by `npm run setup:local`) are fine.
- Never write secrets, tokens or private keys to the repository. Project-specific parameters live in gitignored files (`apps/functions/.env.<project-id>`, `.firebaserc`); examples hold placeholders only.
- Never call a real `claude` or `codex` in tests or demos. Use the fake agents (`CHEFJUNO_CLAUDE_BIN`, `CHEFJUNO_CODEX_BIN`).
- Never add an API-key mode (Anthropic or OpenAI). Reviewers use subscriptions only.
- Never push to `main` directly, force-push, or rewrite published history. Work on a branch and open a pull request.

## Honesty

- Never skip, delete, comment out or weaken a test or assertion to get green (`.skip`, `.only`, `.todo`, `xit`, lowered expectations, swallowed errors). If a test fails and you cannot fix it, leave it failing and say so.
- Never change, move or bypass `scripts/guard-tests.mjs`.
- Mocks, stubs and hardcoded values are allowed to make progress, but must carry a `// MOCK:` or `// STUB:` comment and must never be described as a finished feature.
- Report what you actually verified: name the test, the command, or the step you ran. "Untested" is not "passed".

## How to work

- Test the critical paths first: security rules, command parsing, claim/lease, diff line mapping, comment formatting, the app-test gate.
- TypeScript strict, no `any` unless unavoidable (comment why). Shared data shapes are zod schemas in `packages/shared`.
- UI text, bot comments and the guide are Indonesian. Follow the existing Material 3 look of the dashboard.
- After a change: `npm run verify` must be green, the guide updated if behaviour changed (`node scripts/gen-guide.mjs`), and a conventional commit message.
