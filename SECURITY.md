# Security

Chef Juno reads pull requests on behalf of your team, runs AI agents on your machines, and posts to GitHub through your GitHub App. This page says what it stores, where, and how to report a problem.

## What it stores and where

| Data | Location | Notes |
| --- | --- | --- |
| GitHub App ID, private key, webhook secret | Secret Manager of your Firebase project | Never in the repository or in Firestore. |
| Members, settings, prompts, skills, memory | Firestore database `chefjuno` | Readable by team members only (security rules). |
| Jobs and results | Firestore `jobs` | PR metadata, findings, timeline, agent activity, app-test result. |
| App-test screenshots | Firestore `jobs/{id}/evidence` (JPEG) | Shown in PR comments through `/evidence` URLs signed with a key derived from the webhook secret. |
| Agent activity | Firestore `jobs/{id}/activity` | Thinking, tool names, files read and commands run. Never tool output or file contents. Known secret patterns (tokens, private keys, `password=`…) are redacted; long text is clipped. |
| Machine credentials | `~/.chefjuno/credentials.json` on each reviewer machine | Machine ID and secret from registration. `chefjuno logout` removes them. |
| Repository checkouts | `~/.chefjuno/work` (clones), `~/.chefjuno/jobs` (per-job worktrees) on each reviewer machine | Worktrees are removed after each job. |
| Code map | `~/.chefjuno/index/<repo>/graph.db` on each reviewer machine | Symbols, callers and module summaries of the repositories it indexed. |
| App-test profile | `~/.chefjuno/app-local.json` on the testing machine | Written by the machine owner; a pull request cannot change it. |

There is no telemetry and no server of this project. Model calls go from your machines to Anthropic or OpenAI through the Claude Code or Codex CLI you logged in to.

## Trust boundaries

- **Pull request content is untrusted.** The reviewer agent runs read-only (Claude Code `--restricted --safe-mode` with `Read`, `Grep`, `Glob`; Codex `--sandbox read-only`), with user customizations off and output forced to a JSON schema. Results are scanned for secrets before they leave the machine.
- **The app tester is trusted.** It has to run the app, so it can run commands. It only runs where the machine owner installed a test profile, only against a local emulator, and it never pushes or posts. Run it on a machine where that is acceptable.
- **A read-only sandbox can still read the machine.** Use a dedicated account for reviewer machines that hold sensitive data.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability). Include the commit, what you did and what happened, with real repository names and secrets removed. You should get a reply within a week.
