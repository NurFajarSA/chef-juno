import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { machineStatus } from '@chefjuno/shared';
import { AuthService } from '../core/auth.service';
import { FirebaseService } from '../core/firebase';
import { liveQuery } from '../core/live';
import { nowSignal } from '../core/now';
import { toMs } from '../core/format';
import { machineLoginCommand, MACHINE_START_COMMAND } from '../core/machine-cmd';
import { CjLogo } from '../ui/logo';

type StepKey = 'welcome' | 'github' | 'machine' | 'team' | 'first';
interface Step {
  key: StepKey;
  title: string;
  hint: string;
  optional?: boolean;
}

const STEPS: Step[] = [
  { key: 'welcome', title: 'Selamat datang', hint: 'Siapkan workspace tim' },
  { key: 'github', title: 'Pasang GitHub App', hint: 'Pilih repo yang direview' },
  { key: 'machine', title: 'Tambah mesin reviewer', hint: 'Claude Code / Codex milik tim' },
  { key: 'team', title: 'Ajak tim', hint: 'Anggota yang boleh memanggil', optional: true },
  { key: 'first', title: 'Review pertama', hint: 'Panggil Chef Juno di PR' },
];

/**
 * Onboarding admin pertama (instalasi baru), gaya Google Foresight: langkah di kiri, isi langkah di kanan.
 * Status tiap langkah dibaca live dari Firestore (repo terpasang, mesin online, anggota, review pertama).
 */
