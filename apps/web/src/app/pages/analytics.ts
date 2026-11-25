import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, doc, getDoc, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { CjPage } from '../ui/page';
import { CjSelect } from '../ui/select';
import { miniInline, miniMarkdown } from '../core/md';
import { CjChip, STATUS_TONE } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { CjBarChart, CjLineChart } from '../ui/charts';
import { FirebaseService } from '../core/firebase';
import { liveDoc, liveQuery } from '../core/live';
import { skillStats, type SkillInfo } from '../core/skills-analytics';
import { DEFAULT_TARGETS, impactMetrics, prRow, type ImpactTargets, type PrRow, type TargetStatus } from '../core/impact';
import { AuthService } from '../core/auth.service';
import { findingRow, jobRow, type FindingRow, type JobRow } from '../core/rows';
import { CATEGORY_LABEL, OUTCOME_LABEL, fmtDate, fmtDuration, fmtInt, fmtNum, fmtPct } from '../core/format';
import { byMode, passCost, ROLE_NAME, timing, tokensPerReview, usageByModel, usageByRole, allPasses, type ModelPrices } from '../core/cost';
import { addressedRate, dayRange, download, filterFindings, filterJobs, perDay, toCsv, topBy, type Filters } from '../core/analytics';

const PERIODS = [
  { days: 7, label: '7 hari terakhir' },
  { days: 14, label: '14 hari terakhir' },
  { days: 30, label: '30 hari terakhir' },
  { days: 90, label: '90 hari terakhir' },
];
const STATUS_FIND: Record<string, string> = { ...OUTCOME_LABEL, pending: 'Terbuka' };

