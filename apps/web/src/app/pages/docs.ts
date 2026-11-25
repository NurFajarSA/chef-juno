import { Component, ElementRef, computed, effect, inject, input, viewChild } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { Marked, type Tokens } from 'marked';
import { GUIDE_PAGES, type GuidePage } from '../docs/guide-content';
import { ThemeService } from '../core/theme.service';

interface TocItem {
  id: string;
  text: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markdown docs/guide → HTML: blok mermaid jadi diagram, tautan *.md jadi rute /docs, judul diberi id untuk daftar isi. */
export function renderGuide(md: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const used = new Set<string>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      code(t: Tokens.Code) {
        if (t.lang === 'mermaid') return `<div class="diagram"><pre class="mermaid">${esc(t.text)}</pre></div>`;
        return `<pre class="code"><code>${esc(t.text)}</code></pre>`;
      },
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens);
        if (t.depth === 1) return `<h1>${inner}</h1>`;
        let id = slugify(t.text) || `bagian-${toc.length + 1}`;
        while (used.has(id)) id += '-x';
        used.add(id);
        if (t.depth === 2) toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
        return `<h${t.depth} id="${id}">${inner}</h${t.depth}>`;
      },
      link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens);
        const m = /^([0-9a-zA-Z_-]+)\.md(#.*)?$/.exec(t.href);
        if (m) return `<a href="/docs/${m[1] === 'README' ? '' : m[1]}${m[2] ?? ''}">${inner}</a>`;
        // file di luar panduan (mis. ../SETUP.md) tidak tersedia di dashboard → teks biasa
        if (t.href.startsWith('../') || t.href.startsWith('/')) return `<span class="ext-doc">${inner}</span>`;
        return `<a href="${esc(t.href)}" target="_blank" rel="noopener">${inner}</a>`;
      },
      table(this: { parser: unknown }, t: Tokens.Table) {
        // bungkus tabel supaya bisa digulir di layar sempit
        const head = `<tr>${t.header.map((c) => `<th>${(this.parser as { parseInline(x: Tokens.Generic[]): string }).parseInline(c.tokens)}</th>`).join('')}</tr>`;
        const rows = t.rows
          .map((r) => `<tr>${r.map((c) => `<td>${(this.parser as { parseInline(x: Tokens.Generic[]): string }).parseInline(c.tokens)}</td>`).join('')}</tr>`)
          .join('');
        return `<div class="tbl"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  return { html, toc };
}

/**
 * Panduan (docs/guide) di dashboard, gaya dokumentasi: daftar halaman di kiri, isi di tengah, "Di halaman ini" di kanan.
 * Diagram mermaid dimuat lazy (hanya di halaman ini) dan mengikuti tema terang/gelap.
 */
@Component({
  selector: 'cj-docs',
  imports: [RouterLink],
  template: `
    <div class="docs">
      <nav class="pages" aria-label="Halaman panduan">
        <p class="label">Panduan</p>
        @for (p of pages; track p.slug) {
          <a [routerLink]="p.slug === 'index' ? '/docs' : ['/docs', p.slug]" [class.on]="p.slug === page().slug" [attr.aria-current]="p.slug === page().slug ? 'page' : null">{{ p.title }}</a>
        }
      </nav>

      <article class="content" #content [innerHTML]="html()" (click)="onClick($event)" data-testid="docs-content"></article>

      @if (rendered().toc.length) {
        <aside class="toc" aria-label="Di halaman ini">
          <p class="label">Di halaman ini</p>
          @for (t of rendered().toc; track t.id) {<a [href]="'#' + t.id" (click)="jump($event, t.id)">{{ t.text }}</a>}
        </aside>
      }
    </div>
  `,
  styles: `
    :host { display: block; padding: 24px 24px 96px 72px; }
    .docs { display: grid; grid-template-columns: 220px minmax(0, 1fr) 200px; gap: 40px; max-width: 1320px; }
    .pages, .toc { position: sticky; top: 88px; align-self: start; max-height: calc(100vh - 110px); overflow: auto; display: flex; flex-direction: column; gap: 2px; }
    .label { font: var(--mat-sys-label-small); letter-spacing: .08em; text-transform: uppercase; color: var(--mat-sys-on-surface-variant); margin: 0 0 8px; }
    .pages a, .toc a { text-decoration: none; color: var(--mat-sys-on-surface); padding: 6px 12px; border-radius: 10px; font: var(--mat-sys-body-medium); }
    .pages a:hover, .toc a:hover { background: var(--mat-sys-surface-container-high); }
    .pages a.on { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font-weight: 600; }
    .toc a { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); padding: 4px 10px; }
    .content { min-width: 0; background: var(--mat-sys-surface); border-radius: 28px; padding: 36px 44px 44px; font: var(--mat-sys-body-large); line-height: 1.7; }
    .content ::ng-deep h1 { font: var(--mat-sys-display-small); font-size: 34px; letter-spacing: -0.4px; margin: 0 0 16px; }
    .content ::ng-deep h2 { font: var(--mat-sys-headline-small); margin: 40px 0 12px; padding-top: 8px; scroll-margin-top: 90px; }
    .content ::ng-deep h3 { font: var(--mat-sys-title-medium); margin: 28px 0 8px; scroll-margin-top: 90px; }
    .content ::ng-deep p, .content ::ng-deep li { max-width: 76ch; }
    .content ::ng-deep a { color: var(--mat-sys-primary); }
    .content ::ng-deep code { font-family: 'Google Sans Code Variable', monospace; font-size: .88em; background: var(--mat-sys-surface-container-high); padding: 1px 6px; border-radius: 6px; }
    .content ::ng-deep pre.code { background: var(--mat-sys-surface-container); border-radius: 14px; padding: 14px 18px; overflow-x: auto; font-size: 13px; line-height: 1.55; }
    .content ::ng-deep pre.code code { background: none; padding: 0; }
    .content ::ng-deep .tbl { overflow-x: auto; margin: 12px 0 20px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 14px; }
    .content ::ng-deep table { border-collapse: collapse; width: 100%; font: var(--mat-sys-body-medium); }
    .content ::ng-deep th, .content ::ng-deep td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--mat-sys-outline-variant); vertical-align: top; }
    .content ::ng-deep th { background: var(--mat-sys-surface-container); font-weight: 600; }
    .content ::ng-deep tr:last-child td { border-bottom: 0; }
    .content ::ng-deep blockquote { margin: 12px 0; padding: 10px 16px; border-left: 3px solid var(--mat-sys-tertiary); background: var(--mat-sys-surface-container-low); border-radius: 0 12px 12px 0; }
    .content ::ng-deep .diagram { margin: 16px 0 24px; padding: 20px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 18px; overflow-x: auto; background: var(--mat-sys-surface-container-lowest); }
    /* safe center: kalau diagram lebih lebar dari kolom, mulai dari kiri supaya bisa digulir penuh */
    .content ::ng-deep pre.mermaid { margin: 0; display: flex; justify-content: safe center; background: none; font-size: 13px; }
    /* jangan biarkan flex menyusutkan SVG (lebar menyusut, tinggi tetap → ruang kosong) */
    .content ::ng-deep pre.mermaid > svg { flex-shrink: 0; }
    .content ::ng-deep pre.mermaid:not([data-processed]) { color: transparent; min-height: 120px; }
    .content ::ng-deep .ext-doc { font-family: 'Google Sans Code Variable', monospace; font-size: .9em; }
    @media (max-width: 1240px) { .docs { grid-template-columns: 220px minmax(0, 1fr); } .toc { display: none; } }
    @media (max-width: 900px) {
      :host { padding: 12px 12px 96px; }
      .docs { grid-template-columns: 1fr; gap: 12px; }
      .pages { position: static; flex-direction: row; flex-wrap: wrap; max-height: none; }
      .pages .label { width: 100%; }
      .content { padding: 20px; border-radius: 20px; }
    }
  `,
})
export class DocsPage {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  /** /docs/:slug (kosong = halaman indeks) */
  readonly slug = input<string>('');
  protected readonly pages = GUIDE_PAGES;
  protected readonly page = computed<GuidePage>(() => GUIDE_PAGES.find((p) => p.slug === (this.slug() || 'index')) ?? GUIDE_PAGES[0]);
  protected readonly rendered = computed(() => renderGuide(this.page().md));
  // konten berasal dari docs/guide di repo (dibundel saat build), bukan input pengguna → aman dipercaya
  protected readonly html = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.rendered().html));
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');
  /** penanda render terakhir (bukan signal: ditulis dari luar effect, tidak boleh memicu effect ulang) */
  private renderSeq = 0;

  constructor() {
    effect(() => {
      this.rendered();
      const dark = this.isDark();
      const seq = ++this.renderSeq;
      queueMicrotask(() => void this.drawDiagrams(dark, seq));
    });
  }

  private isDark(): boolean {
    const mode = this.theme.mode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private async drawDiagrams(dark: boolean, seq: number) {
    const nodes = Array.from(this.content().nativeElement.querySelectorAll<HTMLElement>('pre.mermaid'));
    if (!nodes.length) return;
    const mermaid = (await import('mermaid')).default;
    if (seq !== this.renderSeq) return; // halaman/tema sudah berganti
    // simpan sumber diagram; saat tema berganti, kembalikan sumbernya supaya bisa digambar ulang
    for (const n of nodes) {
      if (!n.dataset['src']) n.dataset['src'] = n.textContent ?? '';
      else {
        n.textContent = n.dataset['src'];
        n.removeAttribute('data-processed');
      }
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      fontFamily: '"Google Sans Variable", system-ui, sans-serif',
      themeVariables: { fontSize: '14px' },
      // diagram sequence: aktor ramping & teks 13px supaya tetap terbaca saat diperkecil selebar kolom
      sequence: { useMaxWidth: true, wrap: true, width: 100, actorMargin: 22, messageMargin: 32, messageFontSize: 13, actorFontSize: 13, noteFontSize: 12 },
      flowchart: { useMaxWidth: true, htmlLabels: true },
      state: { useMaxWidth: true },
    });
    await mermaid.run({ nodes, suppressErrors: true });
  }

  protected onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (href.startsWith('/docs')) {
      e.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  protected jump(e: MouseEvent, id: string) {
    e.preventDefault();
    this.content().nativeElement.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
