// GitHub palsu = server HTTP terpisah (§11.1). Functions emulator diarahkan ke sini lewat GITHUB_API_URL.
// Semua data PR (diff, compare, contents) dihitung dari bare repo lokal yang sama (§12.2).
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { parseUnifiedDiff } from '../../packages/shared/dist/index.js';

export const BOT = { login: 'chefjuno[bot]', id: 424242, type: 'Bot' };
const APP = { id: 12345, slug: 'chefjuno' };

export class GithubMock {
  constructor() {
    this.reset();
  }

  reset() {
    this.repos = new Map(); // fullName → { id, bare, defaultBranch, prs: Map }
    this.issueComments = []; // { id, issueNumber, repo, body, user, ... }
    this.reviews = [];
    this.reviewComments = [];
    this.reactions = []; // { id, subject: 'issue_comment'|'review_comment', subjectId, content, user }
    this.resolvedThreads = new Set(); // reviewComment ids
    this.requests = [];
    this.nextId = 1000;
    this.failNextReview = false;
    this.statuses = []; // { repo, sha, state, context, description, target_url }
    /** simulasi GitHub App tanpa izin Commit statuses */
    this.denyStatuses = false;
    /** simulasi GitHub gangguan: tulis ke repo dibalas 502 — true = semua, RegExp = path yang cocok saja */
    this.outage = false;
  }

  id() {
    return this.nextId++;
  }

  addRepo({ fullName, id, bare, defaultBranch = 'main', installationId = 777 }) {
    this.repos.set(fullName, { fullName, id, bare, defaultBranch, installationId, prs: new Map() });
  }

  addPr(fullName, pr) {
    this.repos.get(fullName).prs.set(pr.number, { state: 'open', merged: false, draft: false, body: '', ...pr });
  }

