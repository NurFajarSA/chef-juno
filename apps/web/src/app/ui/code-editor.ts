import { Component, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';

/**
 * Editor teks ala code editor: gutter nomor baris yang ikut menggulir, font monospace,
 * Tab = 2 spasi, Ctrl/⌘+S = simpan. Melaporkan posisi kursor (baris/kolom) untuk status bar.
 */
@Component({
  selector: 'cj-code-editor',
  template: `
    <div class="ed" [class.ro]="readonly()">
      <div class="gutter" #gutter aria-hidden="true">
        @for (n of lineNumbers(); track n) {<div [class.cur]="n === line()">{{ n }}</div>}
      </div>
      <textarea #ta class="src" spellcheck="false" wrap="off" [value]="value()" [readOnly]="readonly()"
        (input)="value.set(ta.value); report()" (scroll)="sync()" (keydown)="key($event)" (click)="report()" (keyup)="report()"
        [attr.aria-label]="label()" [attr.data-testid]="testId() || null"></textarea>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 0; height: 100%; }
    .ed { display: flex; height: 100%; min-height: 0; background: var(--mat-sys-surface); font-family: 'Google Sans Code Variable', ui-monospace, monospace;
      font-size: 13px; line-height: 20px; }
    .gutter { flex: none; width: 52px; padding: 12px 0; overflow: hidden; text-align: right; color: var(--mat-sys-on-surface-variant);
      user-select: none; border-right: 1px solid var(--mat-sys-outline-variant); }
    .gutter div { padding-right: 12px; height: 20px; }
    .gutter div.cur { color: var(--mat-sys-on-surface); font-weight: 600; }
    .src { flex: 1; min-width: 0; border: 0; outline: 0; resize: none; padding: 12px 16px; margin: 0; background: transparent; color: var(--mat-sys-on-surface);
      font: inherit; line-height: inherit; white-space: pre; overflow: auto; tab-size: 2; }
    .src:focus-visible { box-shadow: inset 0 0 0 2px var(--mat-sys-primary); }
    .ro .src { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class CjCodeEditor {
  readonly value = model('');
  readonly readonly = input(false);
  readonly label = input('Editor');
  readonly testId = input('');
  readonly save = output<void>();
  readonly cursor = output<{ line: number; col: number }>();
  private readonly ta = viewChild.required<ElementRef<HTMLTextAreaElement>>('ta');
  private readonly gutter = viewChild.required<ElementRef<HTMLDivElement>>('gutter');
  protected readonly line = signal(1);
  protected readonly lineNumbers = computed(() => Array.from({ length: Math.max(1, this.value().split('\n').length) }, (_, i) => i + 1));

  protected sync() {
    this.gutter().nativeElement.scrollTop = this.ta().nativeElement.scrollTop;
  }

  protected report() {
    const el = this.ta().nativeElement;
    const before = el.value.slice(0, el.selectionStart ?? 0);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    this.line.set(line);
    this.cursor.emit({ line, col });
  }

  protected key(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.save.emit();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !this.readonly()) {
      e.preventDefault();
      const el = this.ta().nativeElement;
      const [s, end] = [el.selectionStart, el.selectionEnd];
      const v = el.value.slice(0, s) + '  ' + el.value.slice(end);
      this.value.set(v);
      queueMicrotask(() => el.setSelectionRange(s + 2, s + 2));
    }
  }

  focus() {
    this.ta().nativeElement.focus();
  }
}
