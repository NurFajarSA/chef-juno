# Setting up your own Chef Juno

This guide deploys Chef Juno to a Firebase project you own and connects it to your GitHub repositories. Replace `<project-id>` with your Firebase project ID and `<site>` with your Hosting site name everywhere below.

Chef Juno uses the region `asia-southeast2` and a Firestore database named `chefjuno`. To use another region, change `REGION` in `packages/shared/src/constants.ts` and the `region` of the `/evidence` rewrite in `firebase.json`.

## 1. Firebase project

1. Create a Firebase project and switch it to the **Blaze** plan (Cloud Functions and Secret Manager need it). Set a small budget alert in Cloud Billing.
2. Add a web app, a Firestore database and a Hosting site:

   ```bash
   npx firebase apps:create web chefjuno-dashboard --project <project-id>
   npx firebase apps:sdkconfig web --project <project-id>        # note apiKey
   npx firebase firestore:databases:create chefjuno --location=asia-southeast2 --project <project-id>
   npx firebase hosting:sites:create <site> --project <project-id>
   ```

   The dashboard reads its Firebase config at runtime from `/__/firebase/init.json`, which Hosting serves for your project, so nothing project-specific goes into the code.

3. Copy `.firebaserc.example` to `.firebaserc`, fill in your project ID and site, or run:

   ```bash
   npx firebase use --add <project-id>                              # alias it "prod"
   npx firebase target:apply hosting dashboard <site> --project <project-id>
   ```

   `.firebaserc` is gitignored. `npm run setup:local` adds the emulator project to it without touching your entries.

## 2. Dashboard login (GitHub OAuth App)

1. GitHub → Settings → Developer settings → **OAuth Apps** → New:
   - Homepage URL: `https://<site>.web.app`
   - Authorization callback URL: `https://<project-id>.firebaseapp.com/__/auth/handler`
2. Firebase Console → Authentication → Sign-in method → **GitHub**: paste the OAuth App's client ID and secret.
3. Authentication → Settings → Authorized domains: add `<site>.web.app`.

Only team members can use the dashboard. The first admin is set by `BOOTSTRAP_ADMIN_GITHUB_IDS` (step 5); admins invite the rest.

## 3. GitHub App

GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App:

- Homepage URL: `https://<site>.web.app`; Setup URL (optional): `https://<site>.web.app/setup`
- Webhook: active, URL `https://asia-southeast2-<project-id>.cloudfunctions.net/githubWebhook`, secret: a long random string (`openssl rand -hex 32`). Keep it for step 6.
- Repository permissions: Contents **Read**, Issues **Read and write**, Pull requests **Read and write**, Commit statuses **Read and write**, Metadata **Read**.
- Subscribe to events: **Issue comment**, **Pull request**, **Pull request review comment**, **Push** (installation events are sent automatically).
- Where can this GitHub App be installed: **Any account** if repositories owned by another account or organization will use it.

After creating it, note the **App ID** and the slug (the end of `github.com/apps/<slug>`), and **generate a private key** (`.pem`). Never commit the key.

To review a repository owned by someone else, send them `https://github.com/apps/<slug>/installations/new`; they choose **Only select repositories**. If you add a permission later, the owner of each installation must approve it under Settings → Applications → Installed GitHub Apps.

To make the gate block merges, add **Chef Juno** as a required status check in the branch protection rule of the target branch.

## 4. Service account for Functions

Give Functions their own service account with only what they need:

```bash
gcloud iam service-accounts create chefjuno-fn --project <project-id>
gcloud services enable iamcredentials.googleapis.com --project <project-id>
SA=chefjuno-fn@<project-id>.iam.gserviceaccount.com
gcloud iam service-accounts add-iam-policy-binding $SA --member=serviceAccount:$SA \
  --role=roles/iam.serviceAccountTokenCreator --project <project-id>
gcloud projects add-iam-policy-binding <project-id> --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding <project-id> --member=serviceAccount:$SA --role=roles/firebaseauth.admin
```

Token Creator is granted on the service account itself, not on the project. It lets Functions mint custom tokens for reviewer machines.

## 5. Function parameters (not secret)

