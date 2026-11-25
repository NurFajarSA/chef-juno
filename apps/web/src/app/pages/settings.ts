import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DEFAULT_ROLE_TIERS, DEFAULT_TIER_EFFORT, DEFAULT_TIER_MODELS, type AgentRole, type ModelTier } from '@chefjuno/shared';
import { Router, RouterLink } from '@angular/router';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { ThemeService } from '../core/theme.service';
import { collection, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { z } from 'zod';
import { CjPage } from '../ui/page';
import { CjSelect } from '../ui/select';
import { CjChip } from '../ui/chip';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveDoc, liveQuery } from '../core/live';

interface MemberRow {
  id: string;
  githubLogin: string;
  name: string;
  role: 'admin' | 'member';
}

const AddMember = z.object({
  githubLogin: z.string().trim().min(1, 'Login GitHub wajib diisi').max(39),
  role: z.enum(['admin', 'member']),
});

const Settings = z.object({
  maxInlineComments: z.number().int().min(0, 'Minimal 0').max(30, 'Maksimal 30'),
  preferredAgent: z.enum(['any', 'claude', 'codex']),
  minConfidence: z.number().min(0).max(1),
  maxPostPriority: z.enum(['P0', 'P1', 'P2']),
  agentMaxTurns: z.number().int().min(1).max(200),
  reviewTimeoutMinutes: z.number().min(1).max(120),
  maxDiffBytes: z.number().int().min(10_000).max(10_000_000),
});


