import { Component, computed, effect, input, output, signal } from '@angular/core';

export interface MapNode {
  id: string;
  label: string;
}
export interface MapEdge {
  from: string;
  to: string;
}

const BW = 170;
const BH = 44;
const GX = 28;
const GY = 64;
/** maksimal kotak per baris; lapisan yang lebih ramai turun ke baris berikutnya */
const PER_ROW = 6;
/** di atas jumlah ini, peta dimulai dari tampilan area (modul dikelompokkan) */
export const MAX_FLAT = 16;
/** area test bergantung ke hampir semua modul — panahnya tidak digambar di peta bertingkat */
const TEST_AREAS = new Set(['test', 'tests', 'integration_test', '__tests__', 'spec', 'e2e']);
/** di atas jumlah panah ini, panah dibuat samar dan hanya yang disorot yang tegas */
const DENSE_EDGES = 40;

/**
 * Area sebuah modul: folder induk modul fitur (`lib/app/modules/quiz` → `lib/app/modules`), selain itu dua tingkat
 * pertama (`lib/domain/entities` → `lib/domain`, `src/api` → `src`), atau satu tingkat untuk modul level atas.
 */
export function groupOf(id: string): string {
  const parts = id.split('/');
  const feat = parts.findIndex((p) => ['modules', 'features', 'feature', 'screens', 'pages'].includes(p));
  if (feat >= 0 && feat < parts.length - 1) return parts.slice(0, feat + 1).join('/');
  if (parts.length >= 3) return parts.slice(0, 2).join('/');
  return parts[0];
}

export interface ViewNode {
  id: string;
  label: string;
  /** null = modul; angka = area berisi n modul */
  count: number | null;
}
export interface ViewEdge {
  from: string;
  to: string;
  /** jumlah dependensi modul yang digabung dalam panah ini */
  weight: number;
}

/**
 * Tampilan peta: repo kecil → semua modul; repo besar → area (digabung), dan area `expanded` dibuka menjadi modulnya.
 * Panah antar-area digabung (weight = jumlah dependensi modul).
 */
export function buildView(nodes: MapNode[], edges: MapEdge[], expanded: string | null): { nodes: ViewNode[]; edges: ViewEdge[]; grouped: boolean } {
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  if (nodes.length <= MAX_FLAT)
    return { nodes: nodes.map((n) => ({ ...n, count: null })), edges: valid.map((e) => ({ ...e, weight: 1 })), grouped: false };
  const groups = new Map<string, MapNode[]>();
  for (const n of nodes) groups.set(groupOf(n.id), [...(groups.get(groupOf(n.id)) ?? []), n]);
  // area berisi satu modul tampil sebagai modul itu sendiri
  const key = (id: string) => {
    const g = groupOf(id);
    return g === expanded || (groups.get(g)?.length ?? 0) === 1 ? id : `area:${g}`;
  };
  const vnodes = new Map<string, ViewNode>();
  for (const [g, ms] of groups) {
    if (g === expanded || ms.length === 1) for (const m of ms) vnodes.set(m.id, { ...m, count: null });
    else vnodes.set(`area:${g}`, { id: `area:${g}`, label: g, count: ms.length });
  }
  const agg = new Map<string, ViewEdge>();
  for (const e of valid) {
    if (TEST_AREAS.has(groupOf(e.from).split('/')[0])) continue;
    const from = key(e.from);
    const to = key(e.to);
    if (from === to) continue;
    const k = `${from}→${to}`;
    const cur = agg.get(k);
    if (cur) cur.weight++;
    else agg.set(k, { from, to, weight: 1 });
  }
  return { nodes: [...vnodes.values()], edges: [...agg.values()], grouped: true };
}

/**
 * Peta sistem berlapis (kotak + panah, gaya "System map" Greptile): modul yang bergantung pada modul lain berada di atasnya.
 * Repo besar dimulai dari peta area; klik area untuk membuka modulnya.
 */