Copy `apps/functions/.env.example` to `apps/functions/.env.<project-id>` (gitignored) and fill it in:

| Parameter | Value |
| --- | --- |
| `FUNCTIONS_SA` | `chefjuno-fn@<project-id>.iam.gserviceaccount.com` |
| `BOOTSTRAP_ADMIN_GITHUB_IDS` | JSON array with the numeric GitHub user ID of the first admin (`gh api users/<login> --jq .id`) |
| `GITHUB_API_URL` | `https://api.github.com` |
| `DASHBOARD_URL` | `https://<site>.web.app` |
| `WEB_API_KEY` | The web app's `apiKey` from step 1 (public; reviewer machines need it) |
| `GITHUB_APP_SLUG` | The GitHub App slug from step 3 |

## 6. Secrets

Secrets go to Secret Manager and are prompted for, never stored in the repository:

```bash
npx firebase functions:secrets:set GITHUB_APP_ID --project <project-id>
npx firebase functions:secrets:set GITHUB_APP_PRIVATE_KEY --project <project-id> --data-file <path-to.pem>
npx firebase functions:secrets:set GITHUB_WEBHOOK_SECRET --project <project-id>
```

## 7. Deploy

```bash
npm install
npm run build
npx firebase deploy --only firestore,functions,hosting --project <project-id> --dry-run
npx firebase deploy --only firestore,functions,hosting --project <project-id>
```

Open `https://<site>.web.app` and sign in with GitHub. The first admin lands on **Setup**, which walks through installing the GitHub App, registering a reviewer machine, inviting the team and the first review.

## 8. Reviewer machines

On each machine that will review (yours or a teammate's):

1. Install Node 24 and log in to Claude Code with a claude.ai subscription (`claude auth status` shows `authMethod: "claude.ai"`) or to Codex with ChatGPT (`codex login status`). API-key logins are refused.
2. Clone this repository and build the CLI:

   ```bash
   npm install
   npm run build -w packages/shared -w apps/daemon
   ```

3. In the dashboard, **Mesin → Tambah mesin** gives a one-time code (any member can create one). Then:

   ```bash
   node apps/daemon/dist/cli.js login --server https://asia-southeast2-<project-id>.cloudfunctions.net --code XXXX-XXXX
   node apps/daemon/dist/cli.js start --agents claude,codex
   ```

   Use `--no-app` on machines without your app's emulator: they take code reviews and leave app tests to a machine that can run them.

4. On macOS, install the machine as a service with `bash scripts/install-machine.sh [--agents claude,codex] [--no-app]`.
   It runs the daemon from a dedicated clone (`~/.chefjuno/daemon`, always on `main`, separate from any checkout you
   develop in) through the LaunchAgent `ai.chefjuno.daemon` with `KeepAlive`, logging to `~/.chefjuno/daemon.log`.

5. Machines update themselves. `start` runs a small supervisor; when you publish a release after deploying
   (`node scripts/release.mjs --project <project-id> --database <id>`, which requires green CI on `main` and also
   syncs the default prompts without overwriting prompts your team changed), each
   machine finishes its running jobs, fast-forwards its checkout to the release, builds, and restarts. A checkout on
   another branch, with uncommitted changes, or with local commits is never touched: the update is skipped and the
   reason shows on the **Mesin** page. Agent prompts (method, tester, …) are versioned data edited on the **Skills**
   page and need no machine update at all. Pass `--no-auto-update` to opt out.

Reviews read the code only; consider a dedicated user account on machines that hold sensitive data, because a read-only sandbox can still read other files on the machine.

## 9. App testing (optional)

App testing needs a machine with your app's local emulator stack and a verify skill in the repository (`.claude/skills/verify/SKILL.md`) that explains how to launch and drive the app. Describe the test on that machine in `~/.chefjuno/app-local.json`, then turn on **Pengaturan → Review → Uji aplikasi**. The profile format, the tester's responsibilities and the safeguards are in the dashboard guide, page **Uji aplikasi** (`docs/guide/09-uji-aplikasi.md`).

The tester runs only against the local emulator and never against production. It brings the emulator up and repairs it itself, prepares its own test data, and records what it learned in Chef Juno's memory.
