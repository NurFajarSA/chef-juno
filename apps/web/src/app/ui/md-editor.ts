import { Component, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import type { FormValueControl } from '@angular/forms/signals';
import { miniMarkdown } from '../core/md';

const GUIDE = 'Tulis di sini. Markdown didukung.\n\nPanduan Markdown:\n• # Judul\n• **tebal**\n• *miring*\n• `kode`\n• - Daftar\n• 1. Daftar bernomor';

/**
 * Editor Markdown ala Google Foresight: toolbar format di atas, teks di kiri, pratinjau langsung di kanan.
 * Kontrol Signal Forms (FormValueControl) — bisa dipakai dengan [formField].
 */
@Component({
  selector: 'cj-md-editor',
  imports: [MatTooltip],
  template: `
    <div class="frame">
      <div class="toolbar" role="toolbar" [attr.aria-label]="'Format ' + label()">
        @for (t of tools; track t.icon) {
          <button type="button" class="tool" (click)="apply(t.kind)" [attr.aria-label]="t.label" [matTooltip]="t.label">
            <span class="material-symbols-rounded" aria-hidden="true">{{ t.icon }}</span>
          </button>
        }
        <span class="spacer"></span>
        <ng-content select="[toolbar-end]" />
      </div>
      <div class="body" [class.no-preview]="!showPreview()">
        <textarea #ta class="input" [value]="value()" (input)="value.set(ta.value)" (blur)="touch.emit()" [rows]="rows()"
                  [attr.aria-label]="label()" [placeholder]="placeholder() || guide" [attr.data-testid]="testId() || null"></textarea>
        @if (showPreview()) {
          <section class="preview" aria-live="polite">
            <header>
              <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
              <h3>{{ previewTitle() }}</h3>
              <span class="spacer"></span>
              <button type="button" class="tool" (click)="copy()" [attr.aria-label]="copied() ? 'Tersalin' : 'Salin teks'" [matTooltip]="copied() ? 'Tersalin' : 'Salin'">
                <span class="material-symbols-rounded" aria-hidden="true">{{ copied() ? 'check' : 'content_copy' }}</span>
              </button>
              <button type="button" class="tool" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-label="Tampilkan / sembunyikan pratinjau">
                <span class="material-symbols-rounded" aria-hidden="true">{{ open() ? 'expand_less' : 'expand_more' }}</span>
              </button>
            </header>
            @if (open()) {
              @if (value().trim()) {
                <div class="rendered cj-prose" [innerHTML]="html()" data-testid="md-preview"></div>
              } @else {
                <div class="empty">
                  <span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
                  <p>Preview muncul di sini saat kamu menulis.</p>
                </div>
              }
            }
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .frame { background: var(--mat-sys-surface); border-radius: 24px; overflow: hidden; }
    .toolbar { display: flex; align-items: center; gap: 4px; padding: 10px 16px; border-bottom: 1px solid var(--mat-sys-outline-variant); flex-wrap: wrap; }
    .spacer { flex: 1; }
    .tool { border: 0; background: transparent; color: var(--mat-sys-on-surface); width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; cursor: pointer; }
    .tool:hover { background: var(--mat-sys-surface-container-high); }
    .body { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; padding: 20px; }
    .body.no-preview { grid-template-columns: 1fr; }
    .input { width: 100%; box-sizing: border-box; border: 0; outline: 0; resize: vertical; background: transparent; color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-large); line-height: 1.6; padding: 4px; min-height: 240px; }
    .input::placeholder { color: var(--mat-sys-on-surface-variant); opacity: .8; }
    .input:focus-visible { outline: none; }
    .frame:focus-within { box-shadow: inset 0 0 0 2px var(--mat-sys-primary); }
    .preview { background: var(--mat-sys-surface-container); border-radius: 20px; padding: 12px 16px 16px; min-height: 240px; display: flex; flex-direction: column; }
    .preview header { display: flex; align-items: center; gap: 8px; }
    .preview header > .material-symbols-rounded { color: var(--mat-sys-primary); }
    h3 { font: var(--mat-sys-title-medium); margin: 0; }
    .rendered { font: var(--mat-sys-body-medium); padding-top: 8px; overflow-wrap: anywhere; }
    .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--mat-sys-on-surface-variant); }
    .empty .material-symbols-rounded { font-size: 36px; opacity: .6; }
    @media (max-width: 900px) { .body { grid-template-columns: 1fr; } }
  `,
})
export class CjMdEditor implements FormValueControl<string> {
  readonly value = model<string>('');
  readonly touch = output<void>();
  readonly label = input('Teks');
  readonly placeholder = input('');
  readonly previewTitle = input('Preview');
  readonly rows = input(12);
  readonly testId = input('');
  readonly showPreview = input(true);
  protected readonly guide = GUIDE;
  protected readonly open = signal(true);
  protected readonly copied = signal(false);
  protected readonly html = computed(() => miniMarkdown(this.value()));
  private readonly ta = viewChild.required<ElementRef<HTMLTextAreaElement>>('ta');
  protected readonly tools = [
    { icon: 'format_bold', label: 'Tebal', kind: 'bold' },
    { icon: 'format_italic', label: 'Miring', kind: 'italic' },
    { icon: 'format_list_bulleted', label: 'Daftar', kind: 'ul' },
    { icon: 'format_list_numbered', label: 'Daftar bernomor', kind: 'ol' },
    { icon: 'title', label: 'Judul', kind: 'h' },
    { icon: 'code', label: 'Kode', kind: 'code' },
  ] as const;

  focus() {
    this.ta().nativeElement.focus();
  }

  apply(kind: (typeof this.tools)[number]['kind']) {
    const el = this.ta().nativeElement;
    const v = this.value();
    const [s, e] = [el.selectionStart ?? v.length, el.selectionEnd ?? v.length];
    const sel = v.slice(s, e);
    const wrap = (a: string, b = a, ph = 'teks') => {
      const inner = sel || ph;
      return { text: v.slice(0, s) + a + inner + b + v.slice(e), from: s + a.length, to: s + a.length + inner.length };
    };
    const linePrefix = (p: (i: number) => string) => {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const block = v.slice(lineStart, e) || 'teks';
      const lines = block.split('\n').map((l, i) => p(i) + l.replace(/^(#{1,3}\s+|[-*]\s+|\d+[.)]\s+)/, ''));
      const replaced = lines.join('\n');
      return { text: v.slice(0, lineStart) + replaced + v.slice(Math.max(e, lineStart + (v.slice(lineStart, e) ? block.length : 0))), from: lineStart, to: lineStart + replaced.length };
    };
    const r =
      kind === 'bold' ? wrap('**') : kind === 'italic' ? wrap('*') : kind === 'code' ? wrap('`', '`', 'kode')
        : kind === 'ul' ? linePrefix(() => '- ') : kind === 'ol' ? linePrefix((i) => `${i + 1}. `) : linePrefix(() => '## ');
    this.value.set(r.text);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(r.from, r.to);
    });
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.copied.set(false);
    }
  }
}