@Component({
  selector: 'cj-system-map',
  template: `
    @if (view().grouped) {
      <div class="bar">
        @if (expanded(); as g) {
          <button type="button" class="crumb" (click)="expanded.set(null)" data-testid="map-back">
            <span class="material-symbols-rounded" aria-hidden="true">arrow_back</span> Semua area
          </button>
          <span class="cj-muted">Area <code>{{ g }}</code> dibuka · area lain digabung{{ dense() ? ' · sorot atau pilih modul untuk melihat dependensinya' : '' }}</span>
        } @else {
          <span class="cj-muted">{{ nodes().length }} modul dikelompokkan per area. Klik area untuk melihat modulnya.</span>
        }
      </div>
    }
    <svg [attr.viewBox]="'0 0 ' + layout().w + ' ' + layout().h" [attr.width]="layout().w" role="group" aria-label="System map: dependensi antar-modul" data-testid="system-map" >
      <defs>
        <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="head" />
        </marker>
      </defs>
      @for (e of layout().edges; track e.key) {
        <!-- peta padat: hanya panah modul yang disorot/dipilih yang digambar -->
        @if (!dense() || e.hl) {
        <path [attr.d]="e.d" class="edge" [class.hl]="e.hl" [attr.stroke-width]="e.sw" marker-end="url(#sm-arrow)"><title>{{ e.title }}</title></path>
        }
      }
      @for (n of layout().nodes; track n.id) {
        <g class="node" [class.sel]="n.id === selected()" [class.area]="n.count !== null" tabindex="0" role="button"
           [attr.aria-label]="n.count !== null ? 'Area ' + n.label + ', ' + n.count + ' modul — buka' : 'Modul ' + n.label"
           [attr.data-module]="n.count === null ? n.id : null" [attr.data-area]="n.count !== null ? n.label : null"
           (click)="activate(n)" (keydown.enter)="activate(n)"
           (mouseenter)="hover.set(n.id)" (mouseleave)="hover.set(null)" (focus)="hover.set(n.id)" (blur)="hover.set(null)">
          <rect [attr.x]="n.x" [attr.y]="n.y" [attr.width]="BW" [attr.height]="BH" rx="10" />
          <text [attr.x]="n.x + BW / 2" [attr.y]="n.y + (n.count !== null ? 19 : BH / 2 + 4)" text-anchor="middle">{{ short(n.label) }}</text>
          @if (n.count !== null) {
            <text [attr.x]="n.x + BW / 2" [attr.y]="n.y + 35" text-anchor="middle" class="sub">{{ n.count }} modul</text>
          }
        </g>
      }
    </svg>
  `,
  styles: `
    :host { display: block; overflow-x: auto; }
    svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; font: var(--mat-sys-body-small); }
    .crumb { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 999px; padding: 4px 12px 4px 8px; cursor: pointer;
      background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); font: var(--mat-sys-label-large); }
    .crumb .material-symbols-rounded { font-size: 18px; }
    .edge { fill: none; stroke: var(--mat-sys-outline); opacity: .7; }
    .edge.hl { stroke: var(--mat-sys-primary); opacity: 1; }
    .head { fill: var(--mat-sys-outline); }
    .node { cursor: pointer; outline: none; }
    .node rect { fill: var(--mat-sys-surface); stroke: var(--mat-sys-outline-variant); }
    .node.area rect { fill: var(--mat-sys-surface-container-high); stroke: var(--mat-sys-outline); stroke-dasharray: 4 3; }
    .node:hover rect, .node:focus-visible rect { stroke: var(--mat-sys-primary); stroke-width: 2; }
    .node.sel rect { fill: var(--mat-sys-primary-container); stroke: var(--mat-sys-primary); }
    text { fill: var(--mat-sys-on-surface); font: var(--mat-sys-label-medium); }
    text.sub { fill: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-small); }
  `,
})
export class CjSystemMap {
  readonly nodes = input.required<MapNode[]>();
  readonly edges = input.required<MapEdge[]>();
  readonly selected = input<string | null>(null);
  readonly select = output<string>();
  protected readonly BW = BW;
  protected readonly BH = BH;
  /** area yang sedang dibuka (repo besar) */
  protected readonly expanded = signal<string | null>(null);
  /** kotak yang sedang disorot (hover/fokus) → panahnya ditegaskan */
  protected readonly hover = signal<string | null>(null);
  /** banyak panah → hanya yang disorot yang tampil */
  protected readonly dense = computed(() => this.view().edges.length > DENSE_EDGES);
  protected short = (s: string) => (s.length > 22 ? '…' + s.slice(-21) : s);

