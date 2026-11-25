# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Cancel a review from its detail page (admin or whoever requested it). Its app test is cancelled too, the machine stops the agent at once, and the commit status says it was cancelled.
- A review for a newer commit of the same pull request cancels the reviews and app tests still running for older commits.

### Fixed

- App-test screenshots are converted with ImageMagick outside macOS.

## [0.1.0] - 2026-11-25

First public release.

### Added

- GitHub App webhook (`lapor @chefjuno`, `@chefjuno ingat`, `@chefjuno bantuan`), job queue in Firestore, reviewer machines that claim jobs with the `chefjuno` CLI using Claude Code or Codex subscriptions.
- One review standard: triage, parallel specialist passes, validation of P0/P1 findings, and a final reviewer. Every P0–P2 finding is posted inline; re-reviews replace the previous bot comments.
- Ten core skills (principles for evidence, root cause, contracts, domain design, finishing migrations, simplicity, code comments, signal over noise, honesty about coverage and team memory), used by the specialist passes, the validator and the final reviewer.
- App testing: a tester agent on a machine with a local emulator prepares and repairs its environment, tries the changed flow and the findings, and saves screenshots; one retry when the changed flow was not proven; leftover apps are always stopped.
- Commit status **Chef Juno** as a merge gate (pass, fail, not tested).
- Memory: facts from `@chefjuno ingat` and tester lessons, team rules, suppressions, author profiles, and a code map the reviewer can query.
- Dashboard: reviews with requester and history, live agent timeline and agent activity, findings, analytics (findings, cost, time, skills, impact), skills editor with versions, memory, knowledge base, machines, settings and an in-app guide.
- `chefjuno start --no-app` for machines without an emulator.

[Unreleased]: https://github.com/NurFajarSA/chef-juno/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NurFajarSA/chef-juno/releases/tag/v0.1.0
