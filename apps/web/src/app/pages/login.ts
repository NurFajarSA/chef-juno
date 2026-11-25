import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { CjLogo } from '../ui/logo';
import { AuthService } from '../core/auth.service';
import { FirebaseService } from '../core/firebase';

@Component({
  selector: 'cj-login',
  imports: [MatButton, CjLogo],
  template: `
    <div class="wrap">
      <div class="cj-card box">
        <cj-logo [size]="72" />
        <h1>Chef Juno</h1>
        <p class="cj-muted">Reviewer kode tim. Jujur, tegas, standar tinggi.</p>
        <button matButton="filled" (click)="login()" [disabled]="busy()" data-testid="login-github">
          <span class="material-symbols-rounded" aria-hidden="true">login</span> Masuk dengan GitHub
        </button>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        }
        @if (fb.emulator) {
          <p class="cj-muted small">Mode emulator (demo-chefjuno).</p>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
    .box { width: min(420px, 100%); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 24px; box-sizing: border-box; }
    h1 { font: var(--mat-sys-headline-medium); margin: 0; }
    p { margin: 0; }
    .err { color: var(--mat-sys-error); }
    .small { font: var(--mat-sys-body-small); }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly fb = inject(FirebaseService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    // Khusus emulator/test: ?customToken=… → login dengan custom token (Playwright).
    const token = this.route.snapshot.queryParamMap.get('customToken');
    if (token && this.fb.emulator) void this.run(() => this.auth.signInWithToken(token));
    else void this.auth.ready().then((u) => u && this.router.navigateByUrl('/'));
  }

  login() {
    void this.run(() => this.auth.signInWithGithub());
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.error.set('Gagal masuk: ' + ((e as Error).message ?? 'kesalahan tidak dikenal'));
    } finally {
      this.busy.set(false);
    }
  }
}
