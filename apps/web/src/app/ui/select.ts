import { Component, computed, input, output } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

/**
 * Dropdown pil ala Google Foresight: tombol pil + panel menu M3 (bukan popup native browser).
 * Opsi terpilih diberi tanda centang dan latar lembut.
 */
@Component({
  selector: 'cj-select',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger],
  template: `
    <button type="button" class="trigger" [matMenuTriggerFor]="m" [attr.aria-label]="label() + ': ' + current()" [attr.data-testid]="testId() || null">
      <span class="txt">{{ current() }}</span>
      <span class="material-symbols-rounded" aria-hidden="true">expand_more</span>
    </button>
    <mat-menu #m="matMenu" class="cj-select-panel" xPosition="before">
      @for (o of options(); track o.value) {
        <button mat-menu-item role="menuitemradio" [attr.aria-checked]="o.value === value()" [class.on]="o.value === value()" [attr.data-value]="o.value" (click)="valueChange.emit(o.value)">
          <span class="check material-symbols-rounded" aria-hidden="true">{{ o.value === value() ? 'check' : '' }}</span>
          <span>{{ o.label }}</span>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    :host { display: inline-block; }
    .trigger { height: 40px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px 0 18px; border: 0; border-radius: 999px;
      background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); font: var(--mat-sys-label-large); cursor: pointer; max-width: 260px; }
    .trigger:hover { background: var(--mat-sys-surface-container-high); }
    .trigger[aria-expanded='true'] { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class CjSelect<T extends string | number = string> {
  readonly options = input.required<SelectOption<T>[]>();
  readonly value = input.required<T>();
  readonly label = input.required<string>();
  readonly testId = input('');
  readonly valueChange = output<T>();
  protected readonly current = computed(() => this.options().find((o) => o.value === this.value())?.label ?? '—');
}