/** Analitik (ala Greptile "PR Reviews" & "Bugs Caught"), dihitung di klien dari job & temuan terbaru. */
@Component({
  selector: 'cj-analytics',
  imports: [CjPage, CjSelect, CjChip, CjEmptyState, CjBarChart, CjLineChart, RouterLink],
  template: `
    <cj-page [heading]="tab() === 'temuan' ? 'Temuan' : tab() === 'biaya' ? 'Biaya & waktu' : tab() === 'skills' ? 'Skills' : tab() === 'dampak' ? 'Dampak' : 'Review PR'" [crumbs]="[{ label: 'Analitik', link: '/analytics' }]">
      <button actions class="cj-btn-tonal" type="button" (click)="export()" data-testid="analytics-export">
        <span class="material-symbols-rounded" aria-hidden="true">download</span> Ekspor CSV
      </button>
      <div class="bar">
        <div class="cj-seg" role="tablist" aria-label="Jenis analitik">
          <a role="tab" [class.on]="isPr()" routerLink="/analytics" [attr.aria-selected]="isPr()">Review PR</a>
          <a role="tab" [class.on]="tab() === 'temuan'" routerLink="/analytics/temuan" [attr.aria-selected]="tab() === 'temuan'">Temuan</a>
          <a role="tab" [class.on]="tab() === 'biaya'" routerLink="/analytics/biaya" [attr.aria-selected]="tab() === 'biaya'">Biaya &amp; waktu</a>
          <a role="tab" [class.on]="tab() === 'skills'" routerLink="/analytics/skills" [attr.aria-selected]="tab() === 'skills'">Skills</a>
          <a role="tab" [class.on]="tab() === 'dampak'" routerLink="/analytics/dampak" [attr.aria-selected]="tab() === 'dampak'">Dampak</a>
        </div>
        <div class="filters">
          <cj-select label="Repositori" [options]="repoOpts()" [value]="f().repo" (valueChange)="set('repo', $event)" testId="filter-repo" />
          <cj-select label="Penulis" [options]="authorOpts()" [value]="f().author" (valueChange)="set('author', $event)" testId="filter-author" />
          <cj-select label="Periode" [options]="periodOpts" [value]="f().days" (valueChange)="set('days', $event)" testId="filter-period" />
        </div>
      </div>

      @if (tab() === 'dampak') {
        @let m = impact();
        <div class="cj-card hero" data-testid="impact-summary">
          @if (m.pilotStartMs) {
            <p>Sejak <b>{{ date(m.pilotStartMs) }}</b> (review pertama), dalam {{ m.days }} hari terakhir Chef Juno mereview <b>{{ m.reviews }}</b> PR,
              <b>{{ m.bugsCaught }}</b> bug P0/P1 diperbaiki sebelum merge, presisi <b>{{ m.precision == null ? '—' : pctFmt(m.precision * 100) }}</b>.</p>
          } @else {
            <p>Belum ada review Chef Juno. Angka dampak muncul setelah tim mulai memanggil <code>lapor &#64;chefjuno</code>.</p>
          }
        </div>

        <h2 class="cj-section-title">1 · Bisa dipercaya?</h2>
        <div class="cj-grid stats" data-testid="impact-trust">
          <div class="cj-card cj-stat"><span class="label">Presisi</span><span class="value">{{ m.precision == null ? '—' : pctFmt(m.precision * 100) }}</span>
            <span class="sub">{{ m.addressed }} diperbaiki · {{ m.disputed }} dibantah</span><span class="tgt" [attr.data-status]="m.precisionStatus">{{ tgt(m.precisionStatus) }} · target ≥ {{ pctFmt(targets().precision * 100) }}</span></div>
          <div class="cj-card cj-stat"><span class="label">Bug P0/P1 tertangkap</span><span class="value">{{ m.bugsCaught }}</span>
            <span class="sub">{{ m.bugsPerWeek == null ? '—' : num(m.bugsPerWeek) }} per minggu, diperbaiki sebelum merge</span><span class="tgt" [attr.data-status]="m.bugsStatus">{{ tgt(m.bugsStatus) }} · target ≥ {{ targets().bugsPerWeek }}/minggu</span></div>
        </div>
        @if (m.bugExamples.length) {
          <div class="cj-card examples"><h3>Contoh bug yang tidak sampai ke pengguna</h3>
            <ol>@for (b of m.bugExamples; track $index) {<li><cj-chip [tone]="tone(b.severity)">{{ b.severity }}</cj-chip> <a [routerLink]="['/reviews', b.jobId]" [innerHTML]="mdi(b.title)"></a> <span class="cj-muted small">{{ b.repo }}</span></li>}</ol>
          </div>
        }

        <h2 class="cj-section-title">2 · Dipakai tim?</h2>
        <div class="cj-grid stats" data-testid="impact-adoption">
          <div class="cj-card cj-stat"><span class="label">Adopsi</span><span class="value">{{ m.adoption == null ? '—' : pctFmt(m.adoption * 100) }}</span>
            <span class="sub">{{ m.reviewedMerged }} dari {{ m.mergedPrs }} PR yang di-merge sempat direview</span></div>
          <div class="cj-card cj-stat"><span class="label">Pemakaian ulang</span><span class="value">{{ m.reuse == null ? '—' : pctFmt(m.reuse * 100) }}</span>
            <span class="sub">{{ m.repeatCallers }} dari {{ m.callers }} developer memanggil lagi di PR lain</span><span class="tgt" [attr.data-status]="m.reuseStatus">{{ tgt(m.reuseStatus) }} · target ≥ {{ pctFmt(targets().reuse * 100) }}</span></div>
          <div class="cj-card cj-stat"><span class="label">Feedback Chef Juno</span><span class="value">{{ mins(m.feedbackMedianMin) }}</span>
            <span class="sub">median sampai tampil di PR · review manusia pertama {{ mins(m.humanReviewMedianMin) }}</span><span class="tgt" [attr.data-status]="m.feedbackStatus">{{ tgt(m.feedbackStatus) }} · target ≤ {{ targets().feedbackMinutes }} menit</span></div>
        </div>

        <h2 class="cj-section-title">3 · Kualitas membaik?</h2>
        <div class="cj-grid stats" data-testid="impact-quality">
          <div class="cj-card cj-stat"><span class="label">Revert · direview Chef Juno</span><span class="value">{{ m.revertRateReviewed == null ? '—' : pctFmt(m.revertRateReviewed * 100) }}</span>
            <span class="sub">{{ m.revertedReviewed }} dari {{ m.reviewedMerged }} PR</span></div>
          <div class="cj-card cj-stat"><span class="label">Revert · tidak direview</span><span class="value">{{ m.revertRateNotReviewed == null ? '—' : pctFmt(m.revertRateNotReviewed * 100) }}</span>
            <span class="sub">{{ m.revertedNotReviewed }} dari {{ m.notReviewedMerged }} PR</span></div>
          <div class="cj-card cj-stat"><span class="label">Token per temuan berguna</span><span class="value">{{ m.tokensPerUseful == null ? '—' : compact(m.tokensPerUseful) }}</span>
            <span class="sub">kuota langganan per temuan yang diperbaiki</span></div>
        </div>
        <div class="cj-table-wrap" tabindex="0" role="region" aria-label="Sebelum pilot dibanding sekarang">
          <table class="cj-table" data-testid="impact-baseline">
            <thead><tr><th>Periode ({{ m.days }} hari)</th><th class="num">PR di-merge</th><th class="num">Di-revert</th><th class="num">Median buka → merge</th><th class="num">Median sampai review manusia</th></tr></thead>
            <tbody>
              <tr><td>Sebelum pilot</td>
                @if (m.baseline; as b) {<td class="num">{{ b.merged }}</td><td class="num">{{ b.revertRate == null ? '—' : pctFmt(b.revertRate * 100) }}</td><td class="num">{{ hours(b.cycleMedianH) }}</td><td class="num">{{ hours(b.firstHumanReviewMedianH) }}</td>}
                @else {<td colspan="4" class="cj-muted">Belum ada riwayat — {{ auth.isAdmin() ? 'ambil riwayat PR di bawah' : 'minta admin mengambil riwayat PR' }}.</td>}
              </tr>
              <tr><td>Sekarang</td><td class="num">{{ m.current.merged }}</td><td class="num">{{ m.current.revertRate == null ? '—' : pctFmt(m.current.revertRate * 100) }}</td><td class="num">{{ hours(m.current.cycleMedianH) }}</td><td class="num">{{ hours(m.current.firstHumanReviewMedianH) }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="cj-muted note2">Cara membaca: PR yang di-tag cenderung yang lebih berisiko, jadi perbandingan "direview vs tidak" bisa bias — bandingkan juga dengan periode sebelum pilot. Revert dideteksi dari commit <code>Revert "… (#nomor)"</code> / <code>This reverts commit</code> di branch utama; hotfix tanpa revert belum terdeteksi. Dampak ke bug produksi butuh beberapa bulan untuk terlihat; di awal, perhatikan presisi dan bug yang tertangkap.</p>

        @if (auth.isAdmin()) {
          <h2 class="cj-section-title">Pengaturan pilot</h2>
          <div class="cj-card admin" data-testid="impact-admin">
            <div class="row1"><div><b>Riwayat PR (baseline)</b><div class="cj-muted small">Tarik PR yang ditutup 60 hari terakhir, review manusia pertama, dan revert dari GitHub untuk semua repo aktif.</div></div>
              <button type="button" class="cj-btn-tonal" (click)="backfill()" [disabled]="busy()" data-testid="impact-backfill"><span class="material-symbols-rounded" aria-hidden="true">history</span> Ambil riwayat PR</button></div>
            @if (backfillMsg()) {<p class="cj-muted small" role="status">{{ backfillMsg() }}</p>}
            <div class="targets">
              <b>Target pilot</b>
              <label>Presisi minimal (%) <input type="number" min="0" max="100" [value]="round(targets().precision * 100)" (change)="setTarget('precision', $any($event.target).value / 100)" data-testid="target-precision" /></label>
              <label>Bug P0/P1 per minggu <input type="number" min="0" step="0.5" [value]="targets().bugsPerWeek" (change)="setTarget('bugsPerWeek', +$any($event.target).value)" /></label>
              <label>Pemakaian ulang (%) <input type="number" min="0" max="100" [value]="round(targets().reuse * 100)" (change)="setTarget('reuse', $any($event.target).value / 100)" /></label>
              <label>Feedback maksimal (menit) <input type="number" min="1" [value]="targets().feedbackMinutes" (change)="setTarget('feedbackMinutes', +$any($event.target).value)" /></label>
            </div>
          </div>
        }
      } @else if (tab() === 'skills') {
        <h2 class="cj-section-title">Ikhtisar</h2>
        <div class="cj-grid stats" data-testid="skills-overview">
          <div class="cj-card cj-stat"><span class="label">Skill aktif</span><span class="value">{{ activeSkills() }}</span><span class="sub">dari {{ skillRows().length }} skill</span></div>
          <div class="cj-card cj-stat"><span class="label">Dimuat per review</span><span class="value">{{ avgLoaded() == null ? '—' : num(avgLoaded()) }}</span><span class="sub">rata-rata skill di prompt</span></div>
          <div class="cj-card cj-stat"><span class="label">Temuan dari skill</span><span class="value">{{ skillFinds() }}</span><span class="sub">{{ finds().length ? pctSkill() + ' dari semua temuan' : 'belum ada temuan' }}</span></div>
          <div class="cj-card cj-stat"><span class="label">Perlu perhatian</span><span class="value">{{ flagged().length }}</span><span class="sub">skill dengan saran perbaikan</span></div>
        </div>
        <p class="cj-muted note">Setiap temuan mencatat skill yang menjadi dasarnya sejak 24 Nov 2026; temuan sebelum itu tidak punya data skill. "Dimuat" = skill masuk prompt reviewer; "dilewati" = <code>paths:</code> skill tidak cocok dengan file PR.</p>
        @if (!skillRows().length) {
          <div class="cj-card"><cj-empty-state icon="folder_special" title="Belum ada skill" text="Tambahkan atau aktifkan skill di halaman Skills." /></div>
        } @else {
          <div class="cj-table-wrap" tabindex="0" role="region" aria-label="Statistik per skill">
            <table class="cj-table" data-testid="skills-table">
              <thead><tr><th>Skill</th><th class="num">Dimuat</th><th class="num">Dilewati</th><th class="num">Temuan</th><th class="num">Diperbaiki</th><th class="num">Dibantah</th><th class="num">≈ Token</th><th>Saran</th></tr></thead>
              <tbody>
                @for (s of skillRows(); track s.slug) {
                  <tr [attr.data-skill]="s.slug">
                    <td><a class="slink" routerLink="/skills" [queryParams]="{ f: 'skills/' + s.slug + '/SKILL.md' }">{{ s.name }}</a>
                      <div class="cj-muted small"><code>{{ s.slug }}</code>{{ s.enabled ? '' : ' · nonaktif' }}{{ s.source === 'default' ? ' · bawaan' : '' }}</div></td>
                    <td class="num">{{ s.loaded }}</td>
                    <td class="num">{{ s.skipped }}</td>
                    <td class="num">{{ s.findings }}{{ s.per10 != null && s.findings ? ' (' + num(s.per10) + '/10 review)' : '' }}</td>
                    <td class="num">{{ s.addressedRate == null ? '—' : pctFmt(s.addressedRate * 100) }}</td>
                    <td class="num" [class.bad]="(s.disputedRate ?? 0) >= 0.3 && s.decided >= 3">{{ s.disputedRate == null ? '—' : pctFmt(s.disputedRate * 100) }}</td>
                    <td class="num">{{ s.approxTokens == null ? '—' : int(s.approxTokens) }}</td>
                    <td class="small-cell">
                      @if (warnCount(s); as n) {<cj-chip tone="warning">Perlu dicek{{ n > 1 ? ' (' + n + ')' : '' }}</cj-chip>} @else if (s.flags.length) {<cj-chip tone="success">Efektif</cj-chip>}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (flagged().length) {
            <h2 class="cj-section-title">Perlu perbaikan</h2>
            <div class="fix-grid" data-testid="skills-fix">
              @for (s of flagged(); track s.slug) {
                <section class="cj-card fix" [attr.data-skill]="s.slug">
                  <header><span class="material-symbols-rounded" aria-hidden="true">build</span><h3>{{ s.name }}</h3></header>
                  <ul>@for (f of s.flags; track $index) {@if (f.kind === 'warn') {<li [innerHTML]="mdi(f.text)"></li>}}</ul>
                  @if (s.disputedExamples.length) {
                    <h4>Contoh temuan yang dibantah</h4>
                    <ol>@for (x of s.disputedExamples; track $index) {<li><a [routerLink]="['/reviews', x.jobId]" [innerHTML]="mdi(x.title)"></a>@if (x.reason) {<span class="cj-muted small"> — {{ x.reason }}</span>}</li>}</ol>
                  }
                  <a class="cj-btn-tonal edit" routerLink="/skills" [queryParams]="{ f: 'skills/' + s.slug + '/SKILL.md' }"><span class="material-symbols-rounded" aria-hidden="true">edit</span> Buka di editor Skills</a>
                </section>
              }
            </div>
          }
        }
      } @else if (tab() === 'biaya') {
        <h2 class="cj-section-title">Ikhtisar</h2>
        <div class="cj-grid stats" data-testid="cost-overview">
          <div class="cj-card cj-stat"><span class="label">Token</span><span class="value">{{ compact(tokIn() + tokOut()) }}</span><span class="sub">{{ compact(tokIn()) }} masuk · {{ compact(tokOut()) }} keluar</span></div>
          <div class="cj-card cj-stat"><span class="label">Token per review</span><span class="value">{{ perReview().avg == null ? '—' : compact(perReview().avg!) }}</span><span class="sub">dari {{ perReview().reviews }} review yang tercatat tokennya</span></div>
          <div class="cj-card cj-stat"><span class="label">Waktu review</span><span class="value">{{ dur(tm().medianAgentMs) }}</span><span class="sub">median kerja agent · p90 {{ dur(tm().p90AgentMs) }}</span></div>
          <div class="cj-card cj-stat"><span class="label">Sampai tampil di PR</span><span class="value">{{ dur(tm().medianTotalMs) }}</span><span class="sub">median · antre {{ dur(tm().medianQueueMs) }} · p90 {{ dur(tm().p90TotalMs) }}</span></div>
          <div class="cj-card cj-stat" data-testid="cost-estimate"><span class="label">Estimasi setara API</span><span class="value">{{ totalCost() == null ? '—' : usd(totalCost()!) }}</span><span class="sub">{{ hasPrices() ? (pricedShare() < 1 ? 'sebagian model belum berharga' : 'dari harga di Pengaturan') : 'isi harga model di Pengaturan' }}</span></div>
        </div>
        <p class="cj-muted note">Chef Juno memakai <b>langganan</b> Claude/ChatGPT pemilik mesin — tidak ada tagihan per token. Token = pemakaian kuota langganan. Estimasi hanya pembanding bila memakai API, dihitung dari harga per 1 juta token yang diisi admin di <a routerLink="/settings/model">Pengaturan → Model &amp; biaya</a>.</p>
        <h2 class="cj-section-title">Rincian harian</h2>
        <div class="charts">
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">token</span><h3>Token per hari</h3></header>
            <div class="big">{{ compact(tokIn() + tokOut()) }}</div>
            <cj-bar-chart [days]="days()" [series]="tokenSeries()" [fmt]="compact" ariaLabel="Token masuk dan keluar per hari" />
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">timer</span><h3>Durasi review rata-rata (menit)</h3></header>
            <div class="big">{{ dur(tm().medianAgentMs) }}</div>
            <cj-line-chart [days]="days()" [values]="durSeries()" color="var(--mat-sys-tertiary)" ariaLabel="Durasi review rata-rata per hari dalam menit" seriesLabel="Menit" />
          </section>
        </div>
        <h2 class="cj-section-title">Per model</h2>
        @if (!byModel().length) {
          <div class="cj-card"><cj-empty-state icon="memory" title="Belum ada pemakaian agent" text="Rincian model muncul setelah ada review atau job lain di periode ini." /></div>
        } @else {
          <div class="cj-table-wrap" tabindex="0" role="region" aria-label="Pemakaian per model">
            <table class="cj-table" data-testid="cost-by-model">
              <thead><tr><th>Model</th><th>Dipakai untuk</th><th class="num">Panggilan</th><th class="num">Token masuk</th><th class="num">Token keluar</th><th class="num">Rata-rata durasi</th><th class="num">Estimasi</th></tr></thead>
              <tbody>
                @for (m of byModel(); track m.key) {
                  <tr [attr.data-model]="m.key">
                    <td><code>{{ m.key }}</code></td>
                    <td class="small-cell">{{ m.detail.join(', ') }}</td>
                    <td class="num">{{ int(m.calls) }}{{ m.failed ? ' (' + m.failed + ' gagal)' : '' }}</td>
                    <td class="num">{{ int(m.inputTokens) }}</td>
                    <td class="num">{{ int(m.outputTokens) }}</td>
                    <td class="num">{{ dur(m.avgDurationMs) }}</td>
                    <td class="num">{{ m.cost == null ? '—' : usd(m.cost) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <div class="two">
          <section>
            <h2 class="cj-section-title">Per peran</h2>
            <div class="cj-table-wrap" tabindex="0" role="region" aria-label="Pemakaian per peran">
              <table class="cj-table" data-testid="cost-by-role">
                <thead><tr><th>Peran</th><th>Model</th><th class="num">Panggilan</th><th class="num">Token</th><th class="num">Rata-rata durasi</th></tr></thead>
                <tbody>
                  @for (r of byRole(); track r.key) {
                    <tr><td>{{ roleName(r.key) }}</td><td class="small-cell"><code>{{ r.detail.join(', ') }}</code></td><td class="num">{{ int(r.calls) }}</td><td class="num">{{ compact(r.inputTokens + r.outputTokens) }}</td><td class="num">{{ dur(r.avgDurationMs) }}</td></tr>
                  } @empty {<tr><td colspan="5" class="cj-muted">—</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2 class="cj-section-title">Per mode review</h2>
            <div class="cj-table-wrap" tabindex="0" role="region" aria-label="Pemakaian per mode review">
              <table class="cj-table" data-testid="cost-by-mode">
                <thead><tr><th>Mode</th><th class="num">Review</th><th class="num">Panggilan / review</th><th class="num">Token / review</th><th class="num">Median waktu</th></tr></thead>
                <tbody>
                  @for (m of modes(); track m.mode) {
                    <tr><td>{{ m.mode === 'goal' ? 'Tujuan' : m.mode === 'deep' ? 'Mendalam' : 'Standar' }}</td><td class="num">{{ m.reviews }}</td><td class="num">{{ m.avgCalls == null ? '—' : num(m.avgCalls) }}</td><td class="num">{{ m.avgTokens == null ? '—' : compact(m.avgTokens) }}</td><td class="num">{{ dur(m.medianAgentMs) }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      } @else if (tab() !== 'temuan') {
        <h2 class="cj-section-title">Ikhtisar</h2>
        <div class="cj-grid stats" data-testid="analytics-overview">
          <div class="cj-card cj-stat"><span class="label">Pull request</span><span class="value">{{ prCount() }}</span><span class="sub">yang direview</span></div>
          <div class="cj-card cj-stat"><span class="label">Review</span><span class="value">{{ posted().length }}</span><span class="sub">{{ failed() }} gagal</span></div>
          <div class="cj-card cj-stat"><span class="label">Rata-rata skor</span><span class="value">{{ num(avgScore()) }}</span><span class="sub">dari 5</span></div>
          <a class="cj-card cj-stat link-card" routerLink="/analytics/temuan"><span class="label">Temuan</span><span class="value">{{ finds().length }}</span><span class="sub">di {{ findRepos() }} repo</span></a>
        </div>
        <h2 class="cj-section-title">Rincian</h2>
        <div class="charts">
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">rate_review</span><h3>PR direview Chef Juno</h3></header>
            <div class="big">{{ posted().length }}</div>
            <cj-bar-chart [days]="days()" [series]="reviewSeries()" ariaLabel="Review per hari" />
            <h4>Repo teratas (jumlah review)</h4>
            <ol>@for (r of topRepos(); track r.key) {<li><span>{{ r.key }}</span><b>{{ r.count }}</b></li>} @empty {<li class="cj-muted">—</li>}</ol>
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">bug_report</span><h3>Temuan</h3></header>
            <div class="big">{{ finds().length }}</div>
            <cj-bar-chart [days]="days()" [series]="findSeries()" ariaLabel="Temuan per hari per severity" />
            <h4>Repo dengan temuan terbanyak</h4>
            <ol>@for (r of topFindRepos(); track r.key) {<li><span>{{ r.key }}</span><b>{{ r.count }}</b></li>} @empty {<li class="cj-muted">—</li>}</ol>
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">grade</span><h3>Skor rata-rata</h3></header>
            <div class="big">{{ num(avgScore()) }}</div>
            <cj-line-chart [days]="days()" [values]="scoreSeries()" [max]="5" color="var(--mat-sys-tertiary)" ariaLabel="Skor rata-rata per hari" seriesLabel="Skor rata-rata" />
            <h4>Repo menurut skor rata-rata</h4>
            <ol>@for (r of repoScores(); track r.key) {<li><span>{{ r.key }}</span><b>{{ num(r.avg) }}</b></li>} @empty {<li class="cj-muted">—</li>}</ol>
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">group</span><h3>Kontributor teratas</h3></header>
            <div class="big">{{ topAuthors()[0] ? '@' + topAuthors()[0].key : '—' }}</div>
            <cj-bar-chart [days]="days()" [series]="prSeries()" ariaLabel="PR per hari" />
            <h4>Kontributor teratas</h4>
            <ol>@for (a of topAuthors(); track a.key) {<li><a [routerLink]="['/rapor', a.key]">&#64;{{ a.key }}</a><b>{{ a.count }} PR</b></li>} @empty {<li class="cj-muted">—</li>}</ol>
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">task_alt</span><h3>Addressed rate</h3></header>
            <div class="big" data-testid="addressed-rate">{{ pct(rate()) }}</div>
            <cj-line-chart [days]="days()" [values]="rateSeries()" [max]="100" color="var(--mat-sys-primary)" [fmt]="pctFmt" ariaLabel="Addressed rate per hari" seriesLabel="Addressed rate" />
            <h4>Repo menurut addressed rate</h4>
            <ol>@for (r of repoRates(); track r.key) {<li><span>{{ r.key }}</span><b>{{ pct(r.rate) }}</b></li>} @empty {<li class="cj-muted">—</li>}</ol>
          </section>
          <section class="cj-card">
            <header><span class="material-symbols-rounded" aria-hidden="true">thumb_down</span><h3>Temuan dibantah</h3></header>
            <div class="big">{{ disputed().length }}</div>
            <cj-bar-chart [days]="days()" [series]="disputeSeries()" ariaLabel="Temuan dibantah per hari" />
            <h4>Paling sering dibantah</h4>
            <ol>@for (t of topDisputed(); track t.key) {<li><span>{{ t.key }}</span><b>{{ t.count }}</b></li>} @empty {<li class="cj-muted">Belum ada</li>}</ol>
          </section>
        </div>
      } @else {
        <h2 class="cj-section-title">Ikhtisar</h2>
        <div class="cj-grid sev" data-testid="findings-overview">
          <button type="button" class="cj-card cj-stat" [class.sel]="!sev()" (click)="sev.set('')"><span class="label">Semua temuan</span><span class="value">{{ finds().length }}</span></button>
          <button type="button" class="cj-card cj-stat" [class.sel]="sev() === 'security'" (click)="sev.set('security')"><span class="label">Keamanan</span><span class="value">{{ count('security') }}</span></button>
          <button type="button" class="cj-card cj-stat" [class.sel]="sev() === 'P0'" (click)="sev.set('P0')"><span class="label">P0</span><span class="value">{{ count('P0') }}</span></button>
          <button type="button" class="cj-card cj-stat" [class.sel]="sev() === 'P1'" (click)="sev.set('P1')"><span class="label">P1</span><span class="value">{{ count('P1') }}</span></button>
          <button type="button" class="cj-card cj-stat" [class.sel]="sev() === 'P2'" (click)="sev.set('P2')"><span class="label">P2</span><span class="value">{{ count('P2') }}</span></button>
        </div>
        <h2 class="cj-section-title">Daftar temuan</h2>
        <div class="toolbar">
          <label class="cj-search"><span class="material-symbols-rounded" aria-hidden="true">search</span>
            <input placeholder="Cari temuan, repo, PR, penulis, atau file…" (input)="q.set($any($event.target).value)" aria-label="Cari temuan" data-testid="findings-search" /></label>
          <cj-select label="Status" [options]="statusOpts" [value]="status()" (valueChange)="status.set($event)" testId="findings-status" />
          <cj-select label="Urutkan" [options]="sortOpts" [value]="sort()" (valueChange)="sort.set($event)" />
        </div>
        @if (!list().length) {
          <div class="cj-card"><cj-empty-state icon="bug_report" title="Tidak ada temuan" text="Coba ubah filter atau periode." /></div>
        } @else {
          <div class="cj-table-wrap">
            <table class="cj-table" data-testid="findings-table">
              <thead><tr><th>Temuan</th><th>Severity</th><th>Pull request</th><th>Status</th><th>Tanggal</th></tr></thead>
              <tbody>
                @for (x of page(); track x.id) {
                  <tr class="clickable" [routerLink]="['/reviews', x.jobId]">
                    <td class="finding">
                      <div><b [innerHTML]="mdi(x.title)"></b> <span class="cj-muted excerpt" [innerHTML]="mdi(first(x.body))"></span></div>
                      <div class="cj-muted small"><code>{{ x.path }}:{{ x.line }}</code> · {{ cat(x.category) }}{{ x.aiReply ? ' · AI coder: ' + x.aiReply : '' }}</div>
                    </td>
                    <td><cj-chip [tone]="tone(x.severity)">{{ x.severity }}</cj-chip></td>
                    <td class="nowrap">{{ x.repo }}<div class="cj-muted small">#{{ x.prNumber }} · &#64;{{ x.author }}</div></td>
                    <td><cj-chip [tone]="tone(x.outcome)">{{ statusLabel(x.outcome) }}</cj-chip></td>
                    <td class="nowrap cj-muted">{{ date(x.createdAtMs) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="pager">
            <span class="cj-muted">{{ pageIdx() * 20 + 1 }}–{{ min(list().length, pageIdx() * 20 + 20) }} dari {{ list().length }}</span>
            <button type="button" class="cj-btn-tonal" [disabled]="pageIdx() === 0" (click)="pageIdx.set(pageIdx() - 1)" aria-label="Halaman sebelumnya"><span class="material-symbols-rounded" aria-hidden="true">chevron_left</span></button>
            <button type="button" class="cj-btn-tonal" [disabled]="(pageIdx() + 1) * 20 >= list().length" (click)="pageIdx.set(pageIdx() + 1)" aria-label="Halaman berikutnya"><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></button>
          </div>
        }
      }
    </cj-page>
  `,
  styles: `
    .bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .stats { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); margin-bottom: 24px; }
    .stats > .cj-card:first-child { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .link-card { text-decoration: none; color: inherit; }
    .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
    .charts header { display: flex; align-items: center; gap: 8px; }
    .charts header .material-symbols-rounded { color: var(--mat-sys-primary); background: var(--mat-sys-primary-container); border-radius: 10px; padding: 4px; font-size: 20px; }
    h3 { font: var(--mat-sys-title-medium); margin: 0; }
    .big { font: var(--mat-sys-display-small); margin: 10px 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    h4 { font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); margin: 16px 0 6px; padding-top: 12px; border-top: 1px solid var(--mat-sys-outline-variant); }
    ol { list-style: none; margin: 0; padding: 0; }
    ol li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
    ol li a { color: inherit; }
    .sev { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); margin-bottom: 24px; }
    .sev button { border: 0; text-align: left; cursor: pointer; font: inherit; }
    .sev button.sel { outline: 2px solid var(--mat-sys-primary); }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .finding { max-width: 640px; }
    .finding > div:first-child { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .small { font: var(--mat-sys-body-small); margin-top: 4px; }
    .excerpt { margin-left: 8px; }
    .nowrap { white-space: nowrap; }
    .slink { color: inherit; font-weight: 500; }
    .hero { margin-bottom: 24px; font: var(--mat-sys-body-large); background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .hero p { margin: 0; }
    .tgt { margin-top: 8px; font: var(--mat-sys-label-small); padding: 2px 8px; border-radius: 999px; width: fit-content; background: var(--mat-sys-surface-container-high); color: var(--mat-sys-on-surface-variant); }
    .tgt[data-status='met'] { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .tgt[data-status='missed'] { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .examples { margin: -8px 0 24px; } .examples h3 { margin-bottom: 8px; } .examples ol li { justify-content: flex-start; align-items: center; }
    .note2 { margin: 12px 0 24px; font: var(--mat-sys-body-small); max-width: 900px; }
    .admin { display: grid; gap: 16px; }
    .admin .row1 { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; }
    .targets { display: flex; gap: 16px; flex-wrap: wrap; align-items: end; }
    .targets b { width: 100%; }
    .targets label { display: grid; gap: 4px; font: var(--mat-sys-label-medium); }
    .targets input { width: 140px; height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--mat-sys-outline); background: var(--mat-sys-surface-container-lowest); color: var(--mat-sys-on-surface); font: var(--mat-sys-body-medium); }
    .bad { color: var(--mat-sys-error); font-weight: 600; }
    .fix-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .fix header { display: flex; align-items: center; gap: 8px; }
    .fix header .material-symbols-rounded { color: var(--mat-sys-tertiary); background: var(--mat-sys-tertiary-container); border-radius: 10px; padding: 4px; font-size: 20px; }
    .fix ul { margin: 10px 0 0; padding-left: 18px; font: var(--mat-sys-body-medium); }
    .fix ul li { margin-bottom: 6px; }
    .fix ol li { display: block; }
    .fix .edit { margin-top: 12px; text-decoration: none; width: fit-content; }
    .note { margin: -12px 0 24px; font: var(--mat-sys-body-small); max-width: 900px; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .small-cell { font: var(--mat-sys-body-small); max-width: 280px; }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; margin-top: 8px; }
    @media (max-width: 720px) { .two { grid-template-columns: 1fr; } }
    .pager { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 12px; }
    .cj-btn-tonal { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px; border: 0; border-radius: 999px; cursor: pointer;
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font: var(--mat-sys-label-large); }
    .cj-btn-tonal:disabled { opacity: .45; cursor: default; }
  `,
})
export class AnalyticsPage {
  protected readonly mdi = miniInline;
  protected readonly mdb = miniMarkdown;
  private readonly fb = inject(FirebaseService);
  readonly tab = input<string>('pr');
  protected readonly periodOpts = PERIODS.map((p) => ({ value: p.days, label: p.label }));
  protected readonly repoOpts = computed(() => [{ value: '', label: 'Semua repositori' }, ...this.repos().map((r) => ({ value: r, label: r }))]);
  protected readonly authorOpts = computed(() => [{ value: '', label: 'Semua penulis' }, ...this.authors().map((a) => ({ value: a, label: '@' + a }))]);
  protected readonly statusOpts = [{ value: '', label: 'Semua status' }, ...Object.keys(STATUS_FIND).map((s) => ({ value: s, label: STATUS_FIND[s] }))];
  protected readonly sortOpts: { value: 'new' | 'sev'; label: string }[] = [{ value: 'new', label: 'Terbaru' }, { value: 'sev', label: 'Paling parah' }];
  protected readonly statusKeys = Object.keys(STATUS_FIND);
  protected readonly f = signal<Filters>({ repo: '', author: '', days: 14 });
  protected readonly q = signal('');
  protected readonly sev = signal('');
  protected readonly status = signal('');
  protected readonly sort = signal<'new' | 'sev'>('new');
  protected readonly pageIdx = signal(0);

