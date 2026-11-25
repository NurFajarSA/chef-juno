import { Component, computed, input, signal } from '@angular/core';

export interface Series {
  key: string;
  label: string;
  /** warna lewat token M3, mis. 'var(--mat-sys-primary)' */
  color: string;
  values: number[];
}

const fmtDay = (d: string) => new Date(d + 'T00:00:00+07:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const W = 520;
const H = 200;
const L = 36;
const B = 26;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Navigasi keyboard tooltip: panah kiri/kanan, Home/End, Escape. */
function moveHover(e: KeyboardEvent, n: number, hover: { (): number | null; set(v: number | null): void }) {
  const cur = hover();
  const next =
    e.key === 'ArrowRight' ? Math.min(n - 1, (cur ?? -1) + 1)
    : e.key === 'ArrowLeft' ? Math.max(0, (cur ?? n) - 1)
    : e.key === 'Home' ? 0
    : e.key === 'End' ? n - 1
    : e.key === 'Escape' ? null
    : undefined;
  if (next === undefined) return;
  e.preventDefault();
  hover.set(next);
}

/** Grafik batang harian (bisa bertumpuk). SVG, warna via token M3, tooltip saat hover/klik/sentuh dan lewat keyboard. */
@Component({
  selector: 'cj-bar-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel() + ' — geser atau pakai panah kiri/kanan untuk melihat nilai'" tabindex="0"
         (keydown)="key($event, days().length)" (pointerleave)="hover.set(null)" (blur)="hover.set(null)">
      @for (t of ticks(); track t) {
        <line [attr.x1]="L" [attr.x2]="W" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
        <text [attr.x]="L - 6" [attr.y]="y(t) + 4" text-anchor="end" class="axis">{{ fmt()(t) }}</text>
      }
      @if (hover() !== null) {<rect class="band" [attr.x]="colX(hover()!)" [attr.width]="step()" y="6" [attr.height]="H - B - 6" rx="6" />}
      @for (b of bars(); track b.i) {
        @for (s of b.stack; track s.key) {
          <rect [attr.x]="b.x" [attr.width]="bw()" [attr.y]="s.y" [attr.height]="s.h" [attr.fill]="s.color" rx="2" />
        }
      }
      @for (b of bars(); track b.i) {
        <rect class="hit" [attr.x]="colX(b.i)" [attr.width]="step()" y="0" [attr.height]="H - B" (pointerenter)="hover.set(b.i)" (click)="hover.set(b.i)" />
      }
      @for (x of xLabels(); track x.i) {
        <text [attr.x]="x.x" [attr.y]="H - 6" text-anchor="middle" class="axis">{{ x.label }}</text>
      }
    </svg>
    @if (tip(); as t) {
      <div class="tip" [class.left]="t.pct > 75" [class.right]="t.pct < 20" [style.left.%]="t.pct" role="status" data-testid="chart-tip">
        <b>{{ t.day }}</b>
        @for (r of t.rows; track r.label) {<div class="r"><span><i [style.background]="r.color"></i>{{ r.label }}</span><strong>{{ fmt()(r.v) }}</strong></div>}
        @if (t.rows.length > 1) {<div class="r tot"><span>Total</span><strong>{{ fmt()(t.total) }}</strong></div>}
      </div>
    }
    @if (series().length > 1) {
      <div class="legend">@for (s of series(); track s.key) {<span><i [style.background]="s.color"></i>{{ s.label }}</span>}</div>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    svg { width: 100%; height: auto; display: block; outline: none; touch-action: pan-y; }
    svg:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 4px; border-radius: 8px; }
    .hit { fill: transparent; cursor: crosshair; }
    .band { fill: var(--mat-sys-on-surface); opacity: .06; pointer-events: none; }
    .tip { position: absolute; top: 0; transform: translate(-50%, 0); pointer-events: none; z-index: 2; min-width: 120px;
      background: var(--mat-sys-inverse-surface); color: var(--mat-sys-inverse-on-surface); border-radius: 12px; padding: 8px 12px;
      font: var(--mat-sys-label-medium); box-shadow: 0 4px 12px rgb(0 0 0 / .2); white-space: nowrap; }
    .tip.left { transform: translate(-100%, 0); } .tip.right { transform: translate(0, 0); }
    .tip b { display: block; font: var(--mat-sys-label-large); margin-bottom: 4px; }
    .tip .r { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
    .tip .r span { display: inline-flex; align-items: center; gap: 6px; }
    .tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
    .tip .tot { border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); margin-top: 4px; padding-top: 4px; }
    .grid { stroke: var(--mat-sys-outline-variant); }
    .axis { fill: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-small); }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font: var(--mat-sys-label-medium); color: var(--mat-sys-on-surface-variant); margin-top: 4px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  `,
})
export class CjBarChart {
  readonly days = input.required<string[]>();
  readonly series = input.required<Series[]>();
  readonly ariaLabel = input('Grafik batang harian');
  /** format angka sumbu & tooltip (mis. "12 rb" untuk token) */
  readonly fmt = input<(v: number) => string>((v) => String(Math.round(v * 10) / 10));
  protected readonly W = W;
  protected readonly H = H;
  protected readonly L = L;
  protected readonly B = B;
  private readonly max = computed(() => niceMax(Math.max(0, ...this.days().map((_, i) => this.series().reduce((a, s) => a + (s.values[i] ?? 0), 0)))));
  protected readonly ticks = computed(() => [0, this.max() / 2, this.max()].map((t) => Math.round(t * 10) / 10));
  protected y = (v: number) => H - B - (v / this.max()) * (H - B - 10);
  protected readonly step = computed(() => (W - L - 4) / Math.max(1, this.days().length));
  protected readonly hover = signal<number | null>(null);
  protected colX = (i: number) => L + 2 + i * this.step();
  protected key = (e: KeyboardEvent, n: number) => moveHover(e, n, this.hover);
  protected readonly tip = computed(() => {
    const i = this.hover();
    if (i === null || !this.days()[i]) return null;
    const rows = this.series().map((s) => ({ label: s.label, color: s.color, v: s.values[i] ?? 0 }));
    return { day: fmtDay(this.days()[i]), rows, total: rows.reduce((a, r) => a + r.v, 0), pct: ((this.colX(i) + this.step() / 2) / W) * 100 };
  });
  protected readonly bw = computed(() => Math.max(2, Math.min(22, this.step() * 0.7)));
  protected readonly bars = computed(() =>
    this.days().map((day, i) => {
      let acc = 0;
      const stack = this.series()
        .filter((s) => (s.values[i] ?? 0) > 0)
        .map((s) => {
          const v = s.values[i];
          const y1 = this.y(acc + v);
          const y0 = this.y(acc);
          acc += v;
          return { key: s.key, label: s.label, color: s.color, v, y: y1, h: Math.max(0, y0 - y1) };
        });
      return { i, day: fmtDay(day), x: L + 2 + i * this.step() + (this.step() - this.bw()) / 2, stack };
    }),
  );
  protected readonly xLabels = computed(() => {
    const n = this.days().length;
    const every = Math.max(1, Math.ceil(n / 6));
    return this.days()
      .map((d, i) => ({ i, label: fmtDay(d), x: L + 2 + i * this.step() + this.step() / 2 }))
      .filter((x) => x.i % every === 0 || (x.i === n - 1 && (n - 1) % every >= Math.ceil(every / 2)));
  });
}

/** Grafik garis harian + garis rata-rata putus-putus. Nilai null = tidak ada data hari itu. */
@Component({
  selector: 'cj-line-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="ariaLabel() + ' — geser atau pakai panah kiri/kanan untuk melihat nilai'" tabindex="0"
         (keydown)="key($event, days().length)" (pointerleave)="hover.set(null)" (blur)="hover.set(null)">
      @for (t of ticks(); track t) {
        <line [attr.x1]="L" [attr.x2]="W" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
        <text [attr.x]="L - 6" [attr.y]="y(t) + 4" text-anchor="end" class="axis">{{ fmt()(t) }}</text>
      }
      @if (hover() !== null) {<line class="cursor" [attr.x1]="cx(hover()!)" [attr.x2]="cx(hover()!)" y1="6" [attr.y2]="H - B" />}
      @if (area()) {<path [attr.d]="area()" [attr.fill]="color()" opacity="0.12" />}
      <path [attr.d]="path()" fill="none" [attr.stroke]="color()" stroke-width="2.5" stroke-linejoin="round" />
      @for (p of points(); track p.i) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.i === hover() ? 6 : 3" [attr.fill]="color()" [attr.stroke]="p.i === hover() ? 'var(--mat-sys-surface)' : null" stroke-width="2" />
      }
      @if (avg() !== null) {
        <line [attr.x1]="L" [attr.x2]="W" [attr.y1]="y(avg()!)" [attr.y2]="y(avg()!)" class="avg" />
        <text [attr.x]="W - 4" [attr.y]="y(avg()!) - 6" text-anchor="end" class="avg-label">rata-rata {{ fmt()(avg()!) }}</text>
      }
      @for (x of xLabels(); track x.i) {
        <text [attr.x]="x.x" [attr.y]="H - 6" text-anchor="middle" class="axis">{{ x.label }}</text>
      }
      @for (d of days(); track $index) {
        <rect class="hit" [attr.x]="cx($index) - step() / 2" [attr.width]="step()" y="0" [attr.height]="H - B" (pointerenter)="hover.set($index)" (click)="hover.set($index)" />
      }
    </svg>
    @if (tip(); as t) {
      <div class="tip" [class.left]="t.pct > 75" [class.right]="t.pct < 20" [style.left.%]="t.pct" role="status" data-testid="chart-tip">
        <b>{{ t.day }}</b>
        <div class="r"><span><i [style.background]="color()"></i>{{ seriesLabel() }}</span><strong>{{ t.v }}</strong></div>
        @if (t.avg) {<div class="r tot"><span>Rata-rata periode</span><strong>{{ t.avg }}</strong></div>}
      </div>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    svg { width: 100%; height: auto; display: block; outline: none; touch-action: pan-y; }
    svg:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 4px; border-radius: 8px; }
    .hit { fill: transparent; cursor: crosshair; }
    .band { fill: var(--mat-sys-on-surface); opacity: .06; pointer-events: none; }
    .tip { position: absolute; top: 0; transform: translate(-50%, 0); pointer-events: none; z-index: 2; min-width: 120px;
      background: var(--mat-sys-inverse-surface); color: var(--mat-sys-inverse-on-surface); border-radius: 12px; padding: 8px 12px;
      font: var(--mat-sys-label-medium); box-shadow: 0 4px 12px rgb(0 0 0 / .2); white-space: nowrap; }
    .tip.left { transform: translate(-100%, 0); } .tip.right { transform: translate(0, 0); }
    .tip b { display: block; font: var(--mat-sys-label-large); margin-bottom: 4px; }
    .tip .r { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
    .tip .r span { display: inline-flex; align-items: center; gap: 6px; }
    .tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
    .tip .tot { border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); margin-top: 4px; padding-top: 4px; }
    .cursor { stroke: var(--mat-sys-outline); stroke-dasharray: 3 3; pointer-events: none; }
    .grid { stroke: var(--mat-sys-outline-variant); }
    .axis { fill: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-small); }
    .avg { stroke: var(--mat-sys-on-surface-variant); stroke-dasharray: 5 4; }
    .avg-label { fill: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-small); letter-spacing: .5px; }
  `,
})
export class CjLineChart {
  readonly days = input.required<string[]>();
  readonly values = input.required<(number | null)[]>();
  readonly color = input('var(--mat-sys-primary)');
  readonly max = input<number | null>(null);
  readonly fmt = input<(v: number) => string>((v) => String(Math.round(v * 10) / 10));
  readonly ariaLabel = input('Grafik garis harian');
  readonly seriesLabel = input('Nilai');
  protected readonly hover = signal<number | null>(null);
  protected cx = (i: number) => L + 2 + i * this.step() + this.step() / 2;
  protected key = (e: KeyboardEvent, n: number) => moveHover(e, n, this.hover);
  protected readonly tip = computed(() => {
    const i = this.hover();
    if (i === null || !this.days()[i]) return null;
    const v = this.values()[i];
    const a = this.avg();
    return { day: fmtDay(this.days()[i]), v: v == null ? 'tidak ada data' : this.fmt()(v), avg: a == null ? '' : this.fmt()(a), pct: (this.cx(i) / W) * 100 };
  });
  protected readonly W = W;
  protected readonly H = H;
  protected readonly L = L;
  protected readonly B = B;
  private readonly top = computed(() => this.max() ?? niceMax(Math.max(0, ...this.values().map((v) => v ?? 0))));
  protected readonly ticks = computed(() => [0, this.top() / 2, this.top()]);
  protected y = (v: number) => H - B - (v / this.top()) * (H - B - 10);
  protected readonly step = computed(() => (W - L - 4) / Math.max(1, this.days().length));
  protected readonly points = computed(() =>
    this.values()
      .map((v, i) => ({ i, v, day: fmtDay(this.days()[i]), x: L + 2 + i * this.step() + this.step() / 2, y: v == null ? 0 : this.y(v) }))
      .filter((p): p is { i: number; v: number; day: string; x: number; y: number } => p.v != null),
  );
  protected readonly path = computed(() => this.points().map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  protected readonly area = computed(() => {
    const ps = this.points();
    if (ps.length < 2) return '';
    return `${this.path()} L${ps.at(-1)!.x.toFixed(1)},${this.y(0)} L${ps[0].x.toFixed(1)},${this.y(0)} Z`;
  });
  protected readonly avg = computed(() => {
    const vs = this.values().filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  });
  protected readonly xLabels = computed(() => {
    const n = this.days().length;
    const every = Math.max(1, Math.ceil(n / 6));
    return this.days()
      .map((d, i) => ({ i, label: fmtDay(d), x: L + 2 + i * this.step() + this.step() / 2 }))
      .filter((x) => x.i % every === 0 || (x.i === n - 1 && (n - 1) % every >= Math.ceil(every / 2)));
  });
}
