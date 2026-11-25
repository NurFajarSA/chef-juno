import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { MatTooltip } from '@angular/material/tooltip';
import { CjPage } from '../ui/page';
import { CjChip, type ChipTone } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveQuery } from '../core/live';
import { nowSignal } from '../core/now';
import { fmtRelative } from '../core/format';
import { jobRow, type JobRow } from '../core/rows';

/** Status merge yang diturunkan dari review terakhir sebuah PR. */
export type MergeStatus = 'ready' | 'fix' | 'partial' | 'reviewing' | 'failed' | 'merged' | 'closed' | 'cancelled';
export const MERGE_LABEL: Record<MergeStatus, string> = {
  ready: 'Siap merge',
  fix: 'Perlu perbaikan',
  partial: 'Review sebagian',
  reviewing: 'Sedang direview',
  failed: 'Review gagal',
  merged: 'Sudah di-merge',
  closed: 'Ditutup',
  cancelled: 'Dibatalkan',
};
const MERGE_ICON: Record<MergeStatus, string> = {
  ready: 'check_circle',
  fix: 'warning',
  partial: 'rule',
  reviewing: 'progress_activity',
  failed: 'error',
  merged: 'merge',
  closed: 'block',
  cancelled: 'cancel',
};
const MERGE_TONE: Record<MergeStatus, ChipTone> = { ready: 'success', fix: 'warning', partial: 'warning', reviewing: 'primary', failed: 'error', merged: 'tertiary', closed: 'neutral', cancelled: 'neutral' };
const IMPACT: Record<string, { label: string; icon: string }> = {
  P0: { label: 'Kritis', icon: 'signal_cellular_alt' },
  P1: { label: 'Tinggi', icon: 'signal_cellular_alt_2_bar' },
  P2: { label: 'Sedang', icon: 'signal_cellular_alt_1_bar' },
};

export interface PrRow {
  key: string;
  latest: JobRow;
  reviews: number;
  status: MergeStatus;
  open: boolean;
}

export function mergeStatus(j: JobRow): MergeStatus {
  if (j.prState === 'merged') return 'merged';
  if (j.prState === 'closed') return 'closed';
  if (['queued', 'claimed', 'running'].includes(j.status)) return 'reviewing';
  if (j.status === 'failed') return 'failed';
  if (j.status === 'cancelled') return 'cancelled';
  if ((j.score ?? 0) < 4) return 'fix';
  // review sebagian tidak pernah "siap merge"
  return j.incomplete ? 'partial' : 'ready';
}

/** Kelompokkan job review per PR (repo#nomor), ambil yang terbaru. */
export function groupPrs(jobs: JobRow[]): PrRow[] {
  const m = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const k = `${j.repo}#${j.prNumber}`;
    m.set(k, [...(m.get(k) ?? []), j]);
  }
  return [...m.entries()]
    .map(([key, js]) => {
      const sorted = [...js].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
      const latest = sorted[0];
      // PR dianggap ditutup kalau job mana pun mencatat state closed/merged
      const closedJob = sorted.find((x) => x.prState !== 'open');
      const eff = closedJob ? { ...latest, prState: closedJob.prState } : latest;
      const status = mergeStatus(eff);
      return { key, latest: eff, reviews: js.length, status, open: eff.prState === 'open' };
    })
    .sort((a, b) => (b.latest.createdAtMs ?? 0) - (a.latest.createdAtMs ?? 0));
}