@Component({
  selector: 'cj-onboarding',
  imports: [CjLogo, MatButton, MatFormFieldModule, MatInput, MatProgressSpinner],
  template: `
    <header class="top">
      <span class="brand"><cj-logo [size]="36" /><span class="name"><b>Chef Juno</b><span class="sub"> Setup</span></span></span>
      <span class="spacer"></span>
      <button matButton (click)="finish()" [disabled]="busy()" data-testid="setup-skip">Lewati untuk sekarang</button>
    </header>

    <div class="wrap">
      <nav class="steps" aria-label="Langkah setup">
        <p class="progress">{{ doneCount() }} dari {{ steps.length }} selesai</p>
        <div class="bar" aria-hidden="true"><i [style.width.%]="(doneCount() / steps.length) * 100"></i></div>
        @for (s of steps; track s.key; let i = $index) {
          <button type="button" class="step" [class.on]="current() === i" [class.done]="done()[s.key]" (click)="current.set(i)"
                  [attr.aria-current]="current() === i ? 'step' : null" [attr.data-testid]="'step-' + s.key">
            <span class="dot" aria-hidden="true">
              @if (done()[s.key]) {<span class="material-symbols-rounded">check</span>} @else {{{ i + 1 }}}
            </span>
            <span class="txt"><b>{{ s.title }}</b><span>{{ s.optional ? 'Opsional · ' : '' }}{{ s.hint }}</span></span>
            <span class="cj-visually-hidden">{{ done()[s.key] ? '(selesai)' : '' }}</span>
          </button>
        }
      </nav>

      <main class="panel" data-testid="setup-panel">
        @switch (steps[current()].key) {
          @case ('welcome') {
            <h1>Halo, &#64;{{ login() }} 👋</h1>
            <p class="lead">Kamu admin pertama Chef Juno — reviewer kode tim yang jujur, tegas, dan berstandar tinggi. Kita siapkan dalam beberapa langkah.</p>
            <ul class="what">
              <li><span class="material-symbols-rounded" aria-hidden="true">integration_instructions</span><div><b>Hubungkan repo GitHub</b><span>Chef Juno membaca PR dan membalas langsung di sana.</span></div></li>
              <li><span class="material-symbols-rounded" aria-hidden="true">dns</span><div><b>Tambah mesin reviewer</b><span>Review dijalankan Claude Code atau Codex di mesin tim, pakai langganan — tanpa API key.</span></div></li>
              <li><span class="material-symbols-rounded" aria-hidden="true">group_add</span><div><b>Ajak tim, lalu coba review pertama</b><span>Cukup komentar <code>lapor &#64;chefjuno</code> di PR.</span></div></li>
            </ul>
            <div class="status" data-testid="setup-init">
              @if (init() === 'busy') {<mat-progress-spinner diameter="20" mode="indeterminate" /> Menyiapkan workspace…}
              @else if (init() === 'ok') {<span class="material-symbols-rounded ok" aria-hidden="true">check_circle</span> Workspace siap: setting review, prompt inti, dan skill bawaan reviewer sudah dipasang.}
              @else if (init() === 'error') {<span class="material-symbols-rounded err" aria-hidden="true">error</span> Gagal menyiapkan workspace: {{ initError() }} <button matButton (click)="runInit()">Coba lagi</button>}
            </div>
          }
          @case ('github') {
            <h1>Pasang GitHub App</h1>
            <p class="lead">Pasang GitHub App Chef Juno di organisasi atau akunmu, lalu pilih repo yang mau direview. Repo yang dipilih otomatis muncul di sini.</p>
            @if (installUrl()) {
              <a matButton="filled" [href]="installUrl()" target="_blank" rel="noopener" data-testid="install-app">
                <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span> Pasang di GitHub
              </a>
            } @else {
              <p class="note">Slug GitHub App belum diisi (param <code>GITHUB_APP_SLUG</code>). Lihat langkah setup di <code>docs/SETUP.md</code>.</p>
            }
            <h2>Repositori terhubung</h2>
            @if (repos().data.length) {
              <ul class="items" data-testid="setup-repos">
                @for (r of repos().data; track r.id) {<li><span class="material-symbols-rounded ok" aria-hidden="true">check_circle</span>{{ r.fullName }}</li>}
              </ul>
            } @else {
              <p class="waiting"><mat-progress-spinner diameter="18" mode="indeterminate" /> Menunggu repositori dari GitHub…</p>
            }
          }
          @case ('machine') {
            <h1>Tambah mesin reviewer</h1>
            <p class="lead">Mesin = komputer anggota tim (atau server) yang menjalankan review. Chef Juno memakai Claude Code atau Codex yang sudah login dengan langganan di mesin itu.</p>
            <ol class="req">
              <li>Node.js 22+ terpasang.</li>
              <li><code>claude</code> atau <code>codex</code> sudah login di mesin itu.</li>
            </ol>
            @if (!code()) {
              <div class="inline">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                  <mat-label>Nama mesin</mat-label>
                  <input matInput [value]="machineName()" (input)="machineName.set($any($event.target).value)" placeholder="mis. MacBook Tim" data-testid="setup-machine-name" />
                </mat-form-field>
                <button matButton="filled" (click)="createCode()" [disabled]="busy() || machineName().trim().length < 2" data-testid="setup-machine-code">Buat kode</button>
              </div>
              @if (codeError()) {<p class="err" role="alert">{{ codeError() }}</p>}
            } @else {
              <p>Jalankan di mesin itu (kode berlaku 10 menit, sekali pakai):</p>
              <div class="cmd"><code data-testid="setup-machine-command">{{ loginCmd() }}</code><button matButton="tonal" (click)="copy(loginCmd())">Salin</button></div>
              <div class="cmd"><code>{{ startCmd }}</code><button matButton="tonal" (click)="copy(startCmd)">Salin</button></div>
            }
            <h2>Status mesin</h2>
            @if (onlineMachines().length) {
              <ul class="items" data-testid="setup-machines">
                @for (m of onlineMachines(); track m.id) {<li><span class="material-symbols-rounded ok" aria-hidden="true">check_circle</span>{{ m.name }} online · {{ m.agents }}</li>}
              </ul>
            } @else {
              <p class="waiting"><mat-progress-spinner diameter="18" mode="indeterminate" /> Menunggu mesin online…</p>
            }
          }
          @case ('team') {
            <h1>Ajak tim</h1>
            <p class="lead">Hanya anggota yang bisa membuka dashboard dan memanggil Chef Juno. Tambahkan lewat login GitHub — bisa juga nanti di Pengaturan.</p>
            <div class="inline">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                <mat-label>Login GitHub</mat-label>
                <input matInput [value]="memberLogin()" (input)="memberLogin.set($any($event.target).value)" (keydown.enter)="addMember()" data-testid="setup-member-login" />
              </mat-form-field>
              <button matButton="filled" (click)="addMember()" [disabled]="busy() || !memberLogin().trim()" data-testid="setup-member-add">Tambah</button>
            </div>
            @if (memberError()) {<p class="err" role="alert">{{ memberError() }}</p>}
            <ul class="items" data-testid="setup-members">
              @for (m of members().data; track m.id) {<li><span class="material-symbols-rounded ok" aria-hidden="true">person</span>&#64;{{ m.githubLogin }}<span class="cj-muted">{{ m.role === 'admin' ? 'Admin' : 'Anggota' }}</span></li>}
            </ul>
          }
          @case ('first') {
            <h1>Review pertama</h1>
            <p class="lead">Buka pull request di repo yang terhubung, lalu tulis komentar:</p>
            <div class="cmd big"><code>lapor &#64;chefjuno</code><button matButton="tonal" (click)="copy('lapor @chefjuno')">Salin</button></div>
            @if (!done().github || !done().machine) {
              <p class="note">Belum bisa jalan: {{ !done().github ? 'belum ada repo terhubung' : '' }}{{ !done().github && !done().machine ? ' dan ' : '' }}{{ !done().machine ? 'belum ada mesin online' : '' }}.</p>
            }
            <h2>Status</h2>
            @if (firstReview().data.length) {
              <p class="items-one" data-testid="setup-first-review"><span class="material-symbols-rounded ok" aria-hidden="true">check_circle</span>
                Review pertama masuk: {{ firstReview().data[0].repo }} #{{ firstReview().data[0].pr }}</p>
            } @else {
              <p class="waiting"><mat-progress-spinner diameter="18" mode="indeterminate" /> Menunggu review pertama…</p>
            }
          }
        }

        <footer class="nav">
          @if (current() > 0) {<button matButton (click)="current.set(current() - 1)">Kembali</button>}
          <span class="spacer"></span>
          @if (current() < steps.length - 1) {
            <button matButton="filled" (click)="current.set(current() + 1)" data-testid="setup-next">{{ done()[steps[current()].key] ? 'Lanjut' : 'Lewati langkah ini' }}</button>
          } @else {
            <button matButton="filled" (click)="finish()" [disabled]="busy()" data-testid="setup-finish">Selesai, buka dashboard</button>
          }
        </footer>
      </main>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--mat-sys-surface-container); }
    .top { height: 72px; display: flex; align-items: center; gap: 12px; padding: 0 24px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .name { font: var(--mat-sys-title-large); font-size: 24px; }
    .name b { font-weight: 500; } .name .sub { color: var(--mat-sys-on-surface-variant); }
    .spacer { flex: 1; }
    .wrap { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; max-width: 1180px; margin: 8px auto 48px; padding: 0 24px; }
    .steps { display: flex; flex-direction: column; gap: 6px; }
    .progress { margin: 8px 4px 6px; font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface-variant); }
    .bar { height: 6px; border-radius: 999px; background: var(--mat-sys-surface-container-highest); margin: 0 4px 14px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--mat-sys-primary); border-radius: inherit; transition: width .3s; }
    .step { display: flex; align-items: center; gap: 12px; text-align: left; border: 0; background: transparent; color: inherit; padding: 12px; border-radius: 20px; cursor: pointer; font: inherit; }
    .step:hover { background: var(--mat-sys-surface-container-high); }
    .step.on { background: var(--mat-sys-surface); }
    .dot { width: 32px; height: 32px; flex: none; border-radius: 999px; display: grid; place-items: center; font: var(--mat-sys-label-large);
      background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .step.on .dot { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
    .step.done .dot { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .dot .material-symbols-rounded { font-size: 20px; }
    .txt { display: flex; flex-direction: column; } .txt b { font: var(--mat-sys-title-small); } .txt span { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); }
    .panel { background: var(--mat-sys-surface); border-radius: 28px; padding: 36px 40px 28px; min-height: 520px; display: flex; flex-direction: column; }
    h1 { font: var(--mat-sys-headline-medium); margin: 0 0 8px; }
    h2 { font: var(--mat-sys-title-medium); margin: 28px 0 8px; }
    .lead { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-large); margin: 0 0 20px; max-width: 680px; }
    .what { list-style: none; padding: 0; margin: 0 0 20px; display: grid; gap: 12px; }
    .what li { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; border-radius: 16px; background: var(--mat-sys-surface-container-low); }
    .what li > .material-symbols-rounded { color: var(--mat-sys-primary); }
    .what div { display: flex; flex-direction: column; gap: 2px; } .what span { color: var(--mat-sys-on-surface-variant); }
    .status, .waiting, .items-one { display: flex; align-items: center; gap: 10px; color: var(--mat-sys-on-surface-variant); }
    .ok { color: var(--mat-sys-primary); } .err { color: var(--mat-sys-error); }
    .items { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    .items li { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: var(--mat-sys-surface-container-low); }
    .items li .cj-muted { margin-left: auto; }
    .inline { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; } .grow { flex: 1; min-width: 220px; }
    .req { padding-left: 20px; line-height: 1.8; margin: 0 0 16px; }
    .cmd { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 10px 10px 16px; margin: 8px 0; border-radius: 14px;
      background: var(--mat-sys-surface-container-high); }
    .cmd code { overflow-wrap: anywhere; font-size: 13px; } .cmd.big code { font-size: 18px; }
    .note { padding: 12px 16px; border-radius: 12px; background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .panel > a[matButton] { align-self: flex-start; }
    .nav { display: flex; gap: 8px; margin-top: auto; padding-top: 28px; }
    .cj-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 900px) {
      .wrap { grid-template-columns: 1fr; padding: 0 12px; }
      .steps { flex-direction: row; overflow-x: auto; } .progress, .bar { display: none; }
      .step .txt span { display: none; } .panel { padding: 24px 20px; }
    }
  `,
})
export class OnboardingPage {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly now = nowSignal(5_000);
  protected readonly steps = STEPS;
  protected readonly startCmd = MACHINE_START_COMMAND;
  protected readonly current = signal(0);
  protected readonly busy = signal(false);
  protected readonly init = signal<'busy' | 'ok' | 'error'>('busy');
  protected readonly initError = signal('');
  protected readonly installUrl = signal('');
  protected readonly machineName = signal('');
  protected readonly code = signal('');
  protected readonly codeError = signal('');
  protected readonly memberLogin = signal('');
  protected readonly memberError = signal('');
  protected readonly login = computed(() => this.auth.membership()?.githubLogin ?? 'admin');