  constructor() {
    // halaman modul dibuka langsung → area modul itu ikut terbuka di peta
    effect(() => {
      const sel = this.selected();
      if (sel && this.nodes().length > MAX_FLAT) this.expanded.set(groupOf(sel));
    });
  }

  protected readonly view = computed(() => buildView(this.nodes(), this.edges(), this.expanded()));

  protected activate(n: ViewNode) {
    if (n.count !== null) this.expanded.set(n.label);
    else this.select.emit(n.id);
  }

  protected readonly layout = computed(() => {
    const { nodes, edges } = this.view();
    const ids = nodes.map((n) => n.id);
    const layer = new Map<string, number>(ids.map((id) => [id, 0]));
    // jalur terpanjang (dibatasi jumlah node untuk menghindari siklus tak hingga)
    for (let k = 0; k < ids.length; k++) {
      let changed = false;
      for (const e of edges) {
        const want = (layer.get(e.from) ?? 0) + 1;
        if (want > (layer.get(e.to) ?? 0) && want < ids.length) {
          layer.set(e.to, want);
          changed = true;
        }
      }
      if (!changed) break;
    }
    // lapisan → baris; lapisan ramai dipecah per PER_ROW kotak
    const rows: string[][] = [];
    for (const l of [...new Set(layer.values())].sort((a, b) => a - b)) {
      const inLayer = ids.filter((id) => layer.get(id) === l);
      for (let i = 0; i < inLayer.length; i += PER_ROW) rows.push(inLayer.slice(i, i + PER_ROW));
    }
    const maxRow = Math.max(1, ...rows.map((r) => r.length));
    const w = Math.max(640, maxRow * (BW + GX) + GX);
    const pos = new Map<string, { x: number; y: number }>();
    rows.forEach((rowIds, r) => {
      const rowW = rowIds.length * BW + (rowIds.length - 1) * GX;
      rowIds.forEach((id, i) => pos.set(id, { x: (w - rowW) / 2 + i * (BW + GX), y: 20 + r * (BH + GY) }));
    });
    const h = 40 + rows.length * (BH + GY) - GY;
    const sel = this.selected();
    const hov = this.hover();
    const label = new Map(nodes.map((n) => [n.id, n.label]));
    return {
      w,
      h,
      nodes: nodes.map((n) => ({ ...n, ...pos.get(n.id)! })),
      edges: edges.map((e) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const x1 = a.x + BW / 2;
        const x2 = b.x + BW / 2;
        let d: string;
        if (b.y === a.y) {
          // baris yang sama: melengkung di atas kotak (bukan menyusuri baris)
          const lift = Math.min(GY - 8, 18 + Math.abs(x2 - x1) / 8);
          d = `M${x1},${a.y} C${x1},${a.y - lift} ${x2},${b.y - lift} ${x2},${b.y - 2}`;
        } else {
          // ke bawah bila target di baris lebih bawah, ke atas bila sebaliknya (siklus)
          const down = b.y > a.y;
          const y1 = down ? a.y + BH : a.y;
          const y2 = down ? b.y - 2 : b.y + BH + 2;
          const my = (y1 + y2) / 2;
          d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
        }
        return {
          key: `${e.from}→${e.to}`,
          d,
          hl: sel === e.from || sel === e.to || hov === e.from || hov === e.to,
          sw: Math.min(5, 1.2 + Math.log2(e.weight)),
          title: `${label.get(e.from)} → ${label.get(e.to)}${e.weight > 1 ? ` (${e.weight} dependensi)` : ''}`,
        };
      }),
    };
  });
}