/** Review Kode — daftar PR (layout ala Greptile "Code Review"). */
@Component({
  selector: 'cj-reviews',
  imports: [CjPage, CjChip, CjEmptyState, RouterLink, MatTooltip],
  template: `
    <cj-page heading="Review Kode">
      <div class="top">
        <label class="cj-search"><span class="material-symbols-rounded" aria-hidden="true">search</span>
          <input placeholder="Cari pull request, repo, atau penulis…" (input)="setQ($any($event.target).value)" aria-label="Cari pull request" data-testid="reviews-filter" /></label>
        <div class="cj-seg" role="group" aria-label="Status PR">
          <button type="button" [class.on]="open()" (click)="setOpen(true)" data-testid="tab-open"><span class="material-symbols-rounded" aria-hidden="true">merge_type</span> Terbuka <span class="n">{{ openCount() }}</span></button>
          <button type="button" [class.on]="!open()" (click)="setOpen(false)" data-testid="tab-closed"><span class="material-symbols-rounded" aria-hidden="true">call_merge</span> Ditutup <span class="n">{{ closedCount() }}</span></button>
        </div>
      </div>
      <div class="cj-suggest" aria-label="Filter saran">
        <span class="cj-muted">Saran</span>
        @if (me()) {<button type="button" [class.on]="mine()" (click)="mine.set(!mine())">penulis <b>kamu</b></button>}
        <button type="button" [class.on]="needsFix()" (click)="needsFix.set(!needsFix())">status <b>perlu perbaikan</b></button>
        <button type="button" [class.on]="highImpact()" (click)="highImpact.set(!highImpact())">dampak <b>tinggi atau kritis</b></button>
        @for (r of topRepos(); track r) {
          <button type="button" [class.on]="repo() === r" (click)="repo.set(repo() === r ? '' : r)">repo <b>{{ r }}</b></button>
        }
      </div>
      @if (jobs().loading) {
        <div class="cj-skeleton" style="height: 240px; margin-top: 16px"></div>
      } @else if (!filtered().length) {
        <div class="cj-card empty"><cj-empty-state icon="rate_review" title="Tidak ada pull request" text="Tulis lapor @chefjuno di PR yang siap review, atau ubah filter." /></div>
      } @else {
        <div class="list" role="table" aria-label="Pull request" data-testid="reviews-table">
          <div class="row head" role="row"><span role="columnheader">Pull request</span><span role="columnheader">Status merge</span><span role="columnheader" class="act">Aksi</span></div>
          @for (p of page(); track p.key) {
            <div class="row" role="row" [attr.data-pr]="p.key">
              <div role="cell" class="main">
                <a class="title" [routerLink]="['/reviews', p.latest.id]">{{ p.latest.prTitle }}</a>
                <div class="meta cj-muted">
                  <span>#{{ p.latest.prNumber }}</span><span>{{ p.latest.repo }}</span><span>&#64;{{ p.latest.author }}</span><span>{{ rel(p.latest.createdAtMs) }}</span>
                  @if (p.latest.trigger && p.latest.trigger !== p.latest.author) {<span data-testid="requested-by">diminta &#64;{{ p.latest.trigger }}</span>}
                  @if (impact(p); as im) {<span class="impact"><span class="material-symbols-rounded" aria-hidden="true">{{ im.icon }}</span>{{ im.label }}</span>}
                  @if (p.reviews > 1) {<span>{{ p.reviews }} review</span>}
                </div>
              </div>
              <div role="cell" class="status">
                <cj-chip [tone]="tone(p.status)" [icon]="icon(p.status)" [attr.data-status]="p.status">{{ label(p.status) }}</cj-chip>
                @if (p.latest.score !== null) {<span class="score">{{ p.latest.score }}/5</span>}
              </div>
              <div role="cell" class="act">
                @if (p.latest.prUrl) {
                  <a class="icon-btn" [href]="p.latest.prUrl" target="_blank" rel="noopener" [attr.aria-label]="'Buka PR #' + p.latest.prNumber + ' di GitHub'" matTooltip="Buka di GitHub">
                    <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
                }
              </div>
            </div>
          }
        </div>
        <div class="pager">
          <span class="cj-muted">{{ pageIdx() * size + 1 }}–{{ min(filtered().length, (pageIdx() + 1) * size) }} dari {{ filtered().length }}</span>
          <button type="button" class="icon-btn" [disabled]="pageIdx() === 0" (click)="pageIdx.set(pageIdx() - 1)" aria-label="Halaman sebelumnya"><span class="material-symbols-rounded" aria-hidden="true">chevron_left</span></button>
          <button type="button" class="icon-btn" [disabled]="(pageIdx() + 1) * size >= filtered().length" (click)="pageIdx.set(pageIdx() + 1)" aria-label="Halaman berikutnya"><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></button>
        </div>
      }
    </cj-page>
  `,
  styles: `
    .top { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
    .n { font: var(--mat-sys-label-medium); opacity: .7; }
    .cj-suggest { margin-bottom: 16px; }
    .empty { margin-top: 8px; }
    .list { border-radius: 24px; background: var(--mat-sys-surface); overflow: hidden; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) 230px 64px; gap: 16px; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .row:last-child { border-bottom: 0; }
    .row:not(.head):hover { background: var(--mat-sys-surface-container-low); }
    .head { font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); padding-top: 12px; padding-bottom: 12px; }
    .title { font: var(--mat-sys-title-small); font-weight: 500; color: var(--mat-sys-on-surface); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title:hover { text-decoration: underline; }
    .meta { display: flex; flex-wrap: wrap; gap: 4px 0; font: var(--mat-sys-body-small); margin-top: 4px; }
    .meta > span:not(:last-child)::after { content: '·'; margin: 0 8px; }
    .impact { display: inline-flex; align-items: center; gap: 2px; }
    .impact .material-symbols-rounded { font-size: 16px; }
    .status { display: flex; align-items: center; gap: 10px; }
    .score { font: var(--mat-sys-label-large); }
    .act { text-align: right; }
    .icon-btn { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 999px; border: 0; background: transparent; color: var(--mat-sys-on-surface-variant); cursor: pointer; }
    .icon-btn:hover:not(:disabled) { background: var(--mat-sys-surface-container-highest); }
    .icon-btn:disabled { opacity: .4; cursor: default; }
    .pager { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 12px; }
    @media (max-width: 720px) {
      .row { grid-template-columns: minmax(0, 1fr) auto; }
      .row .act, .head { display: none; }
      .status { flex-direction: column; align-items: flex-end; gap: 4px; }
    }
  `,
})
export class ReviewsPage {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  protected readonly router = inject(Router);
  private readonly now = nowSignal(30_000);
  protected readonly size = 20;
  protected readonly q = signal('');
  protected readonly open = signal(true);
  protected readonly mine = signal(false);
  protected readonly needsFix = signal(false);
  protected readonly highImpact = signal(false);
  protected readonly repo = signal('');
  protected readonly pageIdx = signal(0);
  protected readonly me = computed(() => this.auth.membership()?.githubLogin ?? null);