@Component({
  selector: 'cj-settings',
  imports: [CjSelect, CjPage, CjChip, RouterLink, MatSlideToggle, MatButton, MatIconButton, MatFormFieldModule, MatInput, MatTableModule, MatTooltip, FormField],
  template: `
    <cj-page heading="Pengaturan">
      <h2 class="cj-h2" id="akun">Akun</h2>
      <p>Profil dan tampilan untuk kamu.</p>
      <div class="cj-rows" data-testid="account">
        <div class="row"><div><div class="t">&#64;{{ auth.membership()?.githubLogin ?? '—' }}</div><div class="d">Akun GitHub (ID {{ auth.membership()?.githubUserId ?? '—' }}) · {{ auth.isAdmin() ? 'Admin' : 'Anggota' }}</div></div>
          <button matButton="tonal" (click)="logout()"><span class="material-symbols-rounded" aria-hidden="true">logout</span> Keluar</button></div>
        <div class="row"><div><div class="t">Tema</div><div class="d">Ikuti sistem, atau paksa terang / gelap.</div></div>
          <div class="cj-seg" role="group" aria-label="Tema">
            <button type="button" [class.on]="theme.mode() === 'system'" (click)="theme.set('system')"><span class="material-symbols-rounded" aria-hidden="true">contrast</span> Sistem</button>
            <button type="button" [class.on]="theme.mode() === 'light'" (click)="theme.set('light')"><span class="material-symbols-rounded" aria-hidden="true">light_mode</span> Terang</button>
            <button type="button" [class.on]="theme.mode() === 'dark'" (click)="theme.set('dark')"><span class="material-symbols-rounded" aria-hidden="true">dark_mode</span> Gelap</button>
          </div></div>
        <div class="row"><div><div class="t">Memori untuk agent pribadimu</div><div class="d">Aturan tim + kesalahan yang sering kamu ulangi, untuk CLAUDE.md / AGENTS.md atau server MCP.</div></div>
          <a class="chev" [routerLink]="['/rapor', auth.membership()?.githubLogin]" aria-label="Buka rapor kamu"><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></a></div>
      </div>

      <h2 class="cj-h2" id="review">Review</h2>
      <p>Cara Chef Juno mereview PR (berlaku untuk job berikutnya).</p>
      <div class="cj-rows" data-testid="global-settings">
        <div class="row"><div><div class="t">Maks komentar inline</div><div class="d">0–30, diurutkan dari yang paling parah. Sisanya masuk ringkasan.</div></div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num">
            <input matInput type="number" [formField]="sf.maxInlineComments" aria-label="Maks komentar inline" data-testid="max-inline" />
          </mat-form-field></div>
        <div class="row"><div><div class="t">Ambang keyakinan</div><div class="d">Temuan dengan keyakinan reviewer di bawah ini tidak diposting ke PR, tapi tetap tersimpan di dashboard (bagian "Ditahan").</div></div>
          <cj-select label="Ambang keyakinan" [options]="confOpts" [value]="sModel().minConfidence" (valueChange)="setS('minConfidence', $event)" testId="min-confidence" /></div>
        <div class="row"><div><div class="t">Agent pilihan</div><div class="d">"Bebas" = bergantian antar agent yang tersedia di mesin, supaya beban langganan tersebar.</div></div>
          <div class="cj-seg" role="group" aria-label="Agent pilihan">
            <button type="button" [class.on]="sModel().preferredAgent === 'any'" (click)="setAgent('any')">Bebas</button>
            <button type="button" [class.on]="sModel().preferredAgent === 'claude'" (click)="setAgent('claude')">Claude Code</button>
            <button type="button" [class.on]="sModel().preferredAgent === 'codex'" (click)="setAgent('codex')">Codex</button>
          </div></div>
        <div class="row"><div><div class="t">Verifikasi statis (container)</div><div class="d">Jalankan analisis statis dari <code>.chefjuno/verify.json</code> (branch tujuan) di base &amp; head, lalu beri reviewer daftar masalah yang <b>baru</b> di PR. Butuh Docker/Podman di mesin; tanpa jaringan saat analisis, tanpa secret. Mesin tanpa container melewati tahap ini.</div></div>
          <mat-slide-toggle [checked]="mc().verifyEnabled" (change)="setMc('verifyEnabled', $event.checked)" data-testid="verify-enabled">Aktif</mat-slide-toggle></div>
        <div class="row"><div><div class="t">Uji aplikasi (empiris)</div><div class="d">Setelah review diposting, agent penguji di mesin menjalankan app PR terhadap emulator lokal (bukan produksi), mencoba alur yang diubah dan temuan review, lalu menyimpan screenshot sebagai bukti (tampil di komentar 🧪 PR & dashboard). Status merge menunggu hasilnya; tanpa bukti = "Belum teruji". Mati = gate hanya dari temuan kode. Profil uji di mesin: <code>~/.chefjuno/app-local.json</code>. Lihat Panduan → Uji aplikasi.</div></div>
          <mat-slide-toggle [checked]="mc().appVerifyEnabled" (change)="setMc('appVerifyEnabled', $event.checked)" data-testid="app-verify-enabled">Aktif</mat-slide-toggle></div>
      </div>

      <h2 class="cj-h2" id="model">Model &amp; biaya</h2>
      <p>Sonnet untuk review &amp; uji aplikasi, Opus untuk validasi temuan &amp; reviewer akhir. Semua temuan (P0–P2) selalu diposting ke PR. Berlaku untuk job berikutnya.</p>
      <div class="cj-rows" data-testid="model-settings">
        <div class="row"><div><div class="t">Standar review</div><div class="d"><b>Satu standar, standar tinggi.</b> Setiap PR direview penuh (putaran spesialis, validasi, reviewer akhir) lalu <b>dicoba langsung di aplikasi</b>; PR yang belum teruji tidak pernah lulus. Hanya perubahan dokumentasi yang direview ringan tanpa uji aplikasi.</div></div></div>
        <div class="row"><div><div class="t">Nama model per tingkat</div><div class="d">Diteruskan ke <code>--model</code> CLI (langganan, tanpa API key). Claude Code: alias <code>sonnet</code>, <code>opus</code>. Codex: <code>gpt-6.2-sol</code> (harian), <code>gpt-6.2-astra</code> (paling mampu). Effort: Claude Code <code>--effort</code> (low/medium/high/xhigh/max), Codex <code>model_reasoning_effort</code>. Kosong = default.</div></div>
          <div class="tiers">
            @for (a of agents; track a.key) {
              <div class="tier-row"><span class="ag">{{ a.label }}</span>
                @for (t of tiers; track t.key) {
                  <input class="tier-in" [value]="mc().tierModels[a.key][t.key]" (input)="setTierModel(a.key, t.key, $any($event.target).value)" [placeholder]="t.label + ' (default)'" [attr.aria-label]="a.label + ' ' + t.label" [attr.data-testid]="'tier-' + a.key + '-' + t.key" />
                }
              </div>
            }
            @for (a of effortAgents; track a.key) {
              <div class="tier-row"><span class="ag">Effort {{ a.label }}</span>
                @for (t of tiers; track t.key) {
                  <input class="tier-in" [value]="mc().tierEffort[a.key][t.key]" (input)="setTierEffort(a.key, t.key, $any($event.target).value)" [placeholder]="t.label + ' (default)'" [attr.aria-label]="'Effort ' + a.label + ' ' + t.label" [attr.data-testid]="'effort-' + a.key + '-' + t.key" />
                }
              </div>
            }
          </div></div>
        <div class="row col"><div><div class="t">Harga per 1 juta token (opsional)</div><div class="d">Hanya untuk <b>estimasi setara API</b> di Analitik → Biaya &amp; waktu. Chef Juno memakai langganan, jadi ini bukan tagihan. Isi dalam USD; kosong = tidak dihitung. Nama model boleh alias (<code>sonnet</code>) — dicocokkan dengan ID model yang dilaporkan CLI.</div></div>
          <div class="prices" data-testid="model-prices">
            <div class="price-row head"><span>Model</span><span>Masuk</span><span>Keluar</span></div>
            @for (m of priceModels(); track m) {
              <div class="price-row">
                <code>{{ m }}</code>
                <input class="tier-in" type="number" min="0" step="0.01" [value]="mc().modelPrices[m]?.in ?? ''" (input)="setPrice(m, 'in', $any($event.target).value)" placeholder="—" [attr.aria-label]="'Harga token masuk ' + m" [attr.data-testid]="'price-in-' + m" />
                <input class="tier-in" type="number" min="0" step="0.01" [value]="mc().modelPrices[m]?.out ?? ''" (input)="setPrice(m, 'out', $any($event.target).value)" placeholder="—" [attr.aria-label]="'Harga token keluar ' + m" [attr.data-testid]="'price-out-' + m" />
              </div>
            }
          </div></div>
        <div class="row"><div><div class="t">Batas waktu review</div><div class="d">Agent dihentikan dan job ditandai gagal kalau melewati batas ini.</div></div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num"><input matInput type="number" [formField]="sf.reviewTimeoutMinutes" aria-label="Batas waktu review (menit)" /><span matTextSuffix>menit</span></mat-form-field></div>
        <div class="row"><div><div class="t">Batas diff</div><div class="d">Diff yang lebih besar dipotong dan diberi catatan di prompt.</div></div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="num wide"><input matInput type="number" [formField]="sf.maxDiffBytes" aria-label="Batas diff (byte)" /><span matTextSuffix>byte</span></mat-form-field></div>
        <div class="row end">
          @if (auth.isAdmin()) {
            <button matButton="filled" (click)="saveSettings()" [disabled]="busy()" data-testid="settings-save">Simpan setting</button>
          } @else {
            <span class="cj-muted">Hanya admin yang bisa mengubah setting.</span>
          }
        </div>
      </div>

      <h2 class="cj-h2" id="anggota">Anggota</h2>
      <p>Hanya anggota yang bisa membuka dashboard dan memanggil Chef Juno. Admin bisa mengubah setting dan menyetujui aturan.</p>
      <div class="cj-rows" data-testid="members">
        @for (m of members().data; track m.id) {
          <div class="row">
            <div><div class="t">&#64;{{ m.githubLogin }}</div><div class="d">{{ m.name }} · ID {{ m.id }}</div></div>
            <div class="cj-row-actions">
              @if (auth.isAdmin()) {
                <cj-select [label]="'Peran @' + m.githubLogin" [options]="roleOpts" [value]="m.role" (valueChange)="update(m, { role: $event })" [testId]="'role-' + m.githubLogin" />
                @if (m.id !== auth.membership()?.githubUserId) {
                  <button matIconButton (click)="remove(m)" [attr.aria-label]="'Hapus ' + m.githubLogin" matTooltip="Hapus anggota"><span class="material-symbols-rounded" aria-hidden="true">person_remove</span></button>
                }
              } @else {
                <cj-chip [tone]="m.role === 'admin' ? 'primary' : 'neutral'">{{ m.role === 'admin' ? 'Admin' : 'Anggota' }}</cj-chip>
              }
            </div>
          </div>
        }
        @if (auth.isAdmin()) {
          <div class="row add">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
              <mat-label>Login GitHub anggota baru</mat-label>
              <input matInput [formField]="addForm.githubLogin" data-testid="member-login" />
              @if (addForm.githubLogin().touched() && addForm.githubLogin().errors().length) {<mat-error>{{ addForm.githubLogin().errors()[0].message }}</mat-error>}
            </mat-form-field>
            <cj-select label="Peran anggota baru" [options]="roleOpts" [value]="addModel().role" (valueChange)="setAddRole($event)" testId="member-role" />
            <button matButton="filled" (click)="add()" [disabled]="busy()" data-testid="member-add"><span class="material-symbols-rounded" aria-hidden="true">person_add</span> Tambah</button>
          </div>
        }
      </div>

      <h2 class="cj-h2" id="lainnya">Lainnya</h2>
      <p>Pengaturan yang punya halaman sendiri.</p>
      <div class="cj-rows">
        <a class="row nav" routerLink="/prompts"><div><div class="t">Prompt reviewer</div><div class="d">Persona & instruksi review dengan riwayat versi.</div></div><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></a>
        <a class="row nav" routerLink="/repos"><div><div class="t">Repositori</div><div class="d">Repo yang terpasang GitHub App, status review & code map.</div></div><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></a>
        <a class="row nav" routerLink="/machines"><div><div class="t">Mesin reviewer</div><div class="d">Daftarkan, pantau, dan cabut mesin yang menjalankan Claude Code / Codex.</div></div><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></a>
        <a class="row nav" routerLink="/memory"><div><div class="t">Memory tim</div><div class="d">Aturan tim, usulan dari hasil belajar, dan pola yang di-suppress.</div></div><span class="material-symbols-rounded" aria-hidden="true">chevron_right</span></a>
      </div>
      @if (dirty()) {
        <!-- setting baru berlaku setelah disimpan; bar ini terlihat dari bagian mana pun halaman -->
        <div class="unsaved" role="status" data-testid="unsaved-bar">
          <span>Ada perubahan setting yang belum disimpan.</span>
          <button matButton="filled" (click)="saveSettings()" [disabled]="busy()" data-testid="unsaved-save">Simpan setting</button>
        </div>
      }
    </cj-page>
  `,
  styles: `
    .unsaved { position: sticky; bottom: 12px; z-index: 5; margin-top: 16px; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 12px 10px 16px; border-radius: 14px; background: var(--mat-sys-inverse-surface); color: var(--mat-sys-inverse-on-surface); box-shadow: var(--mat-sys-level3); font: var(--mat-sys-body-medium); }
    .row.col { flex-direction: column; align-items: stretch; }
    .prices { display: grid; gap: 6px; max-width: 520px; }
    .price-row { display: grid; grid-template-columns: minmax(140px, 1fr) 110px 110px; gap: 8px; align-items: center; }
    .price-row.head span { font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); }
    .price-row code { font-family: 'Google Sans Code', ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
    .tiers { display: flex; flex-direction: column; gap: 8px; }
    .tier-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .ag { width: 96px; font: var(--mat-sys-label-large); }
    .tier-in { width: 120px; height: 36px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 10px; padding: 0 10px; background: var(--mat-sys-surface); color: inherit; font: var(--mat-sys-body-medium); }
    .row.role { padding-top: 10px; padding-bottom: 10px; }
    .num { width: 140px; }
    .num.wide { width: 200px; }
    .pair { display: flex; gap: 12px; flex-wrap: wrap; }
    .pair mat-form-field { width: 200px; }
    .row.end { justify-content: flex-end; }
    .row.add { justify-content: flex-start; align-items: flex-start; }
    .grow { flex: 1; min-width: 220px; }
    .inline { width: 120px; }
    a.row.nav { text-decoration: none; color: inherit; }
    a.row.nav:hover { background: var(--mat-sys-surface-container-low); }
    .chev { color: inherit; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 999px; }
    .chev:hover { background: var(--mat-sys-surface-container-high); }
  `,})
