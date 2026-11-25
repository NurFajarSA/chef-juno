import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, githubApiUrl } from './params.js';

let _app: App<{ Octokit: typeof Octokit }> | null = null;

/** GitHub App client. Private key hanya ada di Functions (Secret Manager). */
export function githubApp() {
  if (!_app) {
    const OctokitWithBase = Octokit.defaults({ baseUrl: githubApiUrl() });
    _app = new App({
      appId: GITHUB_APP_ID.value().trim(),
      privateKey: GITHUB_APP_PRIVATE_KEY.value().replace(/\\n/g, '\n'),
      Octokit: OctokitWithBase,
    });
  }
  return _app;
}

export type GH = Octokit;

export async function installationOctokit(installationId: number): Promise<GH> {
  return (await githubApp().getInstallationOctokit(installationId)) as unknown as GH;
}

/** Token read-only berumur pendek, khusus satu repo (§6.3.2). */
export async function createRepoReadToken(installationId: number, repoId: number) {
  const res = await githubApp().octokit.request('POST /app/installations/{installation_id}/access_tokens', {
    installation_id: installationId,
    repository_ids: [repoId],
    permissions: { contents: 'read' },
  });
  return { token: res.data.token as string, expiresAt: res.data.expires_at as string };
}

/** Resolve login → ID (endpoint publik). */
export async function githubUserByLogin(
  login: string,
): Promise<{ id: number; login: string; avatar_url: string } | null> {
  const res = await fetch(`${githubApiUrl()}/users/${encodeURIComponent(login)}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'chefjuno-ai' },
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: number; login: string; avatar_url: string };
}
