import { Component, computed, input } from '@angular/core';

export type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'tertiary';

/** Chip/pill status & metadata. Warna hanya lewat var(--mat-sys-*). */
@Component({
  selector: 'cj-chip',
  template: `@if (icon()) {<span class="material-symbols-rounded" aria-hidden="true">{{ icon() }}</span>}<ng-content />`,
  host: { '[class]': 'cls()', role: 'status' },
  styles: `
    :host { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; min-height: 24px; border-radius: 999px;
      font: var(--mat-sys-label-medium); white-space: nowrap; box-sizing: border-box; }
    :host(.wrap) { white-space: normal; max-width: 100%; }
    .material-symbols-rounded { font-size: 16px; }
    :host(.neutral) { background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    :host(.primary) { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    :host(.tertiary) { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    :host(.success) { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    :host(.warning) { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    :host(.error) { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
  `,
})
export class CjChip {
  readonly tone = input<ChipTone>('neutral');
  readonly icon = input<string>('');
  /** Teks panjang boleh membungkus (mis. kalimat perkembangan di rapor). */
  readonly wrap = input(false);
  protected readonly cls = computed(() => `${this.tone()}${this.wrap() ? ' wrap' : ''}`);
}

export const STATUS_TONE: Record<string, ChipTone> = {
  queued: 'neutral',
  claimed: 'primary',
  running: 'primary',
  completed: 'success',
  posted: 'success',
  failed: 'error',
  cancelled: 'neutral',
  online: 'success',
  busy: 'primary',
  offline: 'neutral',
  revoked: 'error',
  P0: 'error',
  P1: 'warning',
  P2: 'neutral',
  addressed: 'success',
  ignored: 'neutral',
  disputed: 'warning',
  accepted_by_merge: 'primary',
  pending: 'neutral',
  ready: 'success',
  indexing: 'primary',
  none: 'neutral',
};
