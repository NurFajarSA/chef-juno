import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, doc, query, where } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { buildMemoryMarkdown, type RuleData } from '@chefjuno/shared';
import { CjPage } from '../ui/page';
import { miniInline, miniMarkdown } from '../core/md';
import { CjChip } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { CjBarChart } from '../ui/charts';
import { FirebaseService } from '../core/firebase';
import { liveDoc, liveQuery } from '../core/live';
import { CATEGORY_LABEL, fmtNum, fmtPct } from '../core/format';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dokumen rapor/people ditampilkan apa adanya
type Rep = Record<string, any>;

@Component({
  selector: 'cj-rapor-person',
  imports: [CjPage, CjChip, CjEmptyState, CjBarChart, RouterLink, MatButton],
  template: `
    <cj-page back="/rapor" backLabel="Rapor tim" icon="person" [heading]="'@' + login()">
      <span meta>Rapor pribadi · terbuka untuk semua anggota</span>
      @if (latest(); as r) {<span meta>minggu {{ r['weekStart'] }}</span>}
      <button actions matButton="tonal" (click)="copy()" data-testid="copy-memory">
        <span class="material-symbols-rounded" aria-hidden="true">content_copy</span> {{ copied() ? 'Tersalin' : 'Salin memori untuk agent' }}
      </button>
      @let r = latest();
      @if (!r && !reports().loading) {
        <div class="cj-card"><cj-empty-state icon="insights" title="Belum ada rapor" text="Rapor muncul setelah rekap mingguan pertama." /></div>
      } @else if (r) {
        <div class="cj-grid stats" data-testid="person-stats">
          <div class="cj-card"><span class="cj-muted">PR di-review</span><strong>{{ r['prsReviewed'] }}</strong><span class="cj-muted small">minggu lalu {{ r['prev']?.prsReviewed ?? 0 }}</span></div>
          <div class="cj-card"><span class="cj-muted">Rata-rata skor</span><strong>{{ num(r['avgScore']) }}</strong><span class="cj-muted small">minggu lalu {{ num(r['prev']?.avgScore) }}</span></div>
          <div class="cj-card"><span class="cj-muted">Diperbaiki</span><strong>{{ pct(r['addressedRate']) }}</strong><span class="cj-muted small">minggu lalu {{ pct(r['prev']?.addressedRate) }}</span></div>
          <div class="cj-card"><span class="cj-muted">Temuan (P0/P1/P2)</span><strong>{{ r['findings'] }}</strong><span class="cj-muted small">{{ r['bySeverity']?.P0 ?? 0 }} / {{ r['bySeverity']?.P1 ?? 0 }} / {{ r['bySeverity']?.P2 ?? 0 }}</span></div>
        </div>
        @if (r['development']?.length) {
          <div class="cj-card dev" data-testid="person-development">
            <h2>Perkembangan</h2>
            @for (d of r['development']; track d.category) {
              <cj-chip [wrap]="true" [tone]="d.pct < 0 ? 'success' : 'warning'" [icon]="d.pct < 0 ? 'trending_down' : 'trending_up'">{{ d.text }}</cj-chip>
            }
          </div>
        }
        <div class="two">
          <div class="cj-card">
            <h2>Temuan per kategori (mingguan)</h2>
            <cj-bar-chart [days]="chartDays()" [series]="chartSeries()" ariaLabel="Temuan per kategori per minggu" data-testid="category-chart" />
          </div>
          <div class="cj-card" data-testid="person-mistakes">
            <h2>3 kesalahan yang paling sering diulang</h2>
            @for (m of top(); track m.key) {
              <div class="row">
                <strong [innerHTML]="mdi(m.title)"></strong>
                <cj-chip>{{ cat(m.category) }}</cj-chip><cj-chip>{{ m.count }}x</cj-chip>
                <cj-chip [tone]="m.trend === 'down' ? 'success' : m.trend === 'up' ? 'warning' : 'neutral'" [icon]="m.trend === 'down' ? 'trending_down' : m.trend === 'up' ? 'trending_up' : 'trending_flat'">
                  {{ m.trend === 'down' ? 'turun' : m.trend === 'up' ? 'naik' : 'stabil' }}</cj-chip>
              </div>
            } @empty {<p class="cj-muted">Belum ada kesalahan berulang.</p>}
            <h2 class="mt">Pelajaran terbaru</h2>
            <ul>@for (l of lessons(); track $index) {<li><span [innerHTML]="mdi(l.text)"></span> @if (l.prNumber) {<span class="cj-muted">&nbsp;(PR #{{ l.prNumber }})</span>}</li>} @empty {<li class="cj-muted">—</li>}</ul>
          </div>
        </div>
        <div class="cj-card" data-testid="good-examples">
          <h2>Contoh baik dari teman</h2>
          @for (g of r['goodExamples'] ?? []; track g.jobId) {
            <a class="row" [routerLink]="['/reviews', g.jobId]"><cj-chip tone="success">{{ g.score }}/5</cj-chip><span>{{ g.repo }} #{{ g.pr }} — {{ g.title }}</span><span class="cj-muted">&#64;{{ g.author }}</span></a>
          } @empty {<p class="cj-muted">Belum ada contoh.</p>}
        </div>
      }
    </cj-page>
  `,
  styles: `
    .stats { margin-bottom: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stats .cj-card { display: flex; flex-direction: column; gap: 6px; }
    .stats strong { font: var(--mat-sys-display-small); }
    .small { font: var(--mat-sys-body-small); }
    .dev { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .dev h2 { margin: 0 8px 0 0; }
    .two { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
    h2 { font: var(--mat-sys-title-large); margin: 0 0 8px; }
    .mt { margin-top: 20px; }
    .row { display: flex; gap: 8px; align-items: center; padding: 8px 4px; flex-wrap: wrap; text-decoration: none; color: inherit; border-radius: 12px; }
    a.row:hover { background: var(--mat-sys-surface-container-low); }
    ul { margin: 0; padding-left: 20px; }
  `,
})
export class RaporPersonPage {
  protected readonly mdi = miniInline;
  protected readonly mdb = miniMarkdown;
  private readonly fb = inject(FirebaseService);
  readonly login = input.required<string>();
  protected readonly copied = signal(false);
  protected readonly reports = liveQuery<Rep>(() => query(collection(this.fb.db, 'reports'), where('login', '==', this.login())), (id, d) => ({ id, ...d }));
  protected readonly person = liveDoc<Rep>(() => doc(this.fb.db, `people/${this.login()}`), (_id, d) => d);
  private readonly rules = liveQuery<RuleData>(() => query(collection(this.fb.db, 'rules'), where('status', '==', 'active')), (id, d) => ({
    id,
    text: d['text'],
    kind: d['kind'] ?? 'rule',
    category: d['category'] ?? 'bug',
    scope: { repoId: d['scope']?.repoId ?? null, paths: d['scope']?.paths ?? [] },
  }));
  private readonly sorted = computed(() => [...this.reports().data].sort((a, b) => String(a['weekStart']).localeCompare(String(b['weekStart']))));
  protected readonly latest = computed(() => this.sorted().at(-1) ?? null);
  protected readonly chart = computed(() => {
    const rs = this.sorted().slice(-8);
    const out = rs.map((r) => ({ week: r['weekStart'], byCategory: r['byCategory'] ?? {} }));
    const last = rs.at(-1);
    // tambahkan minggu sebelumnya dari field prev kalau belum ada rapornya
    if (rs.length === 1 && last?.['prev']) {
      const prevWeek = new Date(Date.parse(last['weekStart'] + 'T00:00:00+07:00') - 7 * 86400_000 + 7 * 3600_000).toISOString().slice(0, 10);
      out.unshift({ week: prevWeek, byCategory: last['prev'].byCategory ?? {} });
    }
    return out;
  });
  protected readonly chartDays = computed(() => this.chart().map((w) => w.week as string));
  protected readonly chartSeries = computed(() =>
    (['bug', 'security', 'performance', 'maintainability', 'test'] as const).map((c, i) => ({
      key: c,
      label: CATEGORY_LABEL[c],
      color: ['var(--mat-sys-primary)', 'var(--mat-sys-error)', 'var(--mat-sys-tertiary)', 'var(--mat-sys-secondary)', 'var(--mat-sys-outline)'][i],
      values: this.chart().map((w) => (w.byCategory as Record<string, number>)[c] ?? 0),
    })),
  );
  protected readonly top = computed(() =>
    [...((this.person().data?.['recurringMistakes'] ?? []) as { key: string; title: string; category: string; count: number; trend?: string }[])].sort((a, b) => b.count - a.count).slice(0, 3),
  );
  protected readonly lessons = computed(() => ((this.person().data?.['lessons'] ?? []) as { text: string; prNumber?: number }[]).slice(0, 5));
  protected num = (n: number | null | undefined) => fmtNum(n, 1);
  protected pct = fmtPct;
  protected cat = (c: string) => CATEGORY_LABEL[c] ?? c;

  memoryMarkdown(): string {
    const p = this.person().data;
    return buildMemoryMarkdown(this.login(), this.rules().data, { login: this.login(), recurringMistakes: p?.['recurringMistakes'] ?? [], lessons: p?.['lessons'] ?? [] });
  }
  async copy() {
    try {
      await navigator.clipboard.writeText(this.memoryMarkdown());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