  protected readonly jobs = liveQuery<JobRow>(
    () => query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), orderBy('createdAt', 'desc'), limit(1000)),
    jobRow,
  );
  private readonly prs = computed(() => groupPrs(this.jobs().data));
  protected readonly openCount = computed(() => this.prs().filter((p) => p.open).length);
  protected readonly closedCount = computed(() => this.prs().filter((p) => !p.open).length);
  protected readonly topRepos = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.prs()) m.set(p.latest.repo, (m.get(p.latest.repo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r]) => r);
  });
  protected readonly filtered = computed(() => {
    const q = this.q().toLowerCase();
    return this.prs().filter(
      (p) =>
        p.open === this.open() &&
        (!this.mine() || p.latest.author === this.me()) &&
        (!this.needsFix() || p.status === 'fix') &&
        (!this.highImpact() || p.latest.maxSeverity === 'P0' || p.latest.maxSeverity === 'P1') &&
        (!this.repo() || p.latest.repo === this.repo()) &&
        (!q || `${p.latest.prTitle} ${p.latest.repo} #${p.latest.prNumber} ${p.latest.author}`.toLowerCase().includes(q)),
    );
  });
  protected readonly page = computed(() => this.filtered().slice(this.pageIdx() * this.size, (this.pageIdx() + 1) * this.size));

  protected label = (s: MergeStatus) => MERGE_LABEL[s];
  protected icon = (s: MergeStatus) => MERGE_ICON[s];
  protected tone = (s: MergeStatus) => MERGE_TONE[s];
  protected impact = (p: PrRow) => (p.latest.maxSeverity ? IMPACT[p.latest.maxSeverity] : p.latest.status === 'posted' ? { label: 'Rendah', icon: 'signal_cellular_null' } : null);
  protected rel = (ms: number | null) => fmtRelative(ms, this.now());
  protected min = Math.min;
  setQ(v: string) {
    this.q.set(v);
    this.pageIdx.set(0);
  }
  setOpen(v: boolean) {
    this.open.set(v);
    this.pageIdx.set(0);
  }
}
