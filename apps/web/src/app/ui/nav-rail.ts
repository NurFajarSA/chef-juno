import { Component, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatTooltip } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { ThemeService } from '../core/theme.service';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

/** Menu utama: isi/fitur ala Greptile, tampilan rail ala Google Foresight. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/reviews', label: 'Review', icon: 'rate_review' },
  { path: '/memory', label: 'Memory', icon: 'psychology' },
  { path: '/kb', label: 'Knowledge', icon: 'menu_book' },
  { path: '/analytics', label: 'Analitik', icon: 'monitoring' },
  { path: '/rapor', label: 'Rapor', icon: 'insights' },
  { path: '/repos', label: 'Repositori', icon: 'folder_code' },
  { path: '/machines', label: 'Mesin', icon: 'dns' },
  { path: '/skills', label: 'Skills', icon: 'folder_special' },
];

/** Navigation rail M3 (ikon + label, indikator pill tonal). Di layar sempit jadi bottom bar + "Lainnya". */
@Component({
  selector: 'cj-nav-rail',
  imports: [RouterLink, RouterLinkActive, MatTooltip, MatMenuModule],
  template: `
    <nav aria-label="Navigasi utama">
      <ul class="items">
        @for (it of items; track it.path; let i = $index) {
          <li [class.extra]="i >= 4">
            <a [routerLink]="it.path" routerLinkActive="active" #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
              <span class="pill"><span class="material-symbols-rounded" aria-hidden="true">{{ it.icon }}</span></span>
              <span class="label">{{ it.label }}</span>
            </a>
          </li>
        }
      </ul>
      <button type="button" class="more" [matMenuTriggerFor]="more" aria-label="Menu lainnya" data-testid="nav-more">
        <span class="pill"><span class="material-symbols-rounded" aria-hidden="true">more_horiz</span></span>
        <span class="label">Lainnya</span>
      </button>
      <mat-menu #more="matMenu">
        @for (it of items.slice(4); track it.path) {
          <a mat-menu-item [routerLink]="it.path"><span class="material-symbols-rounded" aria-hidden="true">{{ it.icon }}</span> {{ it.label }}</a>
        }
        <a mat-menu-item routerLink="/settings"><span class="material-symbols-rounded" aria-hidden="true">settings</span> Pengaturan</a>
        <button mat-menu-item (click)="theme.toggle()"><span class="material-symbols-rounded" aria-hidden="true">{{ theme.isDark() ? 'light_mode' : 'dark_mode' }}</span> {{ theme.isDark() ? 'Mode terang' : 'Mode gelap' }}</button>
        <a mat-menu-item routerLink="/docs"><span class="material-symbols-rounded" aria-hidden="true">help</span> Panduan</a>
        <button mat-menu-item (click)="signOut.emit()"><span class="material-symbols-rounded" aria-hidden="true">logout</span> Keluar</button>
      </mat-menu>
      <div class="bottom">
        <a routerLink="/settings" routerLinkActive="active" #rs="routerLinkActive" [attr.aria-current]="rs.isActive ? 'page' : null">
          <span class="pill"><span class="material-symbols-rounded" aria-hidden="true">settings</span></span>
          <span class="label">Pengaturan</span>
        </a>
        <a routerLink="/docs" class="icon-btn" routerLinkActive="active" aria-label="Panduan" matTooltip="Panduan" matTooltipPosition="right" data-testid="nav-docs">
          <span class="material-symbols-rounded" aria-hidden="true">help</span>
        </a>
        <button type="button" class="icon-btn" (click)="theme.toggle()" [attr.aria-label]="theme.isDark() ? 'Mode terang' : 'Mode gelap'"
                [matTooltip]="theme.isDark() ? 'Mode terang' : 'Mode gelap'" matTooltipPosition="right" data-testid="theme-toggle">
          <span class="material-symbols-rounded" aria-hidden="true">{{ theme.isDark() ? 'light_mode' : 'dark_mode' }}</span>
        </button>
        <button type="button" class="avatar" [matMenuTriggerFor]="acct" [attr.aria-label]="'Akun ' + (login() ? '@' + login() : '')">
          @if (avatar()) {
            <img [src]="avatar()" alt="" width="36" height="36" />
          } @else {
            <span class="initial">{{ (login() || '?').slice(0, 1).toUpperCase() }}</span>
          }
        </button>
        <mat-menu #acct="matMenu" xPosition="after" yPosition="above" class="cj-acct-menu">
          <div class="acct-card" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()" role="presentation">
            <span class="initial big" aria-hidden="true">{{ (login() || '?').slice(0, 1).toUpperCase() }}</span>
            <span class="who"><b>&#64;{{ login() || 'akun' }}</b><span class="cj-muted">Akun GitHub</span></span>
            <button type="button" class="out" (click)="signOut.emit()" aria-label="Keluar" matTooltip="Keluar"><span class="material-symbols-rounded" aria-hidden="true">logout</span></button>
          </div>
          <a mat-menu-item routerLink="/settings"><span class="material-symbols-rounded" aria-hidden="true">manage_accounts</span><span>Akun & pengaturan</span></a>
          <a mat-menu-item [routerLink]="['/rapor', login()]"><span class="material-symbols-rounded" aria-hidden="true">insights</span><span>Rapor saya</span></a>
        </mat-menu>
      </div>
    </nav>
  `,
  styles: `
    :host { display: block; }
    nav { display: flex; flex-direction: column; align-items: center; width: 92px; height: calc(100vh - 72px); position: sticky; top: 72px; padding: 8px 0 16px; box-sizing: border-box; gap: 8px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    a:not(.mat-mdc-menu-item):not(.icon-btn), .more { display: flex; flex-direction: column; align-items: center; gap: 4px; text-decoration: none; color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium); padding: 6px 0; width: 84px; border-radius: 16px; border: 0; background: transparent; cursor: pointer; }
    .pill { width: 56px; height: 32px; border-radius: 16px; display: grid; place-items: center; transition: background .15s; }
    a:hover .pill, .more:hover .pill { background: var(--mat-sys-surface-container-highest); }
    /* prioritas harus ≥ selector dasar di atas (a:not(...):not(...)), kalau tidak latar aktif tertimpa transparent */
    a.active:not(.mat-mdc-menu-item):not(.icon-btn) { color: var(--mat-sys-on-surface); font-weight: 600; background: var(--mat-sys-secondary-container); }
    a.active .pill { color: var(--mat-sys-on-secondary-container); }
    .more { display: none; }
    .bottom { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .icon-btn, .avatar { border: 0; background: transparent; color: var(--mat-sys-on-surface-variant); width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; cursor: pointer; padding: 0; }
    .icon-btn:hover { background: var(--mat-sys-surface-container-highest); }
    .icon-btn.active { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    a.icon-btn { text-decoration: none; }
    .avatar img { width: 36px; height: 36px; border-radius: 999px; }
    .initial { width: 36px; height: 36px; border-radius: 999px; display: grid; place-items: center; background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); font: var(--mat-sys-title-medium); }

    @media (max-width: 720px) {
      nav { flex-direction: row; width: 100%; height: 72px; position: fixed; top: auto; bottom: 0; left: 0; z-index: 10; padding: 0 4px;
        background: var(--mat-sys-surface-container); border-top: 1px solid var(--mat-sys-outline-variant); gap: 0; justify-content: space-around; }
      .bottom, li.extra { display: none; }
      ul { flex-direction: row; flex: 4; justify-content: space-around; }
      a:not(.mat-mdc-menu-item):not(.icon-btn), .more { width: auto; flex: 1; font-size: 11px; background: transparent !important; }
      a.active .pill { background: var(--mat-sys-secondary-container); }
      .more { display: flex; }
      .label { white-space: nowrap; }
    }
  `,
})
export class CjNavRail {
  protected readonly items = NAV_ITEMS;
  protected readonly theme = inject(ThemeService);
  readonly avatar = input<string | null>(null);
  readonly login = input<string | null>(null);
  readonly signOut = output<void>();
}
