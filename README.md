# Chef Juno

An AI pull request reviewer that proves what it says: it reviews the code, runs your app to try the change, and remembers what your team has learned. It runs on your own machines with your Claude Code or Codex subscription.

[![CI](https://github.com/NurFajarSA/chef-juno/actions/workflows/ci.yml/badge.svg)](https://github.com/NurFajarSA/chef-juno/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 24](https://img.shields.io/badge/node-24-black)
![Firebase](https://img.shields.io/badge/backend-Firebase-black)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/review-detail-dark.png">
    <img src="docs/images/review-detail.png" width="860" alt="Review detail page: verdict, score, findings with an app-test screenshot as evidence, and the agent's step-by-step timeline">
  </picture>
</p>

Someone on the team comments `lapor @chefjuno` on a pull request. A machine of yours picks up the job, reviews the PR with Claude Code or Codex, posts the findings as inline comments, then runs the app against a local emulator to try the changed flow and the findings, and attaches the screenshots. A commit status named **Chef Juno** says pass, fail or not yet tested.

> [!NOTE]
> The dashboard, the bot's PR comments and the guide inside the dashboard are in Indonesian. This README, the setup guide and the code comments meant for contributors are in English or Indonesian.

## Why

AI reviewers read diffs well and test nothing. They report bugs that are not there, miss the ones that only show up when the app runs, and give a different verdict every time you ask. Chef Juno is built around one rule: **rarely block, always prove**. A finding says whether it was measured (run and seen) or inferred (read), untested is never reported as passed, and the reviewer gets the same memory your team has instead of starting from zero on every PR.

## Features

**Goal, not a recipe**
- One agent per PR gets the goal ("is this safe to merge? prove it"), the context (PR, team rules, memory, code map) and a few hard limits. It decides how to work: how deep to go, which tests or builds to run, and whether to split the work across subagents. It runs on the strongest model of your subscription.
- `lapor @chefjuno dalam` still runs the older read-only pipeline (triage, parallel specialist passes, validation, final reviewer).
- Every P0–P2 finding is posted inline, with the consequence as the title, the mechanism, the trigger and a fix. Findings under the confidence threshold are kept in the dashboard instead of the PR.
- A re-review replaces the bot's previous inline comments unless someone replied or reacted.

**No built-in skills**
- How to review well is left to the model. Skills are for what the model cannot know: your team's conventions and the mistakes your repo keeps making. Import them from the dashboard, optionally scoped to file paths. Repo knowledge also comes from `CLAUDE.md`, `AGENTS.md`, the repo's verify skill and Chef Juno's memory.

**App testing**
- After the review is posted, a tester agent on a machine with a local emulator follows the repo's verify skill: it brings the emulator up, fixes it if it is broken, prepares the test data it needs, runs the app, tries the changed flow and the findings, and must save screenshots.
- No screenshot of the changed flow means **not tested**, never passed. A tester that skips the changed flow gets one more try with a warning.
- Screenshots appear in the PR comment and next to the findings they prove, served through signed URLs.

**Merge gate**
- Commit status **Chef Juno**: pending while the app test runs, success when the code is clean and the changed flow worked on camera, failure on a P0/P1 or a broken flow, error when it could not be tested.

**Memory that learns**
- `@chefjuno ingat <fact>` saves a fact about the repo; the tester saves what it learned (test accounts, how to seed data, quirks of the app). Facts go into every later review and test.
- Team rules, suppressions learned from disputed findings, and each author's recurring mistakes.
- A code map (symbols, callers, module summaries) the reviewer can query while it reads.

**Dashboard**
- Reviews per PR with who asked for them, the history of every review of that PR, findings and their outcomes.
- **Proses agent**: a live timeline of every step, and **Intip kerja agent** to watch the agent think, which files it reads and which commands it runs, as it happens.
- Analytics: findings and outcomes, cost and time per model and role, skills, and before/after impact of the pilot.
- Skills editor with versions, memory, knowledge base, machines and settings.

| Reviews | Analytics |
| --- | --- |
| <img src="docs/images/reviews.png" alt="List of pull requests with merge status, impact and score"> | <img src="docs/images/analytics.png" alt="Analytics: reviews, findings and their outcomes over the last two weeks"> |
| **Skills** | **Memory** |
| <img src="docs/images/skills.png" alt="Skills page: core principle skills and team domain skills, with the review prompt open in the editor"> | <img src="docs/images/memory.png" alt="Team memory: approved rules, suggestions and facts"> |

> [!NOTE]
> Screenshots use the demo data from `npm run dev`; every repository, person and machine in them is made up.

## How it works

```mermaid
flowchart LR
  GH["GitHub<br/>lapor @chefjuno"] -->|webhook| FN["Cloud Functions<br/>validate · create job"]
  FN --> FS[("Firestore<br/>jobs · findings · memory")]
  FS -->|claim| M["Your machine<br/>chefjuno daemon<br/>Claude Code / Codex"]
  M -->|"review JSON, screenshots"| FS
  FS --> FN2["Cloud Functions<br/>post comments · status"]
  FN2 --> GH
  FS --> D["Dashboard<br/>Firebase Hosting"]
```

The backend never runs a model. Reviews run on machines you register, with the CLI subscriptions you already pay for. API-key logins are refused.

## The safety model

Pull request content is untrusted: code, description, comments and even a `CLAUDE.md` changed by the PR may try to instruct the reviewer.

| Layer | What it does |
| --- | --- |
| Reviewer agent | Goal mode (default): full access on the reviewer machine so it can run tests and builds; the prompt treats PR content as data and forbids touching production, deploying, pushing or posting. PR code runs on the machine, so use it for a trusted team's repositories. `lapor @chefjuno dalam`: Claude Code with `--restricted --safe-mode` and only `Read`, `Grep`, `Glob`; Codex with `--sandbox read-only --ephemeral`. Output must match a JSON schema in both. |
| Tester agent | Trusted (it has to run the app), so it only runs where the machine owner installed a test profile in `~/.chefjuno/app-local.json`, only against a local emulator, never production, and never pushes or posts. The app it started is always stopped afterwards. |
| Daemon | Strips secrets from the agent's environment, scans results for leaked secrets before they leave the machine. |
| Activity log | Records thinking, tool names, files and commands, never tool output or file contents. Known secret patterns are redacted. |
| Functions | Only the GitHub App posts to GitHub. Secrets live in Secret Manager. |
| Firestore rules | Only team members can read; only the machine holding a running job can write its results. |

See [SECURITY.md](SECURITY.md) for what is stored where.

## Requirements

- A Firebase project on the Blaze plan (Functions, Firestore, Hosting, Auth, Secret Manager).
- A GitHub App you create, and a GitHub OAuth App for dashboard login.
- At least one reviewer machine with Node 24 and Claude Code (claude.ai subscription) or Codex (ChatGPT login). Developed and used on macOS. App-test screenshots are converted with `sips` on macOS or ImageMagick elsewhere.
- For app testing: a machine with your app's local emulator stack and a verify skill in the repo.

## Quick start (local, no cloud)

```bash
nvm use               # Node from .nvmrc
npm install
npx playwright install chromium
npm run dev           # emulators + dashboard on http://localhost:4200 + demo data + a login link
npm run verify        # guard → lint → typecheck → build → unit, emulator and e2e tests
```

Tests use fake `claude` and `codex` binaries and the `demo-chefjuno` emulator project; nothing reaches a real model or a real Firebase project.

To deploy your own instance, follow [docs/SETUP.md](docs/SETUP.md). The in-dashboard guide (`docs/guide/`, Indonesian) explains the review pipeline, memory, customization, security, commands and app testing in depth.

## Reviewer machine

```bash
npm install && npm run build -w packages/shared -w apps/daemon
node apps/daemon/dist/cli.js login --server https://<region>-<project-id>.cloudfunctions.net --code XXXX-XXXX
node apps/daemon/dist/cli.js start --agents claude,codex          # add --no-app on machines without an emulator
```

The registration code comes from **Mesin → Tambah mesin** in the dashboard; any team member can create one.

## Project layout

| Path | What |
| --- | --- |
| `apps/web` | Dashboard (Angular, signals, Material 3) |
| `apps/functions` | Cloud Functions: webhook, posting, commit status, evidence images, setup |
| `apps/daemon` | `chefjuno` CLI: machine registration, job claiming, review pipeline, app testing, code map |
| `packages/shared` | Zod schemas, comment formatting, commands, skills, models |
| `skills/` | Notes on team skills (no built-in skills) |
| `prompts/` | Default persona and review prompts |
| `docs/guide/` | The guide shown in the dashboard |

## License

[MIT](LICENSE)