  protected readonly repos = liveQuery(() => query(collection(this.fb.db, 'repos'), orderBy('fullName')), (id, d) => ({ id, fullName: d['fullName'] as string }));
  private readonly machines = liveQuery(() => query(collection(this.fb.db, 'machines'), where('revoked', '==', false)), (id, d) => ({
    id,
    name: String(d['name'] ?? id),
    revoked: false,
    lastSeenAtMs: toMs(d['lastSeenAt']),
    currentJobIds: (d['currentJobIds'] ?? []) as string[],
    concurrency: Number(d['concurrency'] ?? 1),
    agents: Object.entries((d['agents'] ?? {}) as Record<string, { version?: string } | null>)
      .filter(([, a]) => a)
      .map(([k, a]) => `${k === 'claude' ? 'Claude Code' : 'Codex'} ${a?.version ?? ''}`.trim())
      .join(', ') || 'agent belum terdeteksi',
  }));
  protected readonly members = liveQuery(() => query(collection(this.fb.db, 'members'), orderBy('githubLogin')), (id, d) => ({ id, githubLogin: String(d['githubLogin']), role: String(d['role']) }));
  protected readonly firstReview = liveQuery(() => query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), limit(1)), (id, d) => ({
    id,
    repo: String(d['repo']?.fullName ?? ''),
    pr: Number(d['pr']?.number ?? 0),
  }));
  protected readonly onlineMachines = computed(() => this.machines().data.filter((m) => ['online', 'busy'].includes(machineStatus(m, this.now()))));
  protected readonly done = computed<Record<StepKey, boolean>>(() => ({
    welcome: this.init() === 'ok',
    github: this.repos().data.length > 0,
    machine: this.onlineMachines().length > 0,
    team: this.members().data.length > 1,
    first: this.firstReview().data.length > 0,
  }));
  protected readonly doneCount = computed(() => Object.values(this.done()).filter(Boolean).length);
  protected readonly loginCmd = computed(() => machineLoginCommand(this.fb.functionsBaseUrl(), this.code()));

  constructor() {
    void this.runInit();
  }

  async runInit() {
    this.init.set('busy');
    try {
      const r = await this.fb.call<{ action: string }, { created: string[]; githubAppInstallUrl: string }>('setupWorkspace')({ action: 'init' });
      this.installUrl.set(r.githubAppInstallUrl);
      this.init.set('ok');
    } catch (e) {
      this.initError.set((e as Error).message);
      this.init.set('error');
    }
  }

  async createCode() {
    this.busy.set(true);
    this.codeError.set('');
    try {
      const r = await this.fb.call<{ name: string }, { code: string }>('createMachineRegistration')({ name: this.machineName().trim() });
      this.code.set(r.code);
    } catch (e) {
      this.codeError.set('Gagal membuat kode: ' + (e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async addMember() {
    const login = this.memberLogin().trim().replace(/^@/, '');
    if (!login) return;
    this.busy.set(true);
    this.memberError.set('');
    try {
      await this.fb.call('upsertMember')({ githubLogin: login, role: 'member' });
      this.memberLogin.set('');
    } catch (e) {
      this.memberError.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard bisa ditolak browser; teks tetap terlihat untuk disalin manual
    }
  }

  async finish() {
    this.busy.set(true);
    try {
      await this.fb.call('setupWorkspace')({ action: 'complete' });
      await this.router.navigateByUrl('/reviews');
    } finally {
      this.busy.set(false);
    }
  }
}
