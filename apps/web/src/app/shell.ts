import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { collection, query, where } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { machineStatus } from '@chefjuno/shared';
import { CjLogo } from './ui/logo';
import { CjNavRail } from './ui/nav-rail';
import { AuthService } from './core/auth.service';
import { FirebaseService } from './core/firebase';
import { liveQuery } from './core/live';
import { nowSignal } from './core/now';
import { toMs } from './core/format';
import { RequestReviewDialog } from './pages/request-review-dialog';

/** Kerangka aplikasi ala Google Foresight: app bar (brand + chip status + aksi utama), rail di kiri, konten di latar surface-container. */
@Component({
  selector: 'cj-shell',
  imports: [RouterOutlet, RouterLink, CjNavRail, CjLogo, MatButton],
  template: `
    <header class="appbar">
      <a routerLink="/reviews" class="brand" aria-label="Chef Juno — beranda">
        <cj-logo [size]="36" />
        <span class="name"><b>Chef Juno</b><span class="sub hide-sm"> Code Review</span></span>
      </a>
      <a class="chip" routerLink="/machines" data-testid="chip-machines"><b>{{ online() }}</b>&nbsp;mesin online</a>
      <a class="chip hide-sm" routerLink="/reviews"><b>{{ reviewing() }}</b>&nbsp;sedang direview</a>
      <span class="spacer"></span>
      <button matButton="filled" class="cta" (click)="requestReview()" data-testid="appbar-request-review">
        <span class="material-symbols-rounded" aria-hidden="true">rate_review</span> Minta review
      </button>
    </header>
    <div class="body">
      <cj-nav-rail [avatar]="avatar()" [login]="auth.membership()?.githubLogin ?? null" (signOut)="logout()" />
      <main id="main" data-testid="shell-main"><router-outlet /></main>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; }
    .appbar { position: sticky; top: 0; z-index: 5; height: 72px; display: flex; align-items: center; gap: 10px; padding: 0 20px 0 24px;
      background: var(--mat-sys-surface-container); box-sizing: border-box; }
    .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; margin-right: 6px; }
    .name { font: var(--mat-sys-title-large); font-size: 24px; letter-spacing: -0.2px; white-space: nowrap; }
    .name b { font-weight: 500; color: var(--mat-sys-on-surface); }
    .name .sub { font-weight: 400; color: var(--mat-sys-on-surface-variant); }
    .chip { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; background: var(--mat-sys-surface);
      font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface); text-decoration: none; white-space: nowrap; }
    .chip code { background: transparent; padding: 0 0 0 4px; }
    .spacer { flex: 1; }
    .body { display: flex; }
    main { flex: 1; min-width: 0; }
    @media (max-width: 900px) { .hide-sm { display: none; } }
    @media (max-width: 720px) { .appbar { padding: 0 12px; } .cta { display: none; } .name { font: var(--mat-sys-title-medium); } }
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  private readonly fb = inject(FirebaseService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly now = nowSignal(10_000);
  protected readonly avatar = computed(() => this.auth.user()?.photoURL || null);
  private readonly machines = liveQuery(() => query(collection(this.fb.db, 'machines'), where('revoked', '==', false)), (_id, d) => ({
    revoked: !!d['revoked'],
    lastSeenAtMs: toMs(d['lastSeenAt']),
    currentJobIds: (d['currentJobIds'] ?? []) as string[],
    concurrency: (d['concurrency'] ?? 1) as number,
  }));
  private readonly active = liveQuery(() => query(collection(this.fb.db, 'jobs'), where('status', 'in', ['queued', 'claimed', 'running'])), (id) => id);
  protected readonly online = computed(() => this.machines().data.filter((m) => ['online', 'busy'].includes(machineStatus(m, this.now()))).length);
  protected readonly reviewing = computed(() => this.active().data.length);
  requestReview() {
    this.dialog.open(RequestReviewDialog, { width: '560px', maxWidth: '95vw' });
  }
  async logout() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
