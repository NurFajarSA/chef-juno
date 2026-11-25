import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatTooltip } from '@angular/material/tooltip';

export interface Crumb {
  label: string;
  link?: string;
}

/**
 * Kerangka halaman ala Google Foresight.
 * - Halaman daftar: judul besar di latar (+ breadcrumb kecil).
 * - Halaman detail (`back`): tombol kembali bulat + ikon bulat + judul + chip meta (slot [meta]).
 */
@Component({
  selector: 'cj-page',
  imports: [RouterLink, MatTooltip],
  template: `
    <header class="head" [class.detail]="!!back()">
      @if (back()) {
        <div class="detail-head">
          <a class="back" [routerLink]="back()" [attr.aria-label]="'Kembali ke ' + backLabel()" [matTooltip]="'Kembali ke ' + backLabel()" data-testid="page-back">
            <span class="material-symbols-rounded" aria-hidden="true">arrow_back</span>
          </a>
          @if (icon()) {<span class="icon"><span class="material-symbols-rounded" aria-hidden="true">{{ icon() }}</span></span>}
          <div class="titles">
            <h1 class="detail-title">{{ heading() }}</h1>
            <div class="cj-page-meta"><ng-content select="[meta]" /></div>
          </div>
        </div>
      } @else {
        <div class="titles">
          @if (crumbs().length) {
            <nav class="crumbs" aria-label="Breadcrumb">
              @for (c of crumbs(); track c.label) {
                @if (c.link) {<a [routerLink]="c.link">{{ c.label }}</a>} @else {<span>{{ c.label }}</span>}
                <span class="sep" aria-hidden="true">›</span>
              }
            </nav>
          }
          <h1>{{ heading() }}</h1>
          @if (subtitle()) {<p class="sub">{{ subtitle() }}</p>}
        </div>
      }
      <div class="actions"><ng-content select="[actions]" /></div>
    </header>
    <ng-content />
  `,
  styles: `
    :host { display: block; padding: 24px 40px 96px 72px; max-width: 1480px; box-sizing: border-box; }
    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
    .head.detail { align-items: center; margin-bottom: 20px; }
    .crumbs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
    .crumbs a, .crumbs span { color: var(--mat-sys-on-surface-variant); text-decoration: none; font: var(--mat-sys-label-large); }
    .crumbs a:hover { color: var(--mat-sys-primary); }
    h1 { font: var(--mat-sys-display-small); font-size: 36px; margin: 0; letter-spacing: -0.5px; }
    .sub { margin: 6px 0 0; color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .detail-head { display: flex; align-items: center; gap: 16px; min-width: 0; }
    .back { width: 56px; height: 56px; flex: none; border-radius: 999px; display: grid; place-items: center; background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface); text-decoration: none; }
    .back:hover { background: var(--mat-sys-surface-container-lowest); box-shadow: 0 1px 3px rgb(0 0 0 / .12); }
    .icon { width: 72px; height: 72px; flex: none; border-radius: 999px; display: grid; place-items: center; background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant); }
    .icon .material-symbols-rounded { font-size: 32px; }
    .detail-title { font: var(--mat-sys-headline-small); font-size: 28px; letter-spacing: 0; overflow-wrap: anywhere; }
    .cj-page-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .cj-page-meta:empty { display: none; }
    :host ::ng-deep .cj-page-meta > * { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 10px;
      border: 1px solid var(--mat-sys-outline-variant); font: var(--mat-sys-label-large); color: var(--mat-sys-on-surface); text-decoration: none; }
    @media (max-width: 1100px) { :host { padding: 16px 24px 96px 24px; } }
    @media (max-width: 600px) {
      :host { padding: 12px 12px 96px; } h1 { font-size: 28px; }
      .icon { display: none; } .back { width: 44px; height: 44px; } .detail-title { font-size: 22px; }
    }
  `,
})
export class CjPage {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>('');
  readonly crumbs = input<Crumb[]>([]);
  /** link kembali → tampilan header detail */
  readonly back = input<string>('');
  readonly backLabel = input<string>('daftar');
  readonly icon = input<string>('');
}
