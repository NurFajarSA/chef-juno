import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { z } from 'zod';
import { CATEGORIES } from '@chefjuno/shared';
import { CjPage } from '../ui/page';
import { CjSelect } from '../ui/select';
import { CjMdEditor } from '../ui/md-editor';
import { miniInline, miniMarkdown } from '../core/md';
import { CjChip } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveQuery } from '../core/live';
import { CATEGORY_LABEL, fmtDateTime, fmtRelative, toMs } from '../core/format';

interface RuleRow {
  id: string;
  text: string;
  kind: string;
  category: string;
  status: string;
  source: string;
  repoId: string | null;
  paths: string[];
  evidence: string[];
  usageCount: number;
  lastUsedAtMs: number | null;
  createdAtMs: number | null;
  matchTitle: string | null;
}

const RuleForm = z.object({
  text: z.string().trim().min(5, 'Aturan minimal 5 karakter').max(1000),
  category: z.enum(CATEGORIES),
  paths: z.string(),
});

@Component({
  selector: 'cj-memory',
  imports: [CjPage, CjSelect, CjMdEditor, CjChip, CjEmptyState, RouterLink, MatButton, MatIconButton, MatTooltip, MatSlideToggle, MatCheckbox, MatFormFieldModule, MatInput, MatTabsModule, FormField],
  template: `
    <cj-page heading="Memory" subtitle="Yang dipelajari Chef Juno dari tim. Usulan tidak berlaku sebelum disetujui admin.">
      <mat-tab-group animationDuration="0ms">
        <mat-tab [label]="'Aturan tim (' + active().length + ')'">
          <div class="pane" data-testid="memory-active">
            @if (!team().length) {
              <div class="cj-card"><cj-empty-state icon="rule" title="Belum ada aturan aktif" /></div>
            } @else {
              <div class="cj-table-wrap rules">
                <table class="cj-table">
                  <thead><tr><th>Deskripsi</th><th>Tipe</th><th>Pemakaian</th><th>Addressed rate</th><th><span class="cdk-visually-hidden">Aksi</span></th></tr></thead>
                  <tbody>
                    @for (r of team(); track r.id) {
                      <tr [class.off]="r.status !== 'active'" [class.editing]="editing() === r.id">
                        <td class="desc" [attr.colspan]="editing() === r.id ? 5 : null">
                          @if (editing() === r.id) {
                            <cj-md-editor class="inline-edit" [(value)]="draft" label="Edit aturan" previewTitle="Preview" [rows]="4" testId="rule-edit" />
                            <div class="cj-row-actions edit-acts">
                              <button matButton="filled" [disabled]="busy() || draft().trim().length < 5" (click)="saveEdit(r.id, draft())">Simpan</button>
                              <button matButton (click)="editing.set(null)">Batal</button>
                            </div>
                          } @else {
                            <div class="rule-md" [innerHTML]="mdb(r.text)"></div>
                          }
                          <div class="cj-muted small">
                            <span class="material-symbols-rounded" aria-hidden="true">{{ r.repoId ? 'folder_code' : 'apartment' }}</span>
                            {{ r.repoId ? repoName(r.repoId) : 'Semua repo' }}{{ r.paths.length ? ' · ' + r.paths.join(', ') : '' }} · {{ rel(r.createdAtMs) }} · {{ r.source === 'manual' ? 'manual' : 'hasil belajar' }} · {{ r.status === 'active' ? 'Aktif' : 'Nonaktif' }}
                          </div>
                        </td>
                        @if (editing() !== r.id) {
                        <td><span class="type" [class.sup]="r.kind === 'suppression'" [attr.title]="r.kind === 'suppression' ? 'Suppress temuan' : 'Aturan'">
                          <span class="material-symbols-rounded" aria-hidden="true">{{ r.kind === 'suppression' ? 'visibility_off' : 'gavel' }}</span>
                          <span class="cdk-visually-hidden">{{ r.kind === 'suppression' ? 'Suppress temuan' : 'Aturan' }}</span></span></td>
                        <td>{{ usage(r) }}</td>
                        <td>{{ ruleRate(r) }}</td>
                        }
                        @if (editing() !== r.id) {
                        <td class="acts">
                          @if (auth.isAdmin() && editing() !== r.id) {
                            <div class="act-row">
                              <button matIconButton (click)="startEdit(r)" [attr.aria-label]="'Edit aturan'" matTooltip="Edit"><span class="material-symbols-rounded" aria-hidden="true">edit</span></button>
                              <mat-slide-toggle [checked]="r.status === 'active'" [disabled]="busy()" (change)="decideOne(r.id, $event.checked ? 'reactivate' : 'deactivate')"
                                [aria-label]="(r.status === 'active' ? 'Nonaktifkan' : 'Aktifkan') + ' aturan'" [matTooltip]="r.status === 'active' ? 'Aktif — klik untuk menonaktifkan' : 'Nonaktif — klik untuk mengaktifkan'"
                                [attr.data-testid]="'rule-toggle-' + r.id" />
                            </div>
                          } @else if (!auth.isAdmin()) {
                            <span class="cj-muted small">{{ r.status === 'active' ? 'Aktif' : 'Nonaktif' }}</span>
                          }
                        </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="cj-muted small">Addressed rate = persentase temuan yang diperbaiki pada review yang memakai aturan ini (untuk aturan "suppress temuan": berapa kali menekan).</p>
            }
          </div>
        </mat-tab>
        <mat-tab [label]="'Usulan (' + suggested().length + ')'">
          <div class="cj-card pane" data-testid="memory-suggested">
            @if (suggested().length) {
              <div class="bar">
                <mat-checkbox [checked]="allSel()" [indeterminate]="someSel()" (change)="toggleAll($event.checked)">Pilih semua</mat-checkbox>
                @if (auth.isAdmin()) {
                  <button matButton="filled" [disabled]="!sel().size || busy()" (click)="decide('approve')" data-testid="approve">Setujui ({{ sel().size }})</button>
                  <button matButton="tonal" [disabled]="!sel().size || busy()" (click)="decide('reject')" data-testid="reject">Tolak</button>
                } @else {
                  <span class="cj-muted">Hanya admin yang bisa menyetujui.</span>
                }
              </div>
            }
            @for (r of suggested(); track r.id) {
              <div class="rule">
                <mat-checkbox [checked]="sel().has(r.id)" (change)="toggle(r.id, $event.checked)" [aria-label]="'Pilih ' + r.text" />
                <div class="body">
                  <div class="cj-row-actions">
                    <cj-chip [tone]="r.kind === 'suppression' ? 'warning' : 'primary'">{{ r.kind === 'suppression' ? 'Suppress temuan' : 'Aturan' }}</cj-chip>
                    <cj-chip>{{ cat(r.category) }}</cj-chip>
                    <span class="cj-muted small">{{ rel(r.createdAtMs) }}</span>
                  </div>
                  <p [innerHTML]="mdi(r.text)"></p>
                  @if (r.matchTitle) {<p class="cj-muted small">Pola: "{{ r.matchTitle }}"</p>}
                  <p class="cj-muted small">Bukti: @for (e of r.evidence; track e) {<code>{{ e }}</code> }</p>
                </div>
              </div>
            } @empty {
              <cj-empty-state icon="inbox" title="Tidak ada usulan" text="Usulan muncul setelah PR ditutup dan job belajar selesai." />
            }
          </div>
        </mat-tab>
        <mat-tab label="Tambah aturan">
          <div class="pane">
            <p class="cj-muted">Aturan manual langsung aktif dan dipakai di review berikutnya.</p>
            <cj-md-editor [formField]="f.text" label="Teks aturan" previewTitle="Preview aturan" [rows]="6" testId="rule-text"
              placeholder="Tulis aturan tim (Markdown didukung), mis.: Endpoint di \`src/routes/\` **wajib** memvalidasi input dengan zod." />
            @if (f.text().touched() && f.text().errors().length) {<p class="err" role="alert">{{ f.text().errors()[0].message }}</p>}
            <div class="cj-row-actions">
              <cj-select label="Kategori" [options]="categoryOpts" [value]="model().category" (valueChange)="setCategory($event)" testId="rule-category" />
              <mat-form-field appearance="outline" class="grow">
                <mat-label>Path (opsional, pisahkan koma)</mat-label>
                <input matInput [formField]="f.paths" placeholder="src/api/, apps/web/" />
              </mat-form-field>
            </div>
            <button matButton="filled" (click)="create()" [disabled]="busy()" data-testid="rule-create">Tambah aturan</button>
          </div>
        </mat-tab>
        <mat-tab label="Suppressed">
          <div class="cj-card pane" data-testid="memory-suppressed">
            @for (s of suppressedItems(); track $index) {
              <div class="rule"><div class="body">
                <div class="cj-row-actions"><cj-chip>{{ s.severity }}</cj-chip><cj-chip>{{ cat(s.category) }}</cj-chip>
                  <a [routerLink]="['/reviews', s.jobId]">{{ s.repo }} #{{ s.pr }}</a><span class="cj-muted small">{{ dt(s.atMs) }}</span></div>
                <p><span [innerHTML]="mdi(s.title)"></span> <span class="cj-muted">&nbsp;— <code>{{ s.path }}:{{ s.line }}</code></span></p>
              </div></div>
            } @empty {
              <cj-empty-state icon="visibility_off" title="Belum ada temuan yang di-suppress" />
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </cj-page>
  `,
  styles: `
    .pane { margin-top: 16px; }
    .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    .rule { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--mat-sys-outline-variant); align-items: flex-start; }
    .body { flex: 1; min-width: 0; }
    .body p { margin: 6px 0 0; }
    .acts { display: flex; gap: 4px; flex-wrap: wrap; }
    .small { font: var(--mat-sys-body-small); }
    .full { width: 100%; }
    .rule-md ::ng-deep p { margin: 0; }
    .rule-md ::ng-deep ul, .rule-md ::ng-deep ol { margin: 4px 0; padding-left: 20px; }
    .err { color: var(--mat-sys-error); margin: 8px 4px 0; }
    cj-md-editor { margin: 8px 0 16px; }
    .rules td.desc { max-width: 720px; }
    .rules .small { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
    .rules .small .material-symbols-rounded { font-size: 16px; }
    .type { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .type.sup { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .type .material-symbols-rounded { font-size: 18px; }
    .acts { white-space: nowrap; text-align: right; }
    .act-row { display: flex; gap: 4px; justify-content: flex-end; }
    .rules td.acts { width: 120px; }
    .act-row { align-items: center; gap: 12px; }
    tr.off:not(.editing) .rule-md, tr.off:not(.editing) td:not(.acts) { opacity: .55; }
    tr.editing td { vertical-align: top; padding-top: 16px; }
    .rules tbody tr.editing:hover td { background: transparent; }
    .inline-edit { margin: 4px 0 12px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 24px; display: block; }
    .edit-acts { margin-bottom: 8px; }
    .grow { flex: 1; min-width: 220px; }
  `,
})
export class MemoryPage {
  protected readonly mdi = miniInline;
  protected readonly mdb = miniMarkdown;
  private readonly fb = inject(FirebaseService);
  protected readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  protected readonly categories = CATEGORIES;
  protected readonly categoryOpts = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }));
  setCategory(category: (typeof CATEGORIES)[number]) {
    this.model.update((m) => ({ ...m, category }));
  }
  protected readonly sel = signal(new Set<string>());
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  private readonly rules = liveQuery<RuleRow>(() => query(collection(this.fb.db, 'rules'), orderBy('createdAt', 'desc'), limit(500)), (id, d) => ({
    id,
    text: d['text'],
    kind: d['kind'] ?? 'rule',
    category: d['category'] ?? 'bug',
    status: d['status'],
    source: d['source'] ?? 'manual',
    repoId: d['scope']?.repoId ?? null,
    paths: d['scope']?.paths ?? [],
    evidence: d['evidence'] ?? [],
    usageCount: d['usageCount'] ?? 0,
    lastUsedAtMs: toMs(d['lastUsedAt']),
    createdAtMs: toMs(d['createdAt']),
    matchTitle: d['matchTitle'] ?? null,
  }));
  private readonly jobs = liveQuery(
    () => query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), orderBy('createdAt', 'desc'), limit(500)),
    (id, d) => ({ id, d }),
  );
  private readonly findings = liveQuery(() => query(collection(this.fb.db, 'findings'), orderBy('createdAt', 'desc'), limit(3000)), (_id, d) => ({
    jobId: d['jobId'] as string,
    outcome: (d['outcome'] ?? 'pending') as string,
  }));
  private readonly repoNames = liveQuery(() => collection(this.fb.db, 'repos'), (id, d) => ({ id, name: d['fullName'] as string }));
  protected repoName = (id: string) => this.repoNames().data.find((r) => r.id === String(id))?.name ?? `repo ${id}`;
  /** pemakaian: aturan → usageCount; suppression → berapa temuan yang ditekan */
  protected usage(r: RuleRow): number {
    if (r.kind !== 'suppression') return r.usageCount;
    return this.jobs().data.reduce((a, { d }) => a + ((d['result']?.suppressed ?? []) as { ruleId?: string }[]).filter((s) => s.ruleId === r.id).length, 0) || r.usageCount;
  }
  protected ruleRate(r: RuleRow): string {
    if (r.kind === 'suppression') return '—';
    const jobIds = new Set(this.jobs().data.filter(({ d }) => ((d['result']?.appliedRuleIds ?? []) as string[]).includes(r.id)).map(({ id }) => id));
    const fs = this.findings().data.filter((f) => jobIds.has(f.jobId) && f.outcome !== 'pending');
    return fs.length ? `${Math.round((fs.filter((f) => f.outcome === 'addressed').length / fs.length) * 100)}%` : '—';
  }
  protected readonly suggested = computed(() => this.rules().data.filter((r) => r.status === 'suggested'));
  protected readonly active = computed(() => this.rules().data.filter((r) => r.status === 'active'));
  /** aturan tim = aktif + nonaktif (yang nonaktif tetap terlihat, bisa diaktifkan lagi lewat switch) */
  protected readonly team = computed(() => this.rules().data.filter((r) => r.status === 'active' || r.status === 'inactive'));
  protected readonly draft = signal('');
  protected readonly suppressedItems = computed(() =>
    this.jobs().data.flatMap(({ id, d }) =>
      ((d['result']?.suppressed ?? []) as { title: string; path: string; line: number; severity: string; category: string }[]).map((s) => ({
        ...s,
        jobId: id,
        repo: d['repo']?.fullName,
        pr: d['pr']?.number,
        atMs: toMs(d['createdAt']),
      })),
    ),
  );
  protected readonly allSel = computed(() => this.suggested().length > 0 && this.suggested().every((r) => this.sel().has(r.id)));
  protected readonly someSel = computed(() => this.sel().size > 0 && !this.allSel());
  protected readonly model = signal({ text: '', category: 'bug' as (typeof CATEGORIES)[number], paths: '' });
  protected readonly f = form(this.model, (p) => validateStandardSchema(p, RuleForm));

  protected cat = (c: string) => CATEGORY_LABEL[c] ?? c;
  protected rel = (ms: number | null) => fmtRelative(ms);
  protected dt = (ms: number | null) => fmtDateTime(ms);

  toggle(id: string, on: boolean) {
    const s = new Set(this.sel());
    if (on) s.add(id);
    else s.delete(id);
    this.sel.set(s);
  }
  toggleAll(on: boolean) {
    this.sel.set(on ? new Set(this.suggested().map((r) => r.id)) : new Set());
  }
  private async call(ids: string[], action: string, text?: string) {
    this.busy.set(true);
    try {
      const r = await this.fb.call<unknown, { updated: number }>('decideRules')({ ids, action, text });
      const label: Record<string, string> = { approve: 'disetujui', reject: 'ditolak', deactivate: 'dinonaktifkan', reactivate: 'diaktifkan lagi', edit: 'diperbarui' };
      this.snack.open(`${r.updated} aturan ${label[action] ?? action}.`, 'Tutup', { duration: 4000 });
      this.sel.set(new Set());
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
  decide(action: 'approve' | 'reject') {
    return this.call([...this.sel()], action);
  }
  decideOne(id: string, action: string) {
    return this.call([id], action);
  }
  startEdit(r: RuleRow) {
    this.draft.set(r.text);
    this.editing.set(r.id);
  }
  async saveEdit(id: string, text: string) {
    await this.call([id], 'edit', text);
    this.editing.set(null);
  }
  async create() {
    this.f.text().markAsTouched();
    if (this.f().invalid()) return;
    this.busy.set(true);
    try {
      const m = this.model();
      await this.fb.call<unknown, { id: string }>('createManualRule')({
        text: m.text,
        category: m.category,
        repoId: null,
        paths: m.paths.split(',').map((p) => p.trim()).filter(Boolean),
      });
      this.snack.open('Aturan ditambahkan dan langsung aktif.', 'Tutup', { duration: 4000 });
      this.model.set({ text: '', category: 'bug', paths: '' });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
}
