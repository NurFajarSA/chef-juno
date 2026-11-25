import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, query, where } from 'firebase/firestore';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CjPage } from '../ui/page';
import { CjSelect } from '../ui/select';
import { CjChip } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { FirebaseService } from '../core/firebase';
import { liveQuery } from '../core/live';
import { fmtDate, fmtNum, fmtPct } from '../core/format';

interface MemberRow {
  login: string;
  prsReviewed: number;
  avgScore: number | null;
  findings: number;
  findingsPerPr: number | null;
  prevFindingsPerPr: number | null;
  addressedRate: number | null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dokumen rapor ditampilkan apa adanya
type Rep = Record<string, any>;

@Component({
  selector: 'cj-rapor',
  imports: [CjPage, CjSelect, CjChip, CjEmptyState, RouterLink, MatFormFieldModule],
  template: `
    <cj-page heading="Rapor tim" subtitle="Perkembangan tim tiap minggu. Tidak ada ranking kesalahan — yang ditonjolkan perkembangan.">
      @if (weeks().length) {
        <cj-select actions label="Minggu" [options]="weekOpts()" [value]="week() ?? ''" (valueChange)="pick.set($event)" testId="week-picker" />
      }
      @let t = team();
      @if (!t) {
        <div class="cj-card"><cj-empty-state icon="insights" title="Belum ada rekap mingguan" text="Rekap dihitung otomatis tiap Senin 08.00 WIB." /></div>
      } @else {
        <div class="cj-grid stats" data-testid="team-stats">
          <div class="cj-card"><span class="cj-muted">PR di-review</span><strong>{{ t['prsReviewed'] }}</strong><span class="cj-muted small">minggu lalu {{ t['prev']?.prsReviewed ?? 0 }}</span></div>
          <div class="cj-card"><span class="cj-muted">Rata-rata skor</span><strong>{{ num(t['avgScore']) }}</strong><span class="cj-muted small">minggu lalu {{ num(t['prev']?.avgScore) }}</span></div>
          <div class="cj-card"><span class="cj-muted">Temuan</span><strong>{{ t['findings'] }}</strong><span class="cj-muted small">minggu lalu {{ t['prev']?.findings ?? 0 }}</span></div>
          <div class="cj-card"><span class="cj-muted">Diperbaiki</span><strong>{{ pct(t['addressedRate']) }}</strong><span class="cj-muted small">minggu lalu {{ pct(t['prev']?.addressedRate) }}</span></div>
        </div>
        @if (t['narrative']) {
          <div class="cj-card narrative" data-testid="team-narrative"><span class="material-symbols-rounded" aria-hidden="true">soup_kitchen</span><p>{{ t['narrative'] }}</p></div>
        }
        <div class="two">
          <div class="cj-card" data-testid="most-improved">
            <h2>Paling berkembang</h2>
            @for (m of t['mostImproved']; track m.login; let i = $index) {
              <a class="row" [routerLink]="['/rapor', m.login]"><span class="rank">{{ i + 1 }}</span><span>{{ m.text }}</span></a>
            } @empty {
              <p class="cj-muted">Belum ada yang berkembang dibanding minggu lalu.</p>
            }
          </div>
          <div class="cj-card" data-testid="team-members">
            <h2>Anggota</h2>
            @for (m of members(); track m.login) {
              <a class="row member" [routerLink]="['/rapor', m.login]">
                <strong>&#64;{{ m.login }}</strong>
                <span class="cj-muted">{{ m.prsReviewed }} PR · skor {{ num(m.avgScore) }} · diperbaiki {{ pct(m.addressedRate) }}</span>
                @if (trend(m); as tr) {<cj-chip [tone]="tr.tone" [icon]="tr.icon">{{ tr.text }}</cj-chip>}
              </a>
            }
          </div>
        </div>
      }
    </cj-page>
  `,
  styles: `
    .stats { margin-bottom: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stats .cj-card { display: flex; flex-direction: column; gap: 6px; }
    .stats strong { font: var(--mat-sys-display-small); }
    .small { font: var(--mat-sys-body-small); }
    .narrative { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
    .narrative p { margin: 0; font: var(--mat-sys-body-large); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
    h2 { font: var(--mat-sys-title-large); margin: 0 0 8px; }
    .row { display: flex; gap: 12px; align-items: center; padding: 10px 8px; border-radius: 16px; text-decoration: none; color: inherit; flex-wrap: wrap; }
    .row:hover { background: var(--mat-sys-surface-container-low); }
    .rank { width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center; background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); font-weight: 600; }
    .member strong { min-width: 90px; }
  `,
})
export class RaporPage {
  private readonly fb = inject(FirebaseService);
  protected readonly pick = signal<string | null>(null);
  private readonly teams = liveQuery<Rep>(() => query(collection(this.fb.db, 'reports'), where('login', '==', null)), (id, d) => ({ id, ...d }));
  protected readonly weeks = computed(() => this.teams().data.map((t) => t['weekStart'] as string).sort().reverse());
  protected readonly weekOpts = computed(() => this.weeks().map((w) => ({ value: w, label: 'Minggu ' + this.date(w) })));
  protected readonly week = computed(() => this.pick() ?? this.weeks()[0] ?? null);
  protected readonly team = computed(() => this.teams().data.find((t) => t['weekStart'] === this.week()) ?? null);
  protected readonly members = computed(() => (this.team()?.['members'] ?? []) as MemberRow[]);
  protected num = (n: number | null | undefined) => fmtNum(n, 1);
  protected pct = fmtPct;
  protected date = (w: string) => fmtDate(new Date(w + 'T00:00:00+07:00'));
  protected trend(m: MemberRow) {
    if (m.findingsPerPr == null || m.prevFindingsPerPr == null) return null;
    const d = m.findingsPerPr - m.prevFindingsPerPr;
    if (d < 0) return { tone: 'success' as const, icon: 'trending_down', text: `temuan/PR ${fmtNum(m.prevFindingsPerPr, 1)} → ${fmtNum(m.findingsPerPr, 1)}` };
    if (d > 0) return { tone: 'warning' as const, icon: 'trending_up', text: `temuan/PR ${fmtNum(m.prevFindingsPerPr, 1)} → ${fmtNum(m.findingsPerPr, 1)}` };
    return { tone: 'neutral' as const, icon: 'trending_flat', text: 'stabil' };
  }
}
