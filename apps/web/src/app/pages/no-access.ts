import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { AuthService } from '../core/auth.service';
import { CjEmptyState } from '../ui/empty-state';

@Component({
  selector: 'cj-no-access',
  imports: [MatButton, CjEmptyState],
  template: `
    <div class="wrap">
      <div class="cj-card box" data-testid="no-access">
        <cj-empty-state icon="block" title="Tidak punya akses"
          [text]="'Akun GitHub ' + (login() ? '@' + login() : 'ini') + ' belum terdaftar sebagai anggota Chef Juno. Minta admin menambahkanmu di Pengaturan → Anggota.'">
          <button matButton="tonal" (click)="logout()">Keluar</button>
        </cj-empty-state>
      </div>
    </div>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
    .box { width: min(520px, 100%); box-sizing: border-box; }
  `,
})
export class NoAccessPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected login() {
    return this.auth.membership()?.githubLogin ?? this.auth.user()?.displayName ?? null;
  }
  async logout() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
