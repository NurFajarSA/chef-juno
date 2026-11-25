import { Component, input } from '@angular/core';

@Component({
  selector: 'cj-empty-state',
  template: `
    <span class="material-symbols-rounded icon" aria-hidden="true">{{ icon() }}</span>
    <h2>{{ title() }}</h2>
    @if (text()) {
      <p class="cj-muted">{{ text() }}</p>
    }
    <ng-content />
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 16px; gap: 8px; }
    .icon { font-size: 48px; color: var(--mat-sys-primary); }
    h2 { font: var(--mat-sys-title-large); margin: 8px 0 0; }
    p { margin: 0; max-width: 480px; }
  `,
})
export class CjEmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input('');
}