export class SettingsPage {
  private readonly fb = inject(FirebaseService);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  readonly section = input<string>('');
  protected readonly confOpts = [0.5, 0.6, 0.7, 0.8, 0.9].map((v) => ({ value: v, label: `${Math.round(v * 100)}%${v === 0.7 ? ' (default)' : ''}` }));
  setS<K extends 'minConfidence' | 'maxPostPriority'>(k: K, v: (typeof this.sModel extends () => infer M ? M : never)[K]) {
    this.sModel.update((m) => ({ ...m, [k]: v }));
  }
  setAgent(a: 'any' | 'claude' | 'codex') {
    this.sModel.update((m) => ({ ...m, preferredAgent: a }));
  }
  ngAfterViewInit() {
    // /settings/:section → gulir ke bagian itu
    const sec = this.section();
    if (sec) setTimeout(() => document.getElementById(sec)?.scrollIntoView({ block: 'start' }), 300);
  }
  async logout() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
  private readonly snack = inject(MatSnackBar);
  protected readonly cols = ['login', 'role', 'actions'];
  protected readonly roleOpts: { value: 'admin' | 'member'; label: string }[] = [{ value: 'member', label: 'Anggota' }, { value: 'admin', label: 'Admin' }];
  setAddRole(role: 'admin' | 'member') {
    this.addModel.update((m) => ({ ...m, role }));
  }
  protected readonly busy = signal(false);
  protected readonly members = liveQuery<MemberRow>(() => query(collection(this.fb.db, 'members'), orderBy('githubLogin')), (id, d) => ({
    id,
    githubLogin: d['githubLogin'],
    name: d['name'] ?? '',
    role: d['role'],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dokumen settings dibaca apa adanya
  private readonly settings = liveDoc<Record<string, any>>(() => doc(this.fb.db, 'settings/global'), (_id, d) => d);
  protected readonly addModel = signal({ githubLogin: '', role: 'member' as 'admin' | 'member' });
  protected readonly addForm = form(this.addModel, (p) => validateStandardSchema(p, AddMember));
  protected readonly sModel = signal({ maxInlineComments: 10, preferredAgent: 'any' as 'any' | 'claude' | 'codex', minConfidence: 0.7, maxPostPriority: 'P2' as 'P0' | 'P1' | 'P2', agentMaxTurns: 40, reviewTimeoutMinutes: 15, maxDiffBytes: 1_000_000 });
  protected readonly sf = form(this.sModel, (p) => validateStandardSchema(p, Settings));
  private loaded = false;
  /** isi setting terakhir yang tersimpan (pembanding untuk bar "belum disimpan") */
  private readonly savedSnap = signal<string | null>(null);
  private readonly snapshot = computed(() => JSON.stringify({ s: this.sModel(), mc: this.mc() }));
  protected readonly dirty = computed(() => this.savedSnap() !== null && this.snapshot() !== this.savedSnap());

  constructor() {
    effect(() => {
      const s = this.settings().data;
      if (!s || this.loaded) return;
      this.loaded = true;
      this.sModel.set({
        maxInlineComments: s['maxInlineComments'] ?? 10,
        preferredAgent: s['preferredAgent'] ?? 'any',
        minConfidence: typeof s['minConfidence'] === 'number' ? s['minConfidence'] : 0.7,
        maxPostPriority: (['P0', 'P1', 'P2'].includes(s['maxPostPriority']) ? s['maxPostPriority'] : 'P2') as 'P0' | 'P1' | 'P2',
        agentMaxTurns: s['agentMaxTurns'] ?? 40,
        reviewTimeoutMinutes: s['reviewTimeoutMinutes'] ?? 15,
        maxDiffBytes: s['maxDiffBytes'] ?? 1_000_000,
      });
      const tm = (s['tierModels'] ?? {}) as Partial<Record<'claude' | 'codex', Partial<Record<ModelTier, string>>>>;
      this.mc.set({
        reviewMode: (['auto', 'standard', 'deep'].includes(s['reviewMode']) ? s['reviewMode'] : 'auto') as 'auto' | 'standard' | 'deep',
        verifyEnabled: s['verifyEnabled'] === true,
        appVerifyEnabled: s['appVerifyEnabled'] === true,
        roleTiers: { ...DEFAULT_ROLE_TIERS, ...((s['roleTiers'] ?? {}) as Partial<Record<AgentRole, ModelTier>>) },
        tierModels: {
          claude: { ...DEFAULT_TIER_MODELS.claude, ...(tm.claude ?? {}) },
          codex: { ...DEFAULT_TIER_MODELS.codex, ...(tm.codex ?? {}) },
        },
        tierEffort: {
          claude: { ...DEFAULT_TIER_EFFORT.claude, ...(((s['tierEffort'] ?? {}) as { claude?: Partial<Record<ModelTier, string>> }).claude ?? {}) },
          codex: { ...DEFAULT_TIER_EFFORT.codex, ...(((s['tierEffort'] ?? {}) as { codex?: Partial<Record<ModelTier, string>> }).codex ?? {}) },
        },
        modelPrices: { ...((s['modelPrices'] ?? {}) as Record<string, { in: number; out: number }>) },
      });
      untracked(() => this.savedSnap.set(this.snapshot()));
    });
  }

  // ---------- Model & biaya ----------
  protected readonly mc = signal({
    reviewMode: 'auto' as 'auto' | 'standard' | 'deep',
    verifyEnabled: false,
    appVerifyEnabled: false,
    roleTiers: { ...DEFAULT_ROLE_TIERS } as Record<AgentRole, ModelTier>,
    tierModels: { claude: { ...DEFAULT_TIER_MODELS.claude }, codex: { ...DEFAULT_TIER_MODELS.codex } },
    tierEffort: { claude: { ...DEFAULT_TIER_EFFORT.claude }, codex: { ...DEFAULT_TIER_EFFORT.codex } },
    modelPrices: {} as Record<string, { in: number; out: number }>,
  });
  /** model yang bisa diberi harga: nama model per tingkat (Claude & Codex) + yang sudah pernah diberi harga */
  protected readonly priceModels = computed(() => {
    const m = this.mc();
    const names = [...Object.values(m.tierModels.claude), ...Object.values(m.tierModels.codex), ...Object.keys(m.modelPrices)];
    return [...new Set(names.map((x) => x.trim()).filter(Boolean))];
  });
  setPrice(model: string, side: 'in' | 'out', v: string) {
    const n = Number(v);
    this.mc.update((m) => {
      const cur = { in: m.modelPrices[model]?.in ?? 0, out: m.modelPrices[model]?.out ?? 0, [side]: v === '' || !Number.isFinite(n) || n < 0 ? 0 : n };
      const next = { ...m.modelPrices, [model]: cur };
      if (!cur.in && !cur.out) delete next[model];
      return { ...m, modelPrices: next };
    });
  }
  protected readonly effortAgents: { key: 'claude' | 'codex'; label: string }[] = [
    { key: 'claude', label: 'Claude' },
    { key: 'codex', label: 'Codex' },
  ];
  setTierEffort(agent: 'claude' | 'codex', t: ModelTier, v: string) {
    this.mc.update((m) => ({ ...m, tierEffort: { ...m.tierEffort, [agent]: { ...m.tierEffort[agent], [t]: v.trim().toLowerCase() } } }));
  }
  protected readonly tiers: { key: ModelTier; label: string }[] = [
    { key: 'fast', label: 'Cepat' },
    { key: 'standard', label: 'Standar' },
    { key: 'strong', label: 'Kuat' },
  ];
  protected readonly agents: { key: 'claude' | 'codex'; label: string }[] = [
    { key: 'claude', label: 'Claude Code' },
    { key: 'codex', label: 'Codex' },
  ];
  setMc<K extends 'reviewMode' | 'verifyEnabled' | 'appVerifyEnabled'>(k: K, v: ReturnType<typeof this.mc>[K]) {
    this.mc.update((m) => ({ ...m, [k]: v }));
  }
  setTierModel(a: 'claude' | 'codex', t: ModelTier, v: string) {
    this.mc.update((m) => ({ ...m, tierModels: { ...m.tierModels, [a]: { ...m.tierModels[a], [t]: v.trim() } } }));
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try {
      await fn();
      this.snack.open(ok, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
  update(m: MemberRow, patch: Partial<Pick<MemberRow, 'role'>>) {
    return this.run(
      () => this.fb.call('upsertMember')({ githubLogin: m.githubLogin, githubUserId: m.id, name: m.name || undefined, role: patch.role ?? m.role }),
      `@${m.githubLogin} diperbarui.`,
    );
  }
  add() {
    this.addForm.githubLogin().markAsTouched();
    if (this.addForm().invalid()) return;
    const v = this.addModel();
    return this.run(async () => {
      await this.fb.call('upsertMember')(v);
      this.addModel.set({ githubLogin: '', role: 'member' });
    }, `@${v.githubLogin} ditambahkan.`);
  }
  remove(m: MemberRow) {
    return this.run(() => this.fb.call('removeMember')({ githubUserId: m.id }), `@${m.githubLogin} dihapus.`);
  }
  saveSettings() {
    if (this.sf().invalid()) return;
    const s = this.sModel();
    const snap = this.snapshot();
    return this.run(
      () =>
        this.writeSettings(s).then(() => this.savedSnap.set(snap)),
      'Setting disimpan.',
    );
  }
  private writeSettings(s: ReturnType<typeof this.sModel>) {
    return updateDoc(doc(this.fb.db, 'settings/global'), {
          maxInlineComments: s.maxInlineComments,
          preferredAgent: s.preferredAgent,
          // model per peran menggantikan override lama "satu model untuk semua"
          models: {},
          reviewMode: this.mc().reviewMode,
          verifyEnabled: this.mc().verifyEnabled,
          appVerifyEnabled: this.mc().appVerifyEnabled,
          roleTiers: this.mc().roleTiers,
          tierModels: this.mc().tierModels,
          tierEffort: this.mc().tierEffort,
          modelPrices: this.mc().modelPrices,
          agentMaxTurns: s.agentMaxTurns,
          minConfidence: s.minConfidence,
          maxPostPriority: s.maxPostPriority,
          reviewTimeoutMinutes: s.reviewTimeoutMinutes,
          maxDiffBytes: s.maxDiffBytes,
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.membership()?.githubLogin ?? null,
        });
  }
}
