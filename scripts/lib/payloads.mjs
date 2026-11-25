// Payload webhook GitHub dibangkitkan dari template (bentuk mengikuti payload asli; contoh di apps/functions/test/fixtures/).
import { createHmac, randomUUID } from 'node:crypto';

export const INSTALLATION_ID = 777;

export function repoJson(fullName, id) {
  const [owner, name] = fullName.split('/');
  return {
    id,
    node_id: 'R_fake',
    name,
    full_name: fullName,
    private: true,
    owner: { login: owner, id: 9000, type: 'Organization' },
    html_url: `https://github.example/${fullName}`,
    default_branch: 'main',
  };
}

export function issueComment({ fullName, repoId, prNumber, body, login = 'dev2', userId = 2002, association = 'MEMBER', commentId, userType = 'User' }) {
  const id = commentId ?? Math.floor(Math.random() * 1e9);
  return {
    action: 'created',
    issue: {
      number: prNumber,
      title: 'feat: cache option untuk fetchUser',
      pull_request: { url: `https://api.github.example/repos/${fullName}/pulls/${prNumber}`, html_url: `https://github.example/${fullName}/pull/${prNumber}` },
      user: { login, id: userId, type: 'User' },
      state: 'open',
    },
    comment: {
      id,
      body,
      html_url: `https://github.example/${fullName}/pull/${prNumber}#issuecomment-${id}`,
      user: { login, id: userId, type: userType },
      author_association: association,
      created_at: new Date().toISOString(),
    },
    repository: repoJson(fullName, repoId),
    sender: { login, id: userId, type: userType },
    installation: { id: INSTALLATION_ID },
  };
}

export function pullRequestClosed({ fullName, repoId, prNumber, merged = true, headSha, baseSha, mergeSha = null, title = 'feat: cache option untuk fetchUser', login = 'dev2' }) {
  return {
    action: 'closed',
    number: prNumber,
    pull_request: {
      number: prNumber,
      title,
      state: 'closed',
      merged,
      merge_commit_sha: mergeSha,
      user: { login, id: 2002 },
      head: { sha: headSha, ref: 'feat/cache-user' },
      base: { sha: baseSha, ref: 'main' },
    },
    repository: repoJson(fullName, repoId),
    installation: { id: INSTALLATION_ID },
  };
}

export function push({ fullName, repoId, before, after, ref = 'refs/heads/main' }) {
  return { ref, before, after, repository: repoJson(fullName, repoId), installation: { id: INSTALLATION_ID }, commits: [] };
}

export function installationRepositories({ fullName, repoId }) {
  return {
    action: 'added',
    installation: { id: INSTALLATION_ID },
    repositories_added: [{ id: repoId, name: fullName.split('/')[1], full_name: fullName, private: true }],
    repositories_removed: [],
  };
}

export function reviewCommentReply({ fullName, repoId, prNumber, inReplyTo, body, login = 'dev2', userId = 2002 }) {
  const id = Math.floor(Math.random() * 1e9);
  return {
    action: 'created',
    comment: { id, in_reply_to_id: inReplyTo, body, user: { login, id: userId, type: 'User' }, created_at: new Date().toISOString() },
    pull_request: { number: prNumber },
    repository: repoJson(fullName, repoId),
    installation: { id: INSTALLATION_ID },
  };
}

export function sign(raw, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
}

/** Kirim webhook ke Functions emulator. */
export async function sendWebhook(base, event, payload, { secret = 'demo-webhook-secret', delivery = randomUUID(), badSignature = false } = {}) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${base}/githubWebhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      'x-hub-signature-256': badSignature ? sign(raw, 'salah') : sign(raw, secret),
      'user-agent': 'GitHub-Hookshot/fake',
    },
    body: raw,
  });
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, delivery };
}