  git(repo, ...args) {
    return execFileSync('git', args, { cwd: repo.bare, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }

  diffFor(repo, base, head) {
    return this.git(repo, 'diff', `${base}...${head}`);
  }

  prJson(repo, pr) {
    const [owner, name] = repo.fullName.split('/');
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      html_url: `https://github.example/${repo.fullName}/pull/${pr.number}`,
      user: { login: pr.author, id: pr.authorId ?? 2002, type: 'User' },
      base: { ref: pr.baseRef ?? 'main', sha: pr.baseSha, repo: { id: repo.id, full_name: repo.fullName, name, owner: { login: owner } } },
      head: { ref: pr.headRef ?? 'feature', sha: pr.headSha, repo: { id: repo.id, full_name: repo.fullName } },
      merge_commit_sha: pr.mergeSha ?? null,
      created_at: pr.createdAt ?? null,
      closed_at: pr.closedAt ?? null,
      merged_at: pr.mergedAt ?? null,
      additions: pr.additions ?? 10,
      deletions: pr.deletions ?? 2,
      changed_files: pr.changedFiles ?? 2,
    };
  }

  /** Ringkasan untuk assert di test/demo. */
  calls(method, re) {
    return this.requests.filter((r) => r.method === method && re.test(r.path));
  }

  summaryComments(fullName, number) {
    return this.issueComments.filter((c) => c.repo === fullName && c.issueNumber === number && c.body.includes('<!-- chefjuno-ai:summary -->'));
  }

  async start(port = 4010) {
    this.server = createServer((req, res) => {
      let data = '';
      req.on('data', (d) => (data += d));
      req.on('end', () => {
        let body;
        try {
          body = data ? JSON.parse(data) : null;
        } catch {
          body = data;
        }
        const url = new URL(req.url, 'http://x');
        this.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers, at: Date.now() });
        const down = this.outage instanceof RegExp ? this.outage.test(url.pathname) : this.outage;
        if (down && req.method !== 'GET' && url.pathname.startsWith('/repos/')) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'Server Error' }));
          return;
        }
        try {
          const out = this.route(req.method, url.pathname, body, req.headers, url.searchParams);
          if (out.raw !== undefined) {
            res.writeHead(out.status ?? 200, { 'content-type': out.type ?? 'text/plain' });
            res.end(out.raw);
          } else {
            res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
            res.end(out.status === 204 ? '' : JSON.stringify(out.json ?? {}));
          }
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: String(e?.message ?? e) }));
        }
      });
    });
    await new Promise((r) => this.server.listen(port, '127.0.0.1', r));
    return this;
  }

  async stop() {
    await new Promise((r) => this.server?.close(r));
  }

  route(method, path, body, headers, qs) {
    let m;
    const repoOf = (o, r) => {
      const repo = this.repos.get(`${o}/${r}`);
      if (!repo) throw Object.assign(new Error('repo tidak ada'), { status: 404 });
      return repo;
    };
    if (method === 'POST' && (m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path))) {
      return { status: 201, json: { token: `ghs_FAKEinstallationtoken${m[1]}abcdefghij`, expires_at: new Date(Date.now() + 3600_000).toISOString(), permissions: body?.permissions ?? {} } };
    }
    if (method === 'GET' && (m = /^\/users\/([^/]+)$/.exec(path))) {
      const known = { admin1: 1001, dev2: 2002, dev3: 3003 };
      const id = known[m[1]] ?? 5000 + m[1].length;
      return { json: { login: m[1], id, avatar_url: '', type: 'User' } };
    }
    if (method === 'POST' && path === '/graphql') {
      // reviewThreads untuk collectFeedback (§6.8)
      const nodes = this.reviewComments.map((c) => ({
        isResolved: this.resolvedThreads.has(c.id),
        comments: { nodes: [{ databaseId: c.id }] },
      }));
      return { json: { data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: false } } } } } } };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/branches\/(.+)$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const name = decodeURIComponent(m[3]);
      try {
        const sha = this.git(repo, 'rev-parse', '--verify', `refs/heads/${name}`).trim();
        return { json: { name, commit: { sha } } };
      } catch {
        return { status: 404, json: { message: 'Branch not found' } };
      }
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      return { json: { id: repo.id, full_name: repo.fullName, private: true, default_branch: repo.defaultBranch } };
    }
    // daftar PR (riwayat untuk Analitik → Dampak)
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const state = qs?.get('state') ?? 'open';
      const list = [...repo.prs.values()].filter((pr) => state === 'all' || (state === 'closed' ? pr.state === 'closed' : pr.state !== 'closed'));
      return { json: list.map((pr) => this.prJson(repo, pr)) };
    }
    // review manusia (diset test lewat pr.humanReviews) + review bot Chef Juno
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const pr = repo.prs.get(Number(m[3]));
      const bot = this.reviews.filter((r) => r.repo === repo.fullName && r.prNumber === Number(m[3])).map((r) => ({ ...r, submitted_at: new Date().toISOString(), state: 'COMMENTED' }));
      return { json: [...(pr?.humanReviews ?? []), ...bot] };
    }
    // commit di sebuah branch (git log repo fixture)
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/commits$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const out = this.git(repo, 'log', '--format=%H%x1f%cI%x1f%B%x1e', qs?.get('sha') ?? repo.defaultBranch);
      const list = out
        .split('\x1e')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [sha, date, message] = x.split('\x1f');
          return { sha, commit: { message: message.trim(), committer: { date } } };
        });
      return { json: list };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const pr = repo.prs.get(Number(m[3]));
      if (!pr) return { status: 404, json: { message: 'Not Found' } };
      if (String(headers.accept ?? '').includes('diff')) return { raw: this.diffFor(repo, pr.baseSha, pr.headSha), type: 'text/x-diff' };
      return { json: this.prJson(repo, pr) };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      const diff = this.diffFor(repo, m[3], m[4]);
      if (String(headers.accept ?? '').includes('diff')) return { raw: diff, type: 'text/x-diff' };
      const files = [...parseUnifiedDiff(diff).values()].map((f) => ({ filename: f.path, status: f.deleted ? 'removed' : 'modified' }));
      return { json: { files, status: 'ahead' } };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(path)) && method === 'GET') {
      const repo = repoOf(m[1], m[2]);
      try {
        const content = this.git(repo, 'show', `${qs.get('ref') ?? repo.defaultBranch}:${m[3]}`);
        return { json: { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') } };
      } catch {
        return { status: 404, json: { message: 'Not Found' } };
      }
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/statuses\/([0-9a-f]+)$/.exec(path)) && method === 'POST') {
      if (this.denyStatuses) return { status: 403, json: { message: 'Resource not accessible by integration' } };
      const st = { id: this.id(), repo: `${m[1]}/${m[2]}`, sha: m[3], state: body.state, context: body.context, description: body.description, target_url: body.target_url ?? null };
      this.statuses.push(st);
      return { status: 201, json: st };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)\/reactions$/.exec(path))) {
      if (method === 'POST') {
        const existing = this.reactions.find((r) => r.subject === 'issue_comment' && r.subjectId === Number(m[3]) && r.content === body.content && r.user.login === BOT.login);
        if (existing) return { status: 200, json: existing };
        const r = { id: this.id(), subject: 'issue_comment', subjectId: Number(m[3]), content: body.content, user: BOT };
        this.reactions.push(r);
        return { status: 201, json: r };
      }
      if (method === 'GET') return { json: this.reactions.filter((r) => r.subject === 'issue_comment' && r.subjectId === Number(m[3])) };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)\/reactions\/(\d+)$/.exec(path)) && method === 'DELETE') {
      this.reactions = this.reactions.filter((r) => r.id !== Number(m[4]));
      return { status: 204 };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/comments\/(\d+)\/reactions$/.exec(path)) && method === 'GET') {
      return { json: this.reactions.filter((r) => r.subject === 'review_comment' && r.subjectId === Number(m[3])) };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/.exec(path))) {
      const repo = repoOf(m[1], m[2]);
      if (method === 'GET') return { json: this.issueComments.filter((c) => c.repo === repo.fullName && c.issueNumber === Number(m[3])) };
      if (method === 'POST') {
        const c = {
          id: this.id(),
          repo: repo.fullName,
          issueNumber: Number(m[3]),
          body: body.body,
          user: BOT,
          performed_via_github_app: APP,
          html_url: `https://github.example/${repo.fullName}/pull/${m[3]}#issuecomment-${this.nextId}`,
        };
        this.issueComments.push(c);
        return { status: 201, json: c };
      }
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const c = this.reviewComments.find((x) => x.id === Number(m[3]));
      if (!c) return { status: 404, json: { message: 'Not Found' } };
      c.body = body.body;
      return { json: c };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/.exec(path)) && method === 'GET') {
      const c = this.issueComments.find((x) => x.id === Number(m[3]));
      return c ? { json: c } : { status: 404, json: { message: 'Not Found' } };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const c = this.issueComments.find((x) => x.id === Number(m[3]));
      if (!c) return { status: 404, json: { message: 'Not Found' } };
      c.body = body.body;
      c.updated = (c.updated ?? 0) + 1;
      return { json: c };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/.exec(path)) && method === 'POST') {
      const repo = repoOf(m[1], m[2]);
      const pr = repo.prs.get(Number(m[3]));
      const files = parseUnifiedDiff(this.diffFor(repo, pr.baseSha, pr.headSha));
      const comments = body.comments ?? [];
      if (this.failNextReview && comments.length) {
        this.failNextReview = false;
        return { status: 422, json: { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] } };
      }
      for (const c of comments) {
        if ('position' in c) return { status: 422, json: { message: 'position tidak didukung mock (pakai line+side)' } };
        const f = files.get(c.path);
        const ok = f && c.side === 'RIGHT' && f.rightLines.has(c.line) && (c.start_line == null || f.rightLines.has(c.start_line));
        if (!ok) return { status: 422, json: { message: 'Unprocessable Entity', errors: [`Line ${c.path}:${c.line} could not be resolved`] } };
      }
      const review = { id: this.id(), repo: repo.fullName, prNumber: pr.number, body: body.body, event: body.event, commit_id: body.commit_id, user: BOT };
      this.reviews.push(review);
      for (const c of comments) {
        const id = this.id();
        this.reviewComments.push({
          id,
          reviewId: review.id,
          repo: repo.fullName,
          prNumber: pr.number,
          path: c.path,
          line: c.line,
          start_line: c.start_line ?? null,
          side: c.side,
          body: c.body,
          user: BOT,
          commit_id: body.commit_id,
          html_url: `https://github.example/${repo.fullName}/pull/${pr.number}#discussion_r${id}`,
        });
      }
      return { json: review };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews\/(\d+)\/comments$/.exec(path)) && method === 'GET') {
      return { json: this.reviewComments.filter((c) => c.reviewId === Number(m[4])) };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/.exec(path)) && method === 'GET') {
      // seperti GitHub: jumlah reaksi per komentar ikut dikirim
      return {
        json: this.reviewComments
          .filter((c) => c.repo === `${m[1]}/${m[2]}` && c.prNumber === Number(m[3]))
          .map((c) => ({
            ...c,
            reactions: { total_count: this.reactions.filter((r) => r.subject === 'review_comment' && r.subjectId === c.id).length },
          })),
      };
    }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/comments\/(\d+)$/.exec(path)) && method === 'DELETE') {
      const before = this.reviewComments.length;
      this.reviewComments = this.reviewComments.filter((c) => c.id !== Number(m[3]));
      return before === this.reviewComments.length ? { status: 404, json: { message: 'Not Found' } } : { status: 204 };
    }
    return { status: 404, json: { message: `mock: route tidak dikenal ${method} ${path}` } };
  }
}