  private readonly jobs = liveQuery<JobRow>(() => query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), orderBy('createdAt', 'desc'), limit(1000)), jobRow);
  /** semua jenis job (review, index, belajar, rapor) untuk analitik biaya — semua pemakaian agent dihitung */
  private readonly allJobs = liveQuery<JobRow>(() => (this.tab() === 'biaya' ? query(collection(this.fb.db, 'jobs'), orderBy('createdAt', 'desc'), limit(1500)) : null), jobRow);
  private readonly settingsDoc = liveDoc<Record<string, unknown>>(() => (['biaya', 'dampak'].includes(this.tab()) ? doc(this.fb.db, 'settings/global') : null), (_i, d) => d);
  // ---------- Dampak ----------
  protected readonly auth = inject(AuthService);
  private readonly prsQ = liveQuery<PrRow>(() => (this.tab() === 'dampak' ? query(collection(this.fb.db, 'prs'), orderBy('createdAt', 'desc'), limit(3000)) : null), prRow);
  private readonly repoIds = liveQuery<{ id: string; enabled: boolean }>(() => (this.tab() === 'dampak' ? collection(this.fb.db, 'repos') : null), (id, d) => ({ id, enabled: d['enabled'] !== false }));
  protected readonly targets = computed<ImpactTargets>(() => ({ ...DEFAULT_TARGETS, ...((this.settingsDoc().data?.['impactTargets'] ?? {}) as Partial<ImpactTargets>) }));
  protected readonly impact = computed(() =>
    impactMetrics({
      prs: this.prsQ().data.filter((p) => (!this.f().repo || p.repo === this.f().repo) && (!this.f().author || p.author === this.f().author)),
      allJobs: this.jobs().data,
      jobs: this.jobsF(),
      findings: this.finds(),
      days: this.f().days,
      targets: this.targets(),
    }),
  );
  protected readonly busy = signal(false);
  protected readonly backfillMsg = signal('');
  protected tgt = (s: TargetStatus) => (s === 'met' ? 'Tercapai' : s === 'missed' ? 'Belum tercapai' : 'Data belum cukup');
  protected mins = (v: number | null) => (v == null ? '—' : v < 60 ? `${Math.round(v)} menit` : `${(v / 60).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`);
  protected hours = (v: number | null) => (v == null ? '—' : v < 48 ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam` : `${(v / 24).toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`);
  protected round = Math.round;
  async backfill() {
    this.busy.set(true);
    this.backfillMsg.set('Mengambil riwayat PR dari GitHub…');
    try {
      let prs = 0;
      let reverts = 0;
      for (const r of this.repoIds().data.filter((x) => x.enabled)) {
        const res = await this.fb.call<{ repoId: number; days: number }, { prs: number; reverts: number }>('backfillPrs')({ repoId: Number(r.id), days: 60 });
        prs += res.prs;
        reverts += res.reverts;
      }
      this.backfillMsg.set(`Selesai: ${prs} PR dari 60 hari terakhir, ${reverts} revert terdeteksi.`);
    } catch (e) {
      this.backfillMsg.set('Gagal: ' + (e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  async setTarget(k: keyof ImpactTargets, v: number) {
    if (!Number.isFinite(v) || v < 0) return;
    await updateDoc(doc(this.fb.db, 'settings/global'), { impactTargets: { ...this.targets(), [k]: v }, updatedAt: serverTimestamp() });
  }
  protected readonly prices = computed(() => (this.settingsDoc().data?.['modelPrices'] ?? {}) as ModelPrices);
  private readonly costJobs = computed(() => filterJobs(this.allJobs().data, this.f()));
  protected readonly isPr = computed(() => !['temuan', 'biaya', 'skills', 'dampak'].includes(this.tab()));
  // ---------- Skills ----------
  private readonly skillDocs = liveQuery<Omit<SkillInfo, 'sizeBytes'> & { latestVersion: number }>(
    () => (this.tab() === 'skills' ? collection(this.fb.db, 'skills') : null),
    (id, d) => ({
      slug: id,
      name: String(d['name'] ?? id),
      enabled: d['enabled'] === true,
      source: String(d['source'] ?? 'team'),
      paths: Array.isArray(d['paths']) ? d['paths'] : [],
      latestVersion: Number(d['latestVersion'] ?? 0),
    }),
  );
  /** ukuran versi terbaru tiap skill (dibaca sekali per versi) */
  private readonly skillSizes = signal<Record<string, number>>({});
  private readonly sizeLoader = effect(() => {
    for (const s of this.skillDocs().data) {
      const key = `${s.slug}@${s.latestVersion}`;
      if (!s.latestVersion || key in this.skillSizes()) continue;
      this.skillSizes.update((m) => ({ ...m, [key]: -1 }));
      void getDoc(doc(this.fb.db, `skills/${s.slug}/versions/${s.latestVersion}`)).then((v) => {
        const files = (v.get('files') ?? {}) as Record<string, string>;
        const size = Object.values(files).reduce((a, x) => a + new TextEncoder().encode(String(x)).length, 0);
        this.skillSizes.update((m) => ({ ...m, [key]: size }));
      });
    }
  });
  protected readonly skillRows = computed(() => {
    const sizes = this.skillSizes();
    const infos: SkillInfo[] = this.skillDocs().data.map((s) => {
      const size = sizes[`${s.slug}@${s.latestVersion}`];
      return { slug: s.slug, name: s.name, enabled: s.enabled, source: s.source, paths: s.paths, sizeBytes: size != null && size >= 0 ? size : null };
    });
    // hanya skill yang masih ada; skill yang sudah dihapus tidak ditampilkan walau tercatat di review lama
    const exists = new Set(infos.map((i) => i.slug));
    return skillStats(this.jobsF(), this.finds(), infos).filter((r) => exists.has(r.slug));
  });
  protected warnCount = (s: { flags: { kind: string }[] }) => s.flags.filter((f) => f.kind === 'warn').length;
  protected readonly flagged = computed(() => this.skillRows().filter((s) => s.flags.some((f) => f.kind === 'warn')));
  protected readonly activeSkills = computed(() => this.skillRows().filter((s) => s.enabled).length);
  protected readonly avgLoaded = computed(() => {
    const rs = this.jobsF().filter((j) => j.status === 'posted' && (j.skillsLoaded.length || j.skillsSkipped.length));
    const exists = new Set(this.skillDocs().data.map((s) => s.slug));
    return rs.length ? rs.reduce((a, j) => a + j.skillsLoaded.filter((x) => exists.has(x)).length, 0) / rs.length : null;
  });
  protected readonly skillFinds = computed(() => this.finds().filter((f) => f.skill).length);
  protected readonly pctSkill = computed(() => `${Math.round((this.skillFinds() / Math.max(1, this.finds().length)) * 100)}%`);
  protected readonly tm = computed(() => timing(this.costJobs()));
  protected readonly byModel = computed(() => usageByModel(this.costJobs(), this.prices()));
  protected readonly byRole = computed(() => usageByRole(this.costJobs(), this.prices()));
  protected readonly modes = computed(() => byMode(this.costJobs()));
  protected readonly tokIn = computed(() => allPasses(this.costJobs()).reduce((a, p) => a + (p.inputTokens ?? 0), 0));
  protected readonly tokOut = computed(() => allPasses(this.costJobs()).reduce((a, p) => a + (p.outputTokens ?? 0), 0));
  protected readonly perReview = computed(() => tokensPerReview(this.costJobs()));
  protected readonly hasPrices = computed(() => Object.values(this.prices()).some((p) => p && (p.in > 0 || p.out > 0)));
  private readonly passCosts = computed(() => allPasses(this.costJobs()).map((p) => passCost(p, this.prices())));
  protected readonly totalCost = computed(() => (this.passCosts().some((c) => c != null) ? this.passCosts().reduce<number>((a, c) => a + (c ?? 0), 0) : null));
  protected readonly pricedShare = computed(() => (this.passCosts().length ? this.passCosts().filter((c) => c != null).length / this.passCosts().length : 0));
  protected readonly tokenSeries = computed(() => {
    const ps = this.costJobs().flatMap((j) => j.passes.map((p) => ({ p, at: j.createdAtMs })));
    return [
      { key: 'in', label: 'Token masuk', color: 'var(--mat-sys-primary)', values: perDay(ps, this.days(), (x) => x.at, (x) => x.p.inputTokens ?? 0) },
      { key: 'out', label: 'Token keluar', color: 'var(--mat-sys-tertiary)', values: perDay(ps, this.days(), (x) => x.at, (x) => x.p.outputTokens ?? 0) },
    ];
  });
  protected readonly durSeries = computed(() => {
    const done = this.costJobs().filter((j) => j.type === 'review' && j.status === 'posted' && j.durationMs != null);
    const sums = perDay(done, this.days(), (j) => j.createdAtMs, (j) => j.durationMs ?? 0);
    const counts = perDay(done, this.days(), (j) => j.createdAtMs);
    return sums.map((s, i) => (counts[i] ? s / counts[i] / 60_000 : null));
  });
  protected dur = (ms: number | null | undefined) => (ms == null ? '—' : fmtDuration(ms));
  protected int = fmtInt;
  protected roleName = (r: string) => ROLE_NAME[r] ?? r;
  protected usd = (v: number) => (v < 0.01 && v > 0 ? '< $0,01' : '$' + v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  protected compact = (v: number) => (v >= 1_000_000 ? (v / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt' : v >= 1000 ? (v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb' : Math.round(v).toLocaleString('id-ID'));
  private readonly findings = liveQuery<FindingRow>(() => query(collection(this.fb.db, 'findings'), orderBy('createdAt', 'desc'), limit(3000)), findingRow);

  protected readonly repos = computed(() => [...new Set(this.jobs().data.map((j) => j.repo))].sort());
  protected readonly authors = computed(() => [...new Set(this.jobs().data.map((j) => j.author).filter(Boolean))].sort());
  protected readonly days = computed(() => dayRange(Math.min(this.f().days, 30)));
  private readonly jobsF = computed(() => filterJobs(this.jobs().data, this.f()));
  protected readonly posted = computed(() => this.jobsF().filter((j) => j.status === 'posted'));
  protected readonly failed = computed(() => this.jobsF().filter((j) => j.status === 'failed').length);
  protected readonly finds = computed(() => filterFindings(this.findings().data, this.f()));
  protected readonly prCount = computed(() => new Set(this.posted().map((j) => `${j.repo}#${j.prNumber}`)).size);
  protected readonly avgScore = computed(() => {
    const s = this.posted().filter((j) => j.score != null);
    return s.length ? s.reduce((a, j) => a + (j.score ?? 0), 0) / s.length : null;
  });
  protected readonly findRepos = computed(() => new Set(this.finds().map((x) => x.repo)).size);
  protected readonly rate = computed(() => addressedRate(this.finds()));
  protected readonly disputed = computed(() => this.finds().filter((x) => x.outcome === 'disputed'));

  protected readonly reviewSeries = computed(() => [{ key: 'r', label: 'Review', color: 'var(--mat-sys-primary)', values: perDay(this.posted(), this.days(), (j) => j.createdAtMs) }]);
  protected readonly findSeries = computed(() =>
    (['P0', 'P1', 'P2'] as const).map((s, i) => ({
      key: s,
      label: s,
      color: ['var(--mat-sys-error)', 'var(--mat-sys-tertiary)', 'var(--mat-sys-outline)'][i],
      values: perDay(this.finds().filter((x) => x.severity === s), this.days(), (x) => x.createdAtMs),
    })),
  );
  protected readonly scoreSeries = computed(() => {
    const sums = perDay(this.posted(), this.days(), (j) => j.createdAtMs, (j) => j.score ?? 0);
    const counts = perDay(this.posted(), this.days(), (j) => j.createdAtMs);
    return sums.map((s, i) => (counts[i] ? s / counts[i] : null));
  });
  protected readonly prSeries = computed(() => {
    const top = this.topAuthors()[0]?.key;
    return [
      { key: 'top', label: top ? '@' + top : 'Teratas', color: 'var(--mat-sys-primary)', values: perDay(this.posted().filter((j) => j.author === top), this.days(), (j) => j.createdAtMs) },
      { key: 'other', label: 'Lainnya', color: 'var(--mat-sys-outline)', values: perDay(this.posted().filter((j) => j.author !== top), this.days(), (j) => j.createdAtMs) },
    ];
  });
  protected readonly rateSeries = computed(() => {
    const dec = this.finds().filter((x) => x.outcome !== 'pending');
    const all = perDay(dec, this.days(), (x) => x.createdAtMs);
    const ok = perDay(dec.filter((x) => x.outcome === 'addressed'), this.days(), (x) => x.createdAtMs);
    return all.map((a, i) => (a ? (ok[i] / a) * 100 : null));
  });
  protected readonly disputeSeries = computed(() => [{ key: 'd', label: 'Dibantah', color: 'var(--mat-sys-error)', values: perDay(this.disputed(), this.days(), (x) => x.createdAtMs) }]);
  protected readonly topRepos = computed(() => topBy(this.posted(), (j) => j.repo));
  protected readonly topFindRepos = computed(() => topBy(this.finds(), (x) => x.repo));
  protected readonly topAuthors = computed(() => {
    const prs = new Map<string, Set<string>>();
    for (const j of this.posted()) prs.set(j.author, (prs.get(j.author) ?? new Set()).add(`${j.repo}#${j.prNumber}`));
    return [...prs.entries()].map(([key, s]) => ({ key, count: s.size })).sort((a, b) => b.count - a.count).slice(0, 3);
  });
  protected readonly topDisputed = computed(() => topBy(this.disputed(), (x) => x.title));
  protected readonly repoScores = computed(() =>
    this.repos()
      .map((r) => {
        const s = this.posted().filter((j) => j.repo === r && j.score != null);
        return { key: r, avg: s.length ? s.reduce((a, j) => a + (j.score ?? 0), 0) / s.length : null };
      })
      .filter((x) => x.avg != null)
      .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))
      .slice(0, 3),
  );
  protected readonly repoRates = computed(() =>
    this.repos()
      .map((r) => ({ key: r, rate: addressedRate(this.finds().filter((x) => x.repo === r)) }))
      .filter((x) => x.rate != null)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
      .slice(0, 3),
  );

  protected readonly list = computed(() => {
    const q = this.q().toLowerCase();
    const sv = this.sev();
    const out = this.finds().filter(
      (x) =>
        (!sv || (sv === 'security' ? x.category === 'security' : x.severity === sv)) &&
        (!this.status() || x.outcome === this.status()) &&
        (!q || `${x.title} ${x.body} ${x.repo} #${x.prNumber} ${x.author} ${x.path}`.toLowerCase().includes(q)),
    );
    return this.sort() === 'sev' ? [...out].sort((a, b) => a.severity.localeCompare(b.severity)) : out;
  });
  protected readonly page = computed(() => this.list().slice(this.pageIdx() * 20, this.pageIdx() * 20 + 20));

  protected count = (k: string) => this.finds().filter((x) => (k === 'security' ? x.category === 'security' : x.severity === k)).length;
  protected num = (n: number | null) => fmtNum(n, 1);
  protected pct = fmtPct;
  protected pctFmt = (v: number) => `${Math.round(v)}%`;
  protected date = (ms: number | null) => fmtDate(ms);
  protected first = (s: string) => s.split('\n')[0];
  protected tone = (s: string) => STATUS_TONE[s] ?? 'neutral';
  protected statusLabel = (s: string) => STATUS_FIND[s] ?? s;
  protected cat = (c: string) => CATEGORY_LABEL[c] ?? c;
  protected min = Math.min;

  set<K extends keyof Filters>(k: K, v: Filters[K]) {
    this.f.update((x) => ({ ...x, [k]: v }));
    this.pageIdx.set(0);
  }

  export() {
    if (this.tab() === 'dampak') {
      const m = this.impact();
      download(
        `chefjuno-dampak-${this.f().days}h.csv`,
        toCsv([
          { metrik: 'presisi', nilai: m.precision ?? '', target: this.targets().precision, status: m.precisionStatus },
          { metrik: 'bug_p0_p1_diperbaiki', nilai: m.bugsCaught, target: '', status: '' },
          { metrik: 'bug_per_minggu', nilai: m.bugsPerWeek ?? '', target: this.targets().bugsPerWeek, status: m.bugsStatus },
          { metrik: 'adopsi', nilai: m.adoption ?? '', target: '', status: '' },
          { metrik: 'pemakaian_ulang', nilai: m.reuse ?? '', target: this.targets().reuse, status: m.reuseStatus },
          { metrik: 'feedback_median_menit', nilai: m.feedbackMedianMin ?? '', target: this.targets().feedbackMinutes, status: m.feedbackStatus },
          { metrik: 'review_manusia_median_menit', nilai: m.humanReviewMedianMin ?? '', target: '', status: '' },
          { metrik: 'revert_direview', nilai: m.revertRateReviewed ?? '', target: '', status: '' },
          { metrik: 'revert_tidak_direview', nilai: m.revertRateNotReviewed ?? '', target: '', status: '' },
          { metrik: 'token_per_temuan_berguna', nilai: m.tokensPerUseful ?? '', target: '', status: '' },
        ]),
      );
    } else if (this.tab() === 'skills') {
      download(
        `chefjuno-skills-${this.f().days}h.csv`,
        toCsv(this.skillRows().map((s) => ({ skill: s.slug, nama: s.name, aktif: s.enabled, dimuat: s.loaded, dilewati: s.skipped, terpotong: s.dropped, temuan: s.findings, diperbaiki: s.addressed, dibantah: s.disputed, perkiraan_token: s.approxTokens ?? '', saran: s.flags.map((f) => f.text).join(' / ') }))),
      );
    } else if (this.tab() === 'biaya') {
      download(
        `chefjuno-biaya-model-${this.f().days}h.csv`,
        toCsv(this.byModel().map((m) => ({ model: m.key, dipakai_untuk: m.detail.join(' / '), panggilan: m.calls, gagal: m.failed, token_masuk: m.inputTokens, token_keluar: m.outputTokens, rata_durasi_detik: m.avgDurationMs == null ? '' : Math.round(m.avgDurationMs / 1000), estimasi_usd: m.cost == null ? '' : m.cost.toFixed(4) }))),
      );
    } else if (this.tab() === 'temuan') {
      download(
        `chefjuno-temuan-${this.f().days}h.csv`,
        toCsv(this.list().map((x) => ({ tanggal: this.date(x.createdAtMs), severity: x.severity, kategori: x.category, judul: x.title, repo: x.repo, pr: x.prNumber, penulis: x.author, file: `${x.path}:${x.line}`, status: this.statusLabel(x.outcome) }))),
      );
    } else {
      download(
        `chefjuno-review-${this.f().days}h.csv`,
        toCsv(this.jobsF().map((j) => ({ tanggal: this.date(j.createdAtMs), repo: j.repo, pr: j.prNumber, judul: j.prTitle, penulis: j.author, status: j.status, skor: j.score ?? '', temuan: j.findings, agent: j.agent ?? '' }))),
      );
    }
  }
}
