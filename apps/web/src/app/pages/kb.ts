import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { collection, doc, orderBy, query } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CjPage } from '../ui/page';
import { CjSelect } from '../ui/select';
import { CjChip, STATUS_TONE } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { CjSystemMap } from '../ui/system-map';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveDoc, liveQuery } from '../core/live';
import { fmtDate, fmtInt, fmtPct, toMs } from '../core/format';
import { miniMarkdown } from '../core/md';
import { ConnectAgentDialog } from './connect-agent-dialog';

export const INDEX_LABEL: Record<string, string> = { none: 'Belum di-index', queued: 'Antre index', indexing: 'Sedang index', ready: 'Siap', failed: 'Gagal' };
const LANG: Record<string, string> = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', vue: 'Vue', py: 'Python', go: 'Go' };

interface ModuleRow {
  id: string;
  path: string;
  summary: string;
  keyFiles: string[];
  exports: string[];
  dependsOn: string[];
  dependents: string[];
  files: number;
  symbols: number;
  updatedAtMs: number | null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dokumen repo ditampilkan apa adanya
type RepoDoc = Record<string, any>;

/** Knowledge Base (ala Greptile): wiki per repo dari code map + ringkasan modul. */
@Component({
  selector: 'cj-kb',
  imports: [CjPage, CjSelect, CjChip, CjEmptyState, CjSystemMap, RouterLink, RouterLinkActive, MatButton, MatDialogModule],
  template: `
    <cj-page [heading]="current() ? current()!.path : 'Knowledge Base'" [crumbs]="current() ? crumbs() : []">
      <button actions matButton="tonal" (click)="connect()" data-testid="connect-agent">
        <span class="material-symbols-rounded" aria-hidden="true">cable</span> Hubungkan ke agent
      </button>
      @if (auth.isAdmin() && repo()) {
        <button actions matButton (click)="reindex()" [disabled]="busy()" data-testid="reindex">
          <span class="material-symbols-rounded" aria-hidden="true">refresh</span> Index ulang
        </button>
      }
      @if (!repos().loading && !repos().data.length) {
        <div class="cj-card"><cj-empty-state icon="menu_book" title="Belum ada repositori" text="Pasang GitHub App chefjuno ke repo tim; knowledge base dibangun otomatis dari code map." /></div>
      } @else {
        <div class="layout">
          <aside class="tree" aria-label="Dokumen">
            <div class="repo-pick">
              <span class="cj-muted">Repositori</span>
              <cj-select label="Repositori" [options]="repoOpts()" [value]="repoId()" (valueChange)="goRepo($event)" testId="kb-repo" />
            </div>
            <div class="group">Ikhtisar</div>
            <a [routerLink]="['/kb', repoId()]" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Ringkasan repositori</a>
            <div class="group">Modul <span class="cj-muted">{{ modules().data.length }}</span></div>
            @for (m of modules().data; track m.id) {
              <a [routerLink]="['/kb', repoId(), m.id]" routerLinkActive="active">{{ m.path }}</a>
            }
          </aside>
          <article class="doc">
            @if (current(); as m) {
              <div class="cj-prose" data-testid="module-doc">
                <p class="cj-muted updated">Diperbarui {{ date(m.updatedAtMs) }} · {{ m.files }} file · {{ m.symbols }} simbol</p>
                <h2 class="doc-title">{{ m.path }}</h2>
                <div [innerHTML]="md(m.summary || 'Belum ada ringkasan.')"></div>
                <h2>File kunci</h2>
                <ul>@for (f of m.keyFiles; track f) {<li><code>{{ f }}</code></li>}</ul>
                <h2>Simbol yang diekspor</h2>
                <div class="cj-row-actions">@for (e of m.exports; track e) {<cj-chip>{{ e }}</cj-chip>} @empty {<span class="cj-muted">—</span>}</div>
                <h2>Bergantung pada</h2>
                <div class="cj-row-actions">@for (d of m.dependsOn; track d) {<a class="pill" [routerLink]="['/kb', repoId(), idOf(d)]">{{ d }}</a>} @empty {<span class="cj-muted">—</span>}</div>
                <h2>Dipakai oleh</h2>
                <div class="cj-row-actions">@for (d of m.dependents; track d) {<a class="pill" [routerLink]="['/kb', repoId(), idOf(d)]">{{ d }}</a>} @empty {<span class="cj-muted">—</span>}</div>
              </div>
            } @else if (repo(); as r) {
              @let ix = r['index'] ?? {};
              <div class="cj-prose" data-testid="repo-overview">
                <p class="cj-muted updated">Basis pengetahuan diperbarui: {{ date(ix.indexedAt) }}</p>
                <h2 class="doc-title">{{ r['fullName'] }}</h2>
                <div class="cj-row-actions">
                  <cj-chip [tone]="tone(ix.status ?? 'none')" icon="account_tree">{{ idx(ix.status ?? 'none') }}</cj-chip>
                  <cj-chip icon="call_split" data-testid="kb-branch">branch {{ branchOf(r) }}</cj-chip>
                  @if (ix.indexedSha) {<cj-chip>commit {{ ix.indexedSha.slice(0, 7) }}</cj-chip>}
                </div>
                @if (auth.isAdmin()) {
                  <form class="branch-form" (submit)="$event.preventDefault(); saveBranch()">
                    <label for="kb-branch-input">Branch knowledge base</label>
                    <div class="branch-row">
                      <input id="kb-branch-input" class="branch-in" [value]="branchDraft()" (input)="branchDraft.set($any($event.target).value)" [placeholder]="r['defaultBranch'] ?? 'main'" spellcheck="false" autocomplete="off" data-testid="kb-branch-input" />
                      <button matButton type="submit" [disabled]="busy() || branchDraft().trim() === branchOf(r)" data-testid="kb-branch-save">Simpan &amp; index ulang</button>
                    </div>
                    <p class="cj-muted small">Code map dibangun dari branch ini, mis. <code>rewrite/masterpiece</code> saat kode sedang ditulis ulang. Kosongkan untuk memakai branch utama (<code>{{ r['defaultBranch'] ?? 'main' }}</code>). Review PR tetap membandingkan dengan branch tujuan PR masing-masing.</p>
                  </form>
                }
                <h2>Orientasi</h2>
                <p data-testid="kb-orientation">{{ orientation() }}</p>
              </div>
              <h2 class="map-title">System map</h2>
              @if (modules().data.length) {
                <div class="cj-card map"><cj-system-map [nodes]="nodes()" [edges]="edges()" [selected]="sel()" (select)="openModule($event)" /></div>
                <p class="cj-muted small">Panah = "bergantung pada" (makin tebal = makin banyak dependensi). Klik kotak modul untuk membuka halamannya; kotak bergaris putus-putus adalah area — klik untuk melihat modul di dalamnya.</p>
              } @else {
                <div class="cj-card"><cj-empty-state icon="hub" title="Belum ada modul" text="Jalankan index untuk membangun code map." /></div>
              }
              <div class="cj-prose">
                <h2>Statistik code map</h2>
                <div class="cj-grid stats" data-testid="index-stats">
                  <div class="cj-card cj-stat"><span class="label">File</span><span class="value">{{ int(ix.stats?.files) }}</span></div>
                  <div class="cj-card cj-stat"><span class="label">Simbol</span><span class="value">{{ int(ix.stats?.symbols) }}</span></div>
                  <div class="cj-card cj-stat"><span class="label">Edge</span><span class="value">{{ int(ix.stats?.edges) }}</span><span class="sub">{{ pct(ix.stats?.resolvedEdgePct) }} ter-resolve</span></div>
                </div>
                <h2>Modul</h2>
                <ul class="mods">
                  @for (m of modules().data; track m.id) {
                    <li><a [routerLink]="['/kb', repoId(), m.id]"><strong>{{ m.path }}</strong></a> — {{ firstLine(m.summary) }}</li>
                  }
                </ul>
              </div>
            }
          </article>
        </div>
      }
    </cj-page>
  `,
  styles: `
    .branch-form { margin: 12px 0 4px; display: grid; gap: 6px; max-width: 640px; }
    .branch-form label { font: var(--mat-sys-label-large); }
    .branch-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .branch-in { flex: 1 1 260px; height: 40px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--mat-sys-outline); background: var(--mat-sys-surface-container-lowest); color: var(--mat-sys-on-surface); font: var(--mat-sys-body-large); font-family: 'Google Sans Code', ui-monospace, monospace; }
    .branch-in:focus { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 24px; }
    .tree { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 8px; align-self: start; max-height: calc(100vh - 120px); overflow-y: auto; }
    .repo-pick { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .repo-pick select { width: 100%; }
    .group { font: var(--mat-sys-label-large); margin: 12px 0 4px; padding: 0 12px; }
    .tree a { text-decoration: none; color: var(--mat-sys-on-surface-variant); padding: 8px 12px; border-radius: 999px; font: var(--mat-sys-body-medium); }
    .tree a:hover { background: var(--mat-sys-surface-container-high); }
    .tree a.active { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font-weight: 600; }
    .updated { font-style: italic; margin: 0; }
    .doc-title { font: var(--mat-sys-headline-medium); margin: 4px 0 12px; }
    .map-title { font: var(--mat-sys-title-large); margin: 28px 0 10px; }
    .map { padding: 12px; }
    .small { font: var(--mat-sys-body-small); }
    .stats { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
    .pill { text-decoration: none; background: var(--mat-sys-surface-container-high); border-radius: 999px; padding: 4px 12px; font: var(--mat-sys-label-large); }
    .mods li { margin: 6px 0; }
    .mods a { color: var(--mat-sys-primary); }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .tree { position: static; max-height: none; } }
  `,
})
export class KbPage {
  private readonly fb = inject(FirebaseService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  readonly repoId = input<string>('');
  readonly moduleId = input<string>('');
  protected readonly busy = signal(false);
  protected readonly repoOpts = computed(() => this.repos().data.map((r) => ({ value: r.id, label: r.fullName })));
  protected readonly repos = liveQuery(() => query(collection(this.fb.db, 'repos'), orderBy('fullName')), (id, d) => ({ id, fullName: d['fullName'] as string }));
  protected readonly repoDoc = liveDoc<RepoDoc>(() => (this.repoId() ? doc(this.fb.db, `repos/${this.repoId()}`) : null), (_i, d) => d);
  protected readonly repo = computed(() => this.repoDoc().data);
  protected readonly modules = liveQuery<ModuleRow>(
    () => (this.repoId() ? collection(this.fb.db, `repos/${this.repoId()}/modules`) : null),
    (id, d) => ({
      id,
      path: d['path'] ?? id,
      summary: d['summary'] ?? '',
      keyFiles: d['keyFiles'] ?? [],
      exports: d['exports'] ?? [],
      dependsOn: d['dependsOn'] ?? [],
      dependents: d['dependents'] ?? [],
      files: d['stats']?.files ?? 0,
      symbols: d['stats']?.symbols ?? 0,
      updatedAtMs: toMs(d['updatedAt']),
    }),
  );
  protected readonly current = computed(() => (this.moduleId() ? (this.modules().data.find((m) => m.id === this.moduleId()) ?? null) : null));
  protected readonly sel = computed(() => this.current()?.path ?? null);
  protected readonly nodes = computed(() => this.modules().data.map((m) => ({ id: m.path, label: m.path })));
  protected readonly edges = computed(() => this.modules().data.flatMap((m) => m.dependsOn.map((to) => ({ from: m.path, to }))));
  protected readonly crumbs = computed(() => {
    const name = this.repos().data.find((r) => r.id === this.repoId())?.fullName;
    const base = [{ label: 'Knowledge Base', link: '/kb' }];
    if (!name) return base;
    return this.current() ? [...base, { label: name, link: `/kb/${this.repoId()}` }] : [...base, { label: name }];
  });
  protected readonly orientation = computed(() => {
    const r = this.repo();
    const s = r?.['index']?.stats;
    const mods = this.modules().data;
    if (!s) return 'Code map repo ini belum dibangun.';
    const langs = Object.entries((s.languages ?? {}) as Record<string, number>)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${LANG[k] ?? k} (${n} file)`);
    const hubs = [...mods].sort((a, b) => b.dependents.length - a.dependents.length).filter((m) => m.dependents.length).slice(0, 2).map((m) => m.path);
    return `${r?.['fullName']} terdiri dari ${mods.length} modul dengan ${fmtInt(s.files)} file dan ${fmtInt(s.symbols)} simbol${langs.length ? `, ditulis dalam ${langs.join(', ')}` : ''}.${
      hubs.length ? ` Modul yang paling banyak dipakai modul lain: ${hubs.join(' dan ')} — perubahan di sana berdampak luas.` : ''
    }`;
  });

  constructor() {
    // /kb tanpa repo → buka repo pertama
    effect(() => {
      const first = this.repos().data[0];
      if (!this.repoId() && first) void this.router.navigate(['/kb', first.id], { replaceUrl: true });
    });
  }

  protected md = miniMarkdown;
  protected tone = (s: string) => STATUS_TONE[s] ?? 'neutral';
  protected idx = (s: string) => INDEX_LABEL[s] ?? s;
  protected int = fmtInt;
  protected pct = fmtPct;
  protected date = (t: unknown) => fmtDate(toMs(t as never));
  protected firstLine = (s: string) => (s || 'Belum ada ringkasan.').split('\n')[0].slice(0, 180);
  protected idOf = (path: string) => this.modules().data.find((m) => m.path === path)?.id ?? path;

  goRepo(id: string) {
    void this.router.navigate(['/kb', id]);
  }
  openModule(path: string) {
    void this.router.navigate(['/kb', this.repoId(), this.idOf(path)]);
  }
  connect() {
    this.dialog.open(ConnectAgentDialog, { width: '640px', maxWidth: '95vw', data: { repoId: this.repoId(), repo: this.repo()?.['fullName'] ?? '' } });
  }
  protected branchOf = (r: RepoDoc) => String((r?.['indexBranch'] as string | undefined)?.trim() || r?.['defaultBranch'] || 'main');
  protected readonly branchDraft = linkedSignal(() => (this.repo() ? this.branchOf(this.repo()!) : ''));
  async saveBranch() {
    const r = this.repo();
    if (!r) return;
    const want = this.branchDraft().trim();
    this.busy.set(true);
    try {
      const res = await this.fb.call<{ repoId: number; branch: string }, { jobId: string; branch: string }>('setIndexBranch')({
        repoId: Number(this.repoId()),
        branch: want === (r['defaultBranch'] ?? 'main') ? '' : want,
      });
      this.snack.open(`Knowledge base memakai branch ${res.branch}. Index ulang dijadwalkan.`, 'Tutup', { duration: 5000 });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
  async reindex() {
    this.busy.set(true);
    try {
      await this.fb.call<{ repoId: number }, { jobId: string }>('requestReindex')({ repoId: Number(this.repoId()) });
      this.snack.open('Index ulang dijadwalkan.', 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
}
