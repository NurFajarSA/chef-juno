import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { collection, doc, query, where } from 'firebase/firestore';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButton } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../core/auth.service';
import { CjPage } from '../ui/page';
import { miniInline, miniMarkdown } from '../core/md';
import { CjChip, STATUS_TONE } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { FirebaseService } from '../core/firebase';
import { liveDoc, liveQuery } from '../core/live';
import { CATEGORY_LABEL, OUTCOME_LABEL, STATUS_LABEL, fmtDateTime, fmtDuration, fmtInt, toMs } from '../core/format';
import { findingRow, jobRow, type FindingRow } from '../core/rows';
import { CjEvidence, type EvidenceShot } from '../ui/evidence';

interface Detail {
  id: string;
  d: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- dokumen job dibaca bebas untuk tampilan
}

interface ActEvent {
  kind: 'think' | 'tool' | 'text';
  text: string;
  at: number;
}

@Component({
  selector: 'cj-review-detail',
  imports: [CjPage, CjChip, CjEmptyState, CjEvidence, MatExpansionModule, RouterLink, MatButton],
  template: `
    @let j = job().data;
    <cj-page back="/reviews" backLabel="Review Kode" icon="rate_review" [heading]="j ? 'PR #' + j.d['pr']?.number + ' — ' + (j.d['pr']?.title ?? '') : 'Detail review'">
      @if (j) {
        <ng-container ngProjectAs="[meta]">
        <span meta><span class="material-symbols-rounded" aria-hidden="true" style="font-size:18px">folder_code</span>{{ j.d['repo']?.fullName }}</span>
        <span meta>{{ dt(j.d['createdAt']) }}</span>
        <span meta>&#64;{{ j.d['pr']?.authorLogin }}</span>
        @if (j.d['pr']?.htmlUrl) {<a meta [href]="j.d['pr'].htmlUrl" target="_blank" rel="noopener">Buka di GitHub <span class="material-symbols-rounded" aria-hidden="true" style="font-size:16px">open_in_new</span></a>}
        </ng-container>
      }
      @if (job().loading) {
        <div class="cj-skeleton" style="height: 200px"></div>
      } @else if (!j) {
        <div class="cj-card"><cj-empty-state icon="search_off" title="Review tidak ditemukan" /></div>
      } @else {
        @let r = j.d['result'];
        @if (steps().length) {
          <section class="cj-card proc" aria-labelledby="proses-h" data-testid="review-progress">
            <h2 id="proses-h">Proses agent</h2>
            <ol class="steps" aria-live="polite">
              @for (s of steps(); track s.key) {
                <li [class]="s.status" [attr.data-step]="s.key">
                  <div class="srow">
                    <span class="material-symbols-rounded ic" aria-hidden="true">{{ s.status === 'running' ? 'progress_activity' : s.status === 'done' ? 'check_circle' : 'error' }}</span>
                    <span class="lbl">{{ s.label }}</span>
                    <span class="cdk-visually-hidden">{{ s.status === 'running' ? 'sedang berjalan' : s.status === 'done' ? 'selesai' : 'gagal' }}</span>
                    <span class="dur">{{ stepDur(s) }}</span>
                  </div>
                  @if (actFor(s.key); as evs) {
                    <details class="act" data-testid="step-activity">
                      <summary>Intip kerja agent ({{ evs.length }} aktivitas)</summary>
                      <ol>
                        @for (e of evs; track $index) {
                          <li [class]="'k-' + e.kind">
                            <span class="material-symbols-rounded" aria-hidden="true">{{ e.kind === 'think' ? 'psychology' : e.kind === 'tool' ? 'build' : 'chat' }}</span>
                            <span class="cdk-visually-hidden">{{ e.kind === 'think' ? 'berpikir' : e.kind === 'tool' ? 'alat' : 'keputusan' }}</span>
                            <time class="cj-muted">{{ clock(e.at) }}</time>
                            <span class="tx">{{ e.text }}</span>
                          </li>
                        }
                      </ol>
                    </details>
                  }
                </li>
              }
            </ol>
          </section>
        }
        <div class="top">
          <div class="cj-card head" data-testid="review-summary">
            <div class="cj-row-actions">
              <cj-chip [tone]="tone(j.d['status'])">{{ label(j.d['status']) }}</cj-chip>
              @let sc = r?.effectiveScore ?? r?.score;
              @if (sc !== undefined && sc !== null) {<cj-chip [tone]="sc >= 4 ? 'success' : sc >= 3 ? 'warning' : 'error'">Skor {{ sc }}/5</cj-chip>}
              @if (r?.reviewCompletion === 'incomplete') {<cj-chip tone="warning" icon="rule">Review sebagian</cj-chip>}
              <cj-chip>prompt persona v{{ j.d['promptVersions']?.persona }} / review v{{ j.d['promptVersions']?.review }}</cj-chip>
              @if (canCancel()) {
                <button matButton="outlined" type="button" class="cancel" data-testid="cancel-job" [disabled]="cancelling()" (click)="cancel()">
                  <span class="material-symbols-rounded" aria-hidden="true">stop_circle</span>{{ cancelling() ? 'Membatalkan…' : (active(j.d['status']) ? 'Batalkan review' : 'Batalkan uji aplikasi') }}
                </button>
              }
            </div>
            @if (r?.reviewCompletion === 'incomplete') {
              <p class="partial" role="status" data-testid="review-partial"><span class="material-symbols-rounded" aria-hidden="true">rule</span>
                Review sebagian — {{ r.incompleteReason || r.uncertainty || 'ada bagian yang tidak bisa dinilai' }} Jangan anggap PR ini bersih hanya dari review ini.</p>
            }
            @if (r?.verdict) {<blockquote [innerHTML]="mdi(r.verdict)"></blockquote>}
            @if (r?.uncertainty && r?.reviewCompletion !== 'incomplete') {<p class="cj-muted unc">Ketidakpastian: {{ r.uncertainty }}</p>}
            @if (r?.summary) {<div [innerHTML]="mdb(r.summary)"></div>}
            @if (r?.lessons?.length) {
              <h3>Yang perlu kamu pahami dari PR ini</h3>
              <ul>@for (l of r.lessons; track $index) {<li [innerHTML]="mdi(l)"></li>}</ul>
            }
            @if (r?.impact?.length) {
              <h3>Dampak (dari code map)</h3>
              <ul>@for (l of r.impact; track $index) {<li [innerHTML]="mdi(l)"></li>}</ul>
            }
            @if (j.d['error']) {
              <p class="err" role="alert">Gagal di tahap <code>{{ j.d['error'].stage }}</code>: {{ j.d['error'].message }}</p>
            }
          </div>
          @if (history().length > 1) {
            <div class="cj-card hist" data-testid="review-history">
              <h3>Riwayat review PR ini ({{ history().length }})</h3>
              <ol>
                @for (h of history(); track h.id) {
                  <li [class.cur]="h.id === j.id">
                    @if (h.id === j.id) {<b>{{ dt(h.createdAt) }}</b>} @else {<a [routerLink]="['/reviews', h.id]">{{ dt(h.createdAt) }}</a>}
                    <span>diminta &#64;{{ h.trigger || '—' }}</span>
                    <span class="cj-muted">{{ statusLabel(h.status) }}@if (h.score !== null) { · {{ h.score }}/5}@if (h.findings) { · {{ h.findings }} temuan}</span>
                    @if (h.id === j.id) {<span class="cj-muted">(yang dibuka)</span>}
                  </li>
                }
              </ol>
            </div>
          }
          <div class="cj-card meta">
            <h3>Meta</h3>
            <dl>
              <dt>Agent</dt><dd>{{ r?.meta?.agent === 'codex' ? 'Codex' : r?.meta?.agent === 'claude' ? 'Claude Code' : '—' }}</dd>
              <dt>Model</dt><dd>{{ r?.meta?.model ?? 'default' }}</dd>
              <dt>Isolasi</dt><dd>{{ r?.meta?.isolation ?? '—' }}</dd>
              <dt>Token</dt><dd>{{ int(r?.meta?.inputTokens) }} masuk · {{ int(r?.meta?.outputTokens) }} keluar</dd>
              <dt>Durasi</dt><dd>{{ dur(r?.meta?.durationMs) }}</dd>
              <dt>Mesin</dt><dd>{{ j.d['machineId'] ?? '—' }}</dd>
              <dt>Pemicu</dt><dd>&#64;{{ j.d['trigger']?.userLogin }} · {{ j.d['trigger']?.command }}</dd>
              <dt>Commit</dt><dd><code>{{ (j.d['pr']?.headSha ?? '').slice(0, 7) }}</code></dd>
              <dt>Dibuat</dt><dd>{{ dt(j.d['createdAt']) }}</dd>
              <dt>Percobaan</dt><dd>{{ j.d['attempts'] }}</dd>
              <dt>Mode</dt><dd data-testid="review-mode">{{ r?.meta?.mode === 'deep' ? 'Mendalam' : 'Standar' }}@if (r?.meta?.modeDecision; as md) {<span class="cj-muted"> · {{ md.requested === 'auto' ? 'dipilih otomatis (' + md.by + ')' : 'dari ' + md.by }}: {{ md.reason }}</span>}</dd>
            </dl>
            @if (r?.meta?.passes?.length) {
              <details class="passes" data-testid="review-passes">
                <summary>{{ r.meta.passes.length }} putaran agent · {{ int(r?.meta?.inputTokens) }} token masuk</summary>
                <ul>
                  @for (p of r.meta.passes; track $index) {
                    <li [class.bad]="!p.ok"><b>{{ passLabel(p.role, p.label) }}</b> <code>{{ p.model ?? 'default' }}</code> · {{ dur(p.durationMs) }}{{ p.inputTokens ? ' · ' + int(p.inputTokens) + ' token' : '' }}{{ p.ok ? '' : ' · gagal' }}</li>
                  }
                </ul>
              </details>
            }
            @if (r?.meta?.verification; as v) {
              <div class="verify" data-testid="review-verification">
                <h3>Verifikasi statis</h3>
                @if (v.ran) {
                  <p>{{ v.newIssues?.length ? v.newIssues.length + ' masalah baru dibanding branch tujuan' : 'Tidak ada masalah baru' }} · <code>{{ v.image }}</code> · {{ dur(v.durationMs) }}</p>
                  @if (v.newIssues?.length) {<ul>@for (i of v.newIssues; track $index) {<li><code>{{ i }}</code></li>}</ul>}
                } @else {
                  <p class="cj-muted">Tidak dijalankan: {{ v.reason }}</p>
                }
              </div>
            }
            @if (r?.meta?.appVerification; as a) {
              <div class="verify" data-testid="review-app-verification">
                <h3>Uji aplikasi</h3>
                @if (a.ran) {
                  <p>{{ a.scenarios?.length ?? 0 }} skenario dicoba · login akun testing {{ a.loginOk ? 'berhasil' : 'gagal' }}{{ a.buildMs ? ' · build ' + dur(a.buildMs) : '' }}{{ a.runMs ? ' · uji ' + dur(a.runMs) : '' }}</p>
                  <ul>
                    @for (s of a.scenarios; track $index) {
                      <li><b>{{ evShort(s.status) }}</b> — {{ s.title }}
                        <details class="steps"><summary>Langkah ({{ s.steps.length }}){{ s.console?.length ? ' · ' + s.console.length + ' error konsol' : '' }}</summary>
                          <ol>@for (st of s.steps; track $index) {<li [class.bad]="!st.ok"><code>{{ st.do }}</code>{{ st.ok ? '' : ' — ' + st.error }}</li>}</ol>
                          @if (s.console?.length) {<p class="cj-muted">Konsol: {{ s.console.join(' | ') }}</p>}
                        </details>
                      </li>
                    }
                    @for (s of a.skipped ?? []; track $index) {<li class="cj-muted">Tidak dicoba — {{ s.title }}: {{ s.reason }}</li>}
                  </ul>
                } @else {
                  <p class="cj-muted">Tidak dijalankan: {{ a.reason }}</p>
                }
              </div>
            }
          </div>
        </div>
        <div class="cj-card">
          <h2>Temuan ({{ posted().length }})</h2>
          @for (f of posted(); track f.id) {
            <article class="finding">
              <div class="cj-row-actions">
                <cj-chip [tone]="tone(f.severity)">{{ f.severity }}</cj-chip>
                <cj-chip>{{ cat(f.category) }}</cj-chip>
                <cj-chip [tone]="tone(f.outcome)">{{ out(f.outcome) }}</cj-chip>
                <code>{{ f.path }}:{{ f.line }}</code>
                @if (f.url) {<a [href]="f.url" target="_blank" rel="noopener">komentar inline</a>} @else {<span class="cj-muted">di ringkasan</span>}
                @if (f.confidence !== null) {<span class="conf" [attr.title]="'Keyakinan reviewer'">keyakinan {{ pct(f.confidence) }}</span>}
              </div>
              <h3 [innerHTML]="mdi(f.title)"></h3>
              <div class="pre" [innerHTML]="mdb(f.body)"></div>
              @if (f.trigger) {<p class="trg"><b>Muncul saat:</b> {{ f.trigger }}</p>}
              @if (f.evidence; as e) {<cj-evidence [evidence]="e" [shots]="shotMap()" />}
              @if (f.aiReply) {<p class="cj-muted">Balasan AI coder: {{ f.aiReply }}</p>}
            </article>
          } @empty {
            <p class="cj-muted">{{ j.d['status'] !== 'posted' ? 'Belum ada temuan (review belum diposting).' : r?.reviewCompletion === 'incomplete' ? 'Tidak ada temuan di bagian yang sempat dinilai.' : 'Bersih. Merge.' }}</p>
          }
          @if (heldRows().length) {
            <details class="held" data-testid="held-findings">
              <summary>Ditahan, tidak diposting ke PR ({{ heldRows().length }}) — keyakinan rendah / di bawah ambang prioritas</summary>
              @for (f of heldRows(); track f.id) {
                <article class="finding">
                  <div class="cj-row-actions">
                    <cj-chip [tone]="tone(f.severity)">{{ f.severity }}</cj-chip>
                    <cj-chip>{{ cat(f.category) }}</cj-chip>
                    <cj-chip>{{ f.held === 'priority' ? 'di bawah ambang prioritas' : 'keyakinan rendah' }}</cj-chip>
                    <code>{{ f.path }}:{{ f.line }}</code>
                    @if (f.confidence !== null) {<span class="conf">keyakinan {{ pct(f.confidence) }}</span>}
                  </div>
                  <h3 [innerHTML]="mdi(f.title)"></h3>
                  <div class="pre" [innerHTML]="mdb(f.body)"></div>
                  @if (f.trigger) {<p class="trg"><b>Muncul saat:</b> {{ f.trigger }}</p>}
                  @if (f.evidence; as e) {<cj-evidence [evidence]="e" [shots]="shotMap()" />}
                </article>
              }
            </details>
          }
          @if (r?.droppedByValidation?.length) {
            <details class="held">
              <summary>Dibuang validator ({{ r.droppedByValidation.length }})</summary>
              <ul>@for (d of r.droppedByValidation; track $index) {<li><b>{{ d.title }}</b> <span class="cj-muted">— {{ d.reason }}</span></li>}</ul>
            </details>
          }
          @if (r?.suppressed?.length) {
            <h3>Di-suppress oleh memory tim ({{ r.suppressed.length }})</h3>
            <ul>@for (s of r.suppressed; track $index) {<li><span [innerHTML]="mdi(s.title)"></span> <span class="cj-muted">&nbsp;({{ s.path }}:{{ s.line }}, aturan {{ s.ruleId }})</span></li>}</ul>
          }
        </div>
        @if (r?.rawOutput) {
          <mat-accordion>
            <mat-expansion-panel>
              <mat-expansion-panel-header><mat-panel-title>Output mentah agent</mat-panel-title></mat-expansion-panel-header>
              <pre class="raw">{{ r.rawOutput }}</pre>
            </mat-expansion-panel>
          </mat-accordion>
        }
      }
    </cj-page>
  `,
  styles: `
    .hist ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 6px; }
    .hist li { display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .hist li.cur { font-weight: 500; }
    .proc { margin-bottom: 16px; }
    .proc h2 { font: var(--mat-sys-title-medium); margin: 0 0 8px; }
    .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .steps > li { font: var(--mat-sys-body-medium); }
    .steps .srow { display: flex; align-items: center; gap: 10px; }
    .act { margin: 4px 0 8px 30px; }
    .act summary { cursor: pointer; color: var(--mat-sys-primary); font: var(--mat-sys-label-large); }
    .act ol { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; max-height: 480px; overflow: auto; }
    .act li { display: grid; grid-template-columns: 20px auto 1fr; gap: 8px; align-items: start; font: var(--mat-sys-body-small); }
    .act li .material-symbols-rounded { font-size: 18px; color: var(--mat-sys-on-surface-variant); }
    .act li.k-think .tx { font-style: italic; color: var(--mat-sys-on-surface-variant); }
    .act li.k-tool .tx { font-family: var(--cj-mono, ui-monospace, monospace); word-break: break-all; }
    .act .tx { white-space: pre-wrap; overflow-wrap: anywhere; }
    .steps .ic { font-size: 20px; color: var(--mat-sys-on-surface-variant); }
    .steps li.done .ic { color: var(--cj-success, #1b873f); }
    .steps li.failed .ic { color: var(--mat-sys-error); }
    .steps li.running .ic { color: var(--mat-sys-primary); animation: cj-spin 1.2s linear infinite; }
    .steps .lbl { flex: 1; }
    .steps .dur { color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; }
    @keyframes cj-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .steps li.running .ic { animation: none; } }
    .passes { margin-top: 12px; } .passes summary { cursor: pointer; font: var(--mat-sys-label-large); }
    .passes ul, .verify ul { margin: 6px 0 0; padding-left: 18px; font: var(--mat-sys-body-small); }
    .passes li.bad, .steps li.bad { color: var(--mat-sys-error); }
    .steps summary { cursor: pointer; } .steps ol { margin: 4px 0; padding-left: 18px; }
    .verify { margin-top: 12px; } .verify h3 { font: var(--mat-sys-title-small); margin: 0 0 4px; } .verify p { margin: 0; font: var(--mat-sys-body-small); }
    .partial { display: flex; gap: 8px; align-items: flex-start; padding: 10px 14px; border-radius: 12px; background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .unc { font: var(--mat-sys-body-small); }
    .conf { font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant); }
    .trg { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); margin: 4px 0 0; }
    .held { margin-top: 16px; padding: 12px 16px; border-radius: 16px; background: var(--mat-sys-surface-container-low); }
    .held summary { cursor: pointer; font: var(--mat-sys-title-small); }
    .top { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 900px) { .top { grid-template-columns: 1fr; } }
    blockquote { margin: 16px 0; padding-left: 12px; border-left: 4px solid var(--mat-sys-primary); font: var(--mat-sys-title-medium); }
    h2 { font: var(--mat-sys-title-large); margin: 0 0 12px; }
    h3 { font: var(--mat-sys-title-small); margin: 16px 0 4px; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
    dt { color: var(--mat-sys-on-surface-variant); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .finding { padding: 12px 0; border-top: 1px solid var(--mat-sys-outline-variant); }
    .finding h3 { font: var(--mat-sys-title-medium); margin: 8px 0 4px; }
    .pre { white-space: pre-wrap; margin: 0; }
    .raw { white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 400px; overflow: auto; }
    .err { color: var(--mat-sys-error); }
    mat-accordion { display: block; margin: 16px 0; }
  `,
})
export class ReviewDetailPage {
  protected readonly mdi = miniInline;
  protected readonly mdb = miniMarkdown;
  private readonly fb = inject(FirebaseService);
  readonly jobId = input.required<string>();
  protected readonly job = liveDoc<Detail>(() => doc(this.fb.db, `jobs/${this.jobId()}`), (id, d) => ({ id, d }));
  protected readonly findings = liveQuery<FindingRow>(() => query(collection(this.fb.db, 'findings'), where('jobId', '==', this.jobId())), findingRow);
  /** semua review untuk PR yang sama (siapa yang meminta, kapan, hasilnya), terbaru dulu */
  private readonly prKey = computed(() => {
    const d = this.job().data?.d as { type?: string; pr?: { number?: number }; repo?: { fullName?: string } } | undefined;
    return d?.pr?.number && d.repo?.fullName ? { n: d.pr.number, repo: d.repo.fullName } : null;
  });
  private readonly prJobs = liveQuery(
    () => {
      const k = this.prKey();
      return k
        ? query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), where('pr.number', '==', k.n), where('repo.fullName', '==', k.repo))
        : null;
    },
    (id, d) => ({ ...jobRow(id, d), createdAt: d['createdAt'] }),
  );
  protected readonly history = computed(() => [...this.prJobs().data].sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)));
  protected statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  protected readonly cancelling = signal(false);
  protected active = (s: unknown) => ['queued', 'claimed', 'running'].includes(String(s));
  /** review atau uji aplikasinya masih berjalan, dan yang melihat adalah admin atau peminta review ini */
  protected readonly canCancel = computed(() => {
    const d = this.job().data?.d;
    if (!d) return false;
    const running = this.active(d['status']) || this.active(this.appJob().data?.d['status']);
    const me = this.auth.membership()?.githubLogin?.toLowerCase();
    const requester = String((d['trigger'] as { userLogin?: string } | undefined)?.userLogin ?? '').toLowerCase();
    return running && (this.auth.isAdmin() || (!!me && me === requester));
  });
  async cancel() {
    this.cancelling.set(true);
    try {
      const r = await this.fb.call<{ jobId: string }, { cancelled: string[] }>('cancelJob')({ jobId: this.jobId() });
      this.snack.open(`Dibatalkan (${r.cancelled.length} job). Mesin menghentikan agent-nya.`, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open(`Gagal membatalkan: ${(e as Error).message}`, 'Tutup', { duration: 6000 });
    } finally {
      this.cancelling.set(false);
    }
  }
  protected readonly sorted = computed(() => [...this.findings().data].sort((a, b) => a.severity.localeCompare(b.severity)));
  protected readonly posted = computed(() => this.sorted().filter((f) => !f.held));
  protected readonly heldRows = computed(() => this.sorted().filter((f) => !!f.held));
  protected pct = (n: number) => `${Math.round(n * 100)}%`;
  protected passLabel = (r: string, label?: string) =>
    label === 'app-judge'
      ? 'Penilai uji aplikasi'
      : (({ review: 'Review', triage: 'Triase', lens: 'Spesialis', validate: 'Validasi', lead: 'Lead', app: 'Rencana uji aplikasi' }) as Record<string, string>)[r] ?? r;
  protected evShort = (s: string) =>
    (({ reproduced: 'Terbukti', not_reproduced: 'Tidak muncul', inconclusive: 'Belum meyakinkan' }) as Record<string, string>)[s] ?? s;
  /** screenshot bukti uji aplikasi (jobs/{id}/evidence), JPEG base64 */
  private readonly evidenceDocs = liveQuery<EvidenceShot>(
    () => collection(this.fb.db, `jobs/${this.jobId()}/evidence`),
    (id, d) => ({ id, name: String(d['name'] ?? id), src: `data:image/jpeg;base64,${d['data'] ?? ''}` }),
  );
  /** uji aplikasi berjalan sebagai job lanjutan: buktinya di jobs/{appJobId}/evidence */
  private readonly appJobId = computed(() => {
    const id = (this.job().data?.d as { github?: { appJobId?: string } } | undefined)?.github?.appJobId;
    return typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id) ? id : null;
  });
  private readonly appEvidenceDocs = liveQuery<EvidenceShot>(
    () => (this.appJobId() ? collection(this.fb.db, `jobs/${this.appJobId()}/evidence`) : null),
    (id, d) => ({ id, name: String(d['name'] ?? id), src: `data:image/jpeg;base64,${d['data'] ?? ''}` }),
  );
  /** job uji aplikasi lanjutan (untuk timeline prosesnya) */
  private readonly appJob = liveDoc<Detail>(
    () => (this.appJobId() ? doc(this.fb.db, `jobs/${this.appJobId()}`) : null),
    (id, d) => ({ id, d }),
  );
  /** aktivitas agent per langkah (berpikir, alat, keputusan) — review & uji aplikasi */
  private readonly actDocs = liveQuery(
    () => collection(this.fb.db, `jobs/${this.jobId()}/activity`),
    (_id, d) => ({ key: `r-${String(d['step'])}`, seq: Number(d['seq'] ?? 0), events: (d['events'] ?? []) as ActEvent[] }),
  );
  private readonly appActDocs = liveQuery(
    () => (this.appJobId() ? collection(this.fb.db, `jobs/${this.appJobId()}/activity`) : null),
    (_id, d) => ({ key: `a-${String(d['step'])}`, seq: Number(d['seq'] ?? 0), events: (d['events'] ?? []) as ActEvent[] }),
  );
  private readonly actMap = computed(() => {
    const m = new Map<string, ActEvent[]>();
    for (const d of [...this.actDocs().data, ...this.appActDocs().data].sort((a, b) => a.seq - b.seq))
      m.set(d.key, [...(m.get(d.key) ?? []), ...d.events]);
    return m;
  });
  protected actFor = (key: string) => this.actMap().get(key) ?? null;
  protected clock = (ms: number) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  /** detik berjalan untuk langkah yang masih berjalan */
  private readonly now = signal(Date.now());
  protected readonly steps = computed(() => {
    type Step = { key: string; label: string; status: 'running' | 'done' | 'failed'; startedAt: number; endedAt: number | null };
    const main = ((this.job().data?.d['progress'] ?? []) as Step[]).map((s) => ({ ...s, key: `r-${s.key}` }));
    const app = ((this.appJob().data?.d['progress'] ?? []) as Step[]).map((s) => ({ ...s, key: `a-${s.key}` }));
    return [...main, ...app];
  });
  protected stepDur(s: { startedAt: number; endedAt: number | null }) {
    const ms = (s.endedAt ?? this.now()) - s.startedAt;
    return ms > 0 ? fmtDuration(ms) : '';
  }
  protected readonly shotMap = computed(
    () => new Map([...this.evidenceDocs().data, ...this.appEvidenceDocs().data].map((s) => [s.id, s])),
  );
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
  private scrolledTo: string | null = null;
  constructor() {
    // timeline: perbarui durasi langkah yang masih berjalan tiap detik
    const tick = setInterval(() => {
      if (this.steps().some((s) => s.status === 'running')) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // tautan dari komentar PR: /reviews/{id}#bukti-{shot} → gulir ke screenshot setelah data dimuat
    effect(() => {
      const frag = this.fragment();
      if (!frag?.startsWith('bukti-') || !this.shotMap().has(frag.slice(6)) || !this.findings().data.length) return;
      if (this.scrolledTo === frag) return;
      this.scrolledTo = frag;
      setTimeout(() => document.getElementById(frag)?.scrollIntoView({ block: 'center' }));
    });
  }
  protected tone = (s: string) => STATUS_TONE[s] ?? 'neutral';
  protected label = (s: string) => STATUS_LABEL[s] ?? s;
  protected cat = (c: string) => CATEGORY_LABEL[c] ?? c;
  protected out = (o: string) => OUTCOME_LABEL[o] ?? o;
  protected dur = fmtDuration;
  protected int = fmtInt;
  protected dt = (t: unknown) => fmtDateTime(toMs(t as never));
}
