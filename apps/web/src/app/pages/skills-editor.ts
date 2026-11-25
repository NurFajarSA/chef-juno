import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { collection, doc, getDoc, limit, orderBy, query, where } from 'firebase/firestore';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { diffLines, diffStats, sideBySide } from '@chefjuno/shared';
import { CjCodeEditor } from '../ui/code-editor';
import { CjSelect } from '../ui/select';
import { AuthService } from '../core/auth.service';
import { FirebaseService } from '../core/firebase';
import { liveQuery } from '../core/live';
import { fmtDateTime, fmtNum, fmtPct, toMs } from '../core/format';
import { miniMarkdown } from '../core/md';
import { ImportSkillsDialog } from './import-skills-dialog';

/** id file: `core/<key>.md` (prompt inti) atau `skills/<slug>/<path>` (file skill) */
type FileId = string;

interface Version {
  version: number;
  content: string;
  files: Record<string, string>;
  message: string;
  authorLogin: string;
  createdAtMs: number | null;
  parentVersion: number | null;
}

interface TreeNode {
  id: string;
  name: string;
  depth: number;
  dir: boolean;
}

const CORE_KEYS = ['persona', 'review'] as const;
const parseId = (id: FileId) => {
  if (id.startsWith('core/')) return { kind: 'core' as const, key: id.slice(5).replace(/\.md$/, ''), slug: '', path: '' };
  const [, slug, ...rest] = id.split('/');
  return { kind: 'skill' as const, key: '', slug, path: rest.join('/') };
};

/** pohon file skill: folder dulu sesuai path, SKILL.md paling atas */
function skillTree(slug: string, paths: string[]): TreeNode[] {
  const out: TreeNode[] = [];
  const dirs = new Set<string>();
  for (const p of [...paths].sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)))) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!dirs.has(d)) {
        dirs.add(d);
        out.push({ id: `skills/${slug}/${d}/`, name: parts[i - 1], depth: i, dir: true });
      }
    }
    out.push({ id: `skills/${slug}/${p}`, name: parts.at(-1)!, depth: parts.length, dir: false });
  }
  return out;
}

/**
 * Skills sebagai code editor: explorer (prompt inti + folder skill) di kiri, tab + editor bernomor baris di kanan,
 * panel Riwayat/Bandingkan, dan status bar. Prompt inti tetap berversi (simpan, aktifkan/rollback, diff, statistik).
 */
@Component({
  selector: 'cj-skills-editor',
  imports: [CjCodeEditor, CjSelect, MatButton, MatIconButton, MatSlideToggle, MatTooltip],
  host: { class: 'cj-skills-editor' },
  template: `
    <div class="ide">
      <!-- ============ Explorer ============ -->
      <aside class="explorer" aria-label="Explorer skill">
        <header class="ex-head">
          <h1>Skills</h1>
          <span class="spacer"></span>
          <button matIconButton (click)="openImport()" matTooltip="Import skills" aria-label="Import skills" data-testid="skills-import">
            <span class="material-symbols-rounded" aria-hidden="true">upload</span>
          </button>
        </header>
        <label class="ex-search">
          <span class="material-symbols-rounded" aria-hidden="true">search</span>
          <input placeholder="Cari file…" (input)="q.set($any($event.target).value)" aria-label="Cari skill" data-testid="skills-search" />
        </label>

        <nav class="tree" aria-label="File skill">
          <div class="sec">INTI · selalu dipakai</div>
          <div data-testid="skills-core">
            @for (p of core(); track p.key) {
              <button type="button" class="row file" [class.on]="active() === 'core/' + p.key + '.md'" [style.padding-left.px]="12"
                (click)="open('core/' + p.key + '.md')" [attr.data-prompt]="p.key" [attr.aria-current]="active() === 'core/' + p.key + '.md' ? 'true' : null">
                <span class="material-symbols-rounded ic core" aria-hidden="true">{{ p.key === 'persona' ? 'face' : 'checklist' }}</span>
                <span class="nm">{{ p.key }}.md</span>
                <span class="sub">{{ p.title }}</span>
                <span class="badge">v{{ p.active }}</span>
              </button>
            } @empty {
              <p class="hint">Prompt inti belum ada — buka Setup sebagai admin.</p>
            }
          </div>

          <div data-testid="skills-list">
          @for (g of skillGroups(); track g.key) {
            <div class="sec" [attr.data-testid]="'skills-group-' + g.key">{{ g.title }} · {{ g.enabled }}/{{ g.items.length }} aktif</div>
            @for (s of g.items; track s.slug) {
              <div class="row folder" [class.off]="!s.enabled" [attr.data-skill]="s.slug">
                <button type="button" class="fold" (click)="toggleFolder(s.slug)" [attr.aria-expanded]="expanded().has(s.slug)" [attr.aria-label]="'Buka skill ' + s.name">
                  <span class="material-symbols-rounded chev" aria-hidden="true">{{ expanded().has(s.slug) ? 'expand_more' : 'chevron_right' }}</span>
                  <span class="material-symbols-rounded ic" aria-hidden="true">{{ expanded().has(s.slug) ? 'folder_open' : 'folder' }}</span>
                  <span class="nm">{{ s.slug }}</span>
                  @if (s.source === 'default') {<span class="material-symbols-rounded def" matTooltip="Skill bawaan Chef Juno" aria-hidden="true">verified</span><span class="cdk-visually-hidden">bawaan</span>}
                  @if (s.paths.length) {<span class="material-symbols-rounded def scope" [matTooltip]="'Dimuat hanya bila PR mengubah: ' + s.paths.join(', ')" aria-hidden="true">filter_alt</span><span class="cdk-visually-hidden">selektif</span>}
                  @if (!s.enabled) {<span class="badge warn">{{ s.everEnabled ? 'nonaktif' : 'menunggu admin' }}</span>}
                  <span class="count">{{ s.fileCount }} file</span>
                </button>
                @if (auth.isAdmin()) {
                  <mat-slide-toggle class="tg" hideIcon [checked]="s.enabled" [disabled]="busy()" (change)="toggleSkill(s.slug, $event.checked)"
                    [aria-label]="(s.enabled ? 'Nonaktifkan' : 'Aktifkan') + ' skill ' + s.name" [attr.data-testid]="'skill-toggle-' + s.slug" />
                }
              </div>
              @if (expanded().has(s.slug)) {
                <div data-testid="skill-tree" [attr.data-tree]="s.slug">
                  @for (n of treeOf(s.slug); track n.id) {
                    @if (n.dir) {
                      <div class="row dirrow" [style.padding-left.px]="12 + n.depth * 14"><span class="material-symbols-rounded ic" aria-hidden="true">folder</span><span class="nm">{{ n.name }}</span></div>
                    } @else {
                      <button type="button" class="row file" [class.on]="active() === n.id" [style.padding-left.px]="12 + n.depth * 14" (click)="open(n.id)">
                        <span class="material-symbols-rounded ic" aria-hidden="true">{{ n.name === 'SKILL.md' ? 'star' : 'description' }}</span>
                        <span class="nm">{{ n.name }}</span>
                      </button>
                    }
                  }
                </div>
              }
            }
          } @empty {
            <p class="hint">{{ q() ? 'Tidak ada skill yang cocok.' : 'Belum ada skill tim. Import folder skill (SKILL.md), file .md, atau .zip.' }}</p>
          }
          </div>
        </nav>
      </aside>

      <!-- ============ Editor ============ -->
      <section class="main" aria-label="Editor">
        <nav class="tabs" aria-label="File terbuka">
          @for (t of tabs(); track t) {
            <div class="tab" [class.on]="t === active()">
              <button type="button" class="tab-btn" [attr.aria-current]="t === active() ? 'page' : null" (click)="activate(t)">
                <span class="material-symbols-rounded" aria-hidden="true">{{ t.startsWith('core/') ? 'edit_note' : 'description' }}</span>
                {{ label(t) }}@if (dirty(t)) {<span class="dot" aria-label="belum disimpan">●</span>}
              </button>
              <button type="button" class="tab-x" (click)="closeTab(t)" [attr.aria-label]="'Tutup ' + label(t)"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
            </div>
          }
        </nav>

        @if (active(); as id) {
          <div class="crumbs">
            <span class="path">{{ crumb(id) }}</span>
            <span class="spacer"></span>
            <button matButton type="button" (click)="preview.set(!preview())" [attr.aria-pressed]="preview()" data-testid="editor-preview">
              <span class="material-symbols-rounded" aria-hidden="true">{{ preview() ? 'visibility_off' : 'visibility' }}</span> Preview
            </button>
            <button matButton type="button" (click)="togglePanel('history')" [attr.aria-pressed]="panel() !== null" data-testid="editor-history">
              <span class="material-symbols-rounded" aria-hidden="true">history</span> Riwayat
            </button>
            @if (info().kind === 'skill' && auth.isAdmin()) {
              <button matButton type="button" (click)="deleteSkill(info().slug)" [disabled]="busy()" data-testid="skill-delete">
                <span class="material-symbols-rounded" aria-hidden="true">delete</span> Hapus skill
              </button>
            }
          </div>

          <div class="work" [class.with-panel]="panel() !== null">
            <div class="panes" [class.split]="preview()">
              <cj-code-editor [value]="draftOf(id)" (valueChange)="setDraft(id, $event)" [readonly]="readonlyFile()" (save)="startSave()"
                (cursor)="cursor.set($event)" [label]="label(id)" [testId]="info().kind === 'core' ? 'prompt-editor' : 'skill-editor'" />
              @if (preview()) {
                <div class="preview cj-prose" [innerHTML]="previewHtml()" data-testid="editor-preview-pane"></div>
              }
            </div>

            @if (panel(); as pn) {
              <aside class="panel" aria-label="Riwayat & perbandingan">
                <div class="ptabs" role="tablist">
                  <button type="button" role="tab" [attr.aria-selected]="pn === 'history'" [class.on]="pn === 'history'" (click)="panel.set('history')">Riwayat</button>
                  <button type="button" role="tab" [attr.aria-selected]="pn === 'compare'" [class.on]="pn === 'compare'" (click)="panel.set('compare')">Bandingkan</button>
                  <span class="spacer"></span>
                  <button matIconButton (click)="panel.set(null)" aria-label="Tutup panel"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
                </div>
                @if (pn === 'history') {
                  <ol class="hist" [attr.data-testid]="info().kind === 'core' ? 'prompt-history' : 'skill-history'">
                    @for (v of versions(); track v.version) {
                      <li [class.active]="v.version === activeVersion()">
                        <div class="hrow"><b>v{{ v.version }}</b>
                          @if (v.version === activeVersion()) {<span class="badge">aktif</span>}
                          <span class="msg">{{ v.message }}</span></div>
                        <div class="meta">&#64;{{ v.authorLogin }} · {{ dt(v.createdAtMs) }}</div>
                        @if (info().kind === 'core') {
                          <div class="meta">{{ stat(v.version).reviews }} review · rata-rata {{ stat(v.version).avgFindings }} temuan · diperbaiki {{ stat(v.version).addressed }} · dibantah {{ stat(v.version).disputed }}</div>
                        }
                        <div class="hacts">
                          @if (info().kind === 'core' && v.version !== activeVersion()) {
                            <button matButton="tonal" (click)="activatePrompt(v.version)" [attr.data-testid]="'activate-' + v.version">Aktifkan</button>
                          }
                          <button matButton (click)="loadVersion(v)">Muat ke editor</button>
                          <button matButton (click)="compareWith(v.version)">Bandingkan</button>
                        </div>
                      </li>
                    }
                  </ol>
                } @else {
                  <div class="pick">
                    <cj-select label="Versi kiri" [options]="versionOpts()" [value]="left()" (valueChange)="left.set($event)" testId="diff-left" />
                    <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span>
                    <cj-select label="Versi kanan" [options]="versionOpts()" [value]="right()" (valueChange)="right.set($event)" testId="diff-right" />
                    <span class="add-n">+{{ diffSummary().added }}</span><span class="del-n">−{{ diffSummary().removed }}</span>
                  </div>
                  <div class="diff" data-testid="prompt-diff" role="table" aria-label="Perbandingan versi">
                    <div class="head">v{{ left() }}</div><div class="head">v{{ right() }}</div>
                    @for (r of rows(); track $index) {
                      <div class="cell" [class]="r.left?.type ?? 'empty'"><span class="n">{{ r.left?.n ?? '' }}</span>{{ r.left?.text ?? '' }}</div>
                      <div class="cell" [class]="r.right?.type ?? 'empty'"><span class="n">{{ r.right?.n ?? '' }}</span>{{ r.right?.text ?? '' }}</div>
                    }
                  </div>
                }
              </aside>
            }
          </div>

          @if (readonlyFile()) {
            <div class="savebar ro">File pendukung hanya-baca — ubah lewat import ulang skill.</div>
          } @else if (dirty(id) || saving()) {
            <div class="savebar">
              <input class="msg-in" placeholder="Pesan perubahan (wajib)" [value]="message()" (input)="message.set($any($event.target).value); msgError.set('')"
                (keydown.enter)="startSave()" [attr.data-testid]="info().kind === 'core' ? 'prompt-message' : 'skill-message'" aria-label="Pesan perubahan" />
              @if (info().kind === 'core') {
                <mat-slide-toggle [checked]="activateNow()" (change)="activateNow.set($event.checked)">Langsung aktifkan</mat-slide-toggle>
              }
              <button matButton (click)="discard(id)">Buang</button>
              <button matButton="filled" (click)="startSave()" [disabled]="busy()" [attr.data-testid]="info().kind === 'core' ? 'prompt-save' : 'skill-save'">Simpan versi baru</button>
              @if (msgError()) {<span class="err" role="alert">{{ msgError() }}</span>}
            </div>
          }
        } @else {
          <div class="welcome">
            <span class="material-symbols-rounded" aria-hidden="true">folder_special</span>
            <p>Pilih file di explorer. Prompt inti selalu dipakai reviewer; skill tim yang aktif ikut dimuat di setiap review.</p>
          </div>
        }

        <footer class="status" aria-label="Status editor">
          @if (active(); as id) {
            <span>Markdown</span>
            <span>Ln {{ cursor().line }}, Col {{ cursor().col }}</span>
            @if (info().kind === 'core') {
              <span data-testid="editor-status-version">aktif v{{ activeVersion() }} · terbaru v{{ latestVersion() }}</span>
            } @else {
              <span>v{{ latestVersion() }} · {{ currentSkill()?.enabled ? 'aktif — dipakai reviewer' : 'nonaktif' }}{{ currentSkill()?.source === 'default' ? ' · bawaan' : '' }}</span>
              <span data-testid="editor-status-scope">{{ currentSkill()?.paths?.length ? 'dimuat untuk: ' + currentSkill()!.paths.join(', ') : 'selalu dimuat' }}</span>
            }
            <span class="spacer"></span>
            <span>{{ dirty(id) ? '● belum disimpan' : 'tersimpan' }}</span>
          } @else {
            <span>{{ core().length }} prompt inti · {{ skills().data.length }} skill</span>
          }
        </footer>
      </section>
    </div>
  `,
  styles: `
    :host { display: block; padding: 8px 24px 24px 72px; height: calc(100vh - 72px); box-sizing: border-box; }
    .ide { display: grid; grid-template-columns: 320px minmax(0, 1fr); height: 100%; background: var(--mat-sys-surface); border-radius: 24px; overflow: hidden; }
    .spacer { flex: 1; }
    .explorer { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--mat-sys-outline-variant); background: var(--mat-sys-surface-container-low); }
    .ex-head { display: flex; align-items: center; gap: 2px; padding: 12px 8px 4px 20px; }
    h1 { font: var(--mat-sys-title-large); margin: 0; }
    .ex-search { display: flex; align-items: center; gap: 8px; margin: 4px 12px 8px; padding: 0 12px; height: 36px; border-radius: 999px; background: var(--mat-sys-surface); }
    .ex-search input { border: 0; outline: 0; background: transparent; color: inherit; font: var(--mat-sys-body-medium); flex: 1; min-width: 0; }
    .ex-search .material-symbols-rounded { font-size: 18px; color: var(--mat-sys-on-surface-variant); }
    .tree { overflow: auto; padding: 0 6px 16px; flex: 1; }
    .sec { font: var(--mat-sys-label-small); letter-spacing: .6px; color: var(--mat-sys-on-surface-variant); padding: 14px 12px 6px; }
    .row { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px; border: 0; background: transparent; color: inherit; text-align: left;
      font: var(--mat-sys-body-medium); border-radius: 8px; padding: 2px 8px 2px 12px; box-sizing: border-box; cursor: pointer; }
    .row:hover { background: var(--mat-sys-surface-container-high); }
    .row.on { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .row .nm { font-family: 'Google Sans Code Variable', monospace; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .sub { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .ic { font-size: 18px; color: var(--mat-sys-on-surface-variant); flex: none; }
    .ic.core { color: var(--mat-sys-primary); }
    .folder { padding: 0 4px 0 0; cursor: default; }
    .fold { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; padding: 4px 4px 4px 4px; cursor: pointer; text-align: left; }
    .def { font-size: 16px; color: var(--mat-sys-primary); flex: none; }
    .def.scope { color: var(--mat-sys-on-surface-variant); }
    .chev { font-size: 18px; color: var(--mat-sys-on-surface-variant); }
    .count { margin-left: auto; padding-left: 6px; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-small); white-space: nowrap; }
    .tg { transform: scale(.72); transform-origin: right center; margin-left: -6px; }
    .folder.off .nm, .folder.off .ic { opacity: .5; }
    .dirrow { cursor: default; color: var(--mat-sys-on-surface-variant); }
    .dirrow:hover { background: transparent; }
    .badge { font: var(--mat-sys-label-small); padding: 1px 6px; border-radius: 6px; background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); white-space: nowrap; }
    .badge.soft { background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface-variant); }
    .badge.warn { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .hint { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); padding: 4px 12px; margin: 0; }

    .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--mat-sys-outline-variant); background: var(--mat-sys-surface-container-low); min-height: 44px; }
    .tab { display: flex; align-items: center; border-right: 1px solid var(--mat-sys-outline-variant); }
    .tab.on { background: var(--mat-sys-surface); box-shadow: inset 0 -2px 0 var(--mat-sys-primary); }
    .tab-btn { display: flex; align-items: center; gap: 6px; border: 0; background: transparent; color: inherit; font: var(--mat-sys-body-medium); padding: 0 6px 0 14px; height: 44px; cursor: pointer; white-space: nowrap; }
    .tab-btn .material-symbols-rounded { font-size: 16px; color: var(--mat-sys-on-surface-variant); }
    .dot { color: var(--mat-sys-primary); margin-left: 4px; }
    .tab-x { border: 0; background: transparent; color: var(--mat-sys-on-surface-variant); width: 28px; height: 28px; border-radius: 6px; margin-right: 6px; display: grid; place-items: center; cursor: pointer; }
    .tab-x:hover { background: var(--mat-sys-surface-container-high); }
    .tab-x .material-symbols-rounded { font-size: 16px; }
    .crumbs { display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 16px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .path { font-family: 'Google Sans Code Variable', monospace; font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .work { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
    .work.with-panel { grid-template-columns: minmax(0, 1fr) 380px; }
    .panes { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
    .panes.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .preview { overflow: auto; padding: 16px 24px; border-left: 1px solid var(--mat-sys-outline-variant); font: var(--mat-sys-body-medium); }
    .panel { border-left: 1px solid var(--mat-sys-outline-variant); overflow: auto; min-height: 0; background: var(--mat-sys-surface-container-low); }
    .ptabs { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 12px; position: sticky; top: 0; background: inherit; z-index: 1; }
    .ptabs button[role='tab'] { border: 0; background: transparent; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-label-large); padding: 8px 14px; border-radius: 999px; cursor: pointer; }
    .ptabs button.on { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .hist { list-style: none; margin: 0; padding: 0 12px 12px; display: grid; gap: 8px; }
    .hist li { background: var(--mat-sys-surface); border-radius: 14px; padding: 10px 12px; }
    .hist li.active { box-shadow: inset 3px 0 0 var(--mat-sys-primary); }
    .hrow { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .msg { color: var(--mat-sys-on-surface-variant); }
    .meta { font: var(--mat-sys-body-small); color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
    .hacts { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .pick { display: flex; align-items: center; gap: 6px; padding: 0 12px 8px; flex-wrap: wrap; }
    .add-n { color: var(--mat-sys-primary); font: var(--mat-sys-label-large); } .del-n { color: var(--mat-sys-error); font: var(--mat-sys-label-large); }
    .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 0 6px; padding: 0 12px 12px; font-family: 'Google Sans Code Variable', monospace; font-size: 11px; }
    .head { font: var(--mat-sys-title-small); padding: 4px 6px; background: var(--mat-sys-surface-container-high); border-radius: 8px 8px 0 0; }
    .cell { white-space: pre-wrap; word-break: break-word; padding: 1px 6px; min-height: 16px; }
    .n { display: inline-block; width: 26px; color: var(--mat-sys-on-surface-variant); user-select: none; }
    .del { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .add { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .empty { background: var(--mat-sys-surface-container); }
    .savebar { display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 16px; border-top: 1px solid var(--mat-sys-outline-variant); flex-wrap: wrap; }
    .savebar.ro { color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); }
    .msg-in { flex: 1; min-width: 220px; height: 38px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 999px; padding: 0 16px; background: var(--mat-sys-surface);
      color: inherit; font: var(--mat-sys-body-medium); outline: 0; }
    .msg-in:focus-visible { border-color: var(--mat-sys-primary); box-shadow: 0 0 0 1px var(--mat-sys-primary); }
    .err { color: var(--mat-sys-error); font: var(--mat-sys-body-small); width: 100%; }
    .welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; color: var(--mat-sys-on-surface-variant); padding: 24px; }
    .welcome .material-symbols-rounded { font-size: 48px; color: var(--mat-sys-primary); }
    .status { display: flex; gap: 18px; align-items: center; padding: 4px 16px; min-height: 28px; font: var(--mat-sys-label-small); color: var(--mat-sys-on-surface-variant);
      border-top: 1px solid var(--mat-sys-outline-variant); background: var(--mat-sys-surface-container-low); }
    @media (max-width: 1100px) { :host { padding: 8px 16px 16px; } .work.with-panel { grid-template-columns: minmax(0, 1fr); } .panel { max-height: 50vh; } }
    @media (max-width: 800px) {
      :host { height: auto; padding: 8px 12px 96px; }
      .ide { grid-template-columns: 1fr; height: auto; }
      .explorer { border-right: 0; border-bottom: 1px solid var(--mat-sys-outline-variant); max-height: 45vh; }
      .main { min-height: 70vh; } .panes.split { grid-template-columns: 1fr; }
    }
  `,
})
export class SkillsEditorPage {
  private readonly fb = inject(FirebaseService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  /** query param ?f=<fileId> */
  readonly f = input<string>('');

  protected readonly q = signal('');
  protected readonly busy = signal(false);
  protected readonly saving = signal(false);
  protected readonly tabs = signal<FileId[]>([]);
  protected readonly active = signal<FileId | null>(null);
  protected readonly expanded = signal(new Set<string>());
  protected readonly drafts = signal<Record<FileId, string>>({});
  protected readonly preview = signal(false);
  protected readonly panel = signal<'history' | 'compare' | null>(null);
  protected readonly cursor = signal({ line: 1, col: 1 });
  protected readonly message = signal('');
  protected readonly msgError = signal('');
  protected readonly activateNow = signal(false);
  protected readonly left = signal(1);
  protected readonly right = signal(1);
  /** versi dasar yang dimuat ke editor per file (untuk "Muat ke editor") */
  private readonly baseVersion = signal<Record<FileId, number>>({});

  protected readonly prompts = liveQuery(() => collection(this.fb.db, 'prompts'), (key, d) => ({
    key,
    title: String(d['title'] ?? key),
    active: Number(d['activeVersion'] ?? 1),
    latest: Number(d['latestVersion'] ?? 1),
  }));
  protected readonly core = computed(() => CORE_KEYS.map((k) => this.prompts().data.find((p) => p.key === k)).filter((p): p is NonNullable<typeof p> => !!p));
  protected readonly skills = liveQuery(() => query(collection(this.fb.db, 'skills'), orderBy('name')), (slug, d) => ({
    slug,
    name: String(d['name'] ?? slug),
    description: String(d['description'] ?? ''),
    enabled: d['enabled'] === true,
    everEnabled: d['everEnabled'] === true || d['enabled'] === true,
    source: String(d['source'] ?? 'import'),
    fileCount: Number(d['fileCount'] ?? 1),
    latest: Number(d['latestVersion'] ?? 1),
    paths: (Array.isArray(d['paths']) ? d['paths'] : []) as string[],
    category: (d['category'] === 'inti' || d['category'] === 'domain' ? d['category'] : null) as 'inti' | 'domain' | null,
  }));
  /** skill dikelompokkan: inti (prinsip) → domain (referensi teknis) → lainnya (belum dikategorikan) */
  protected readonly skillGroups = computed(() => {
    const list = this.filteredSkills();
    return [
      { key: 'inti', title: 'SKILL INTI · prinsip, selalu dipakai', items: list.filter((s) => s.category === 'inti') },
      { key: 'domain', title: 'SKILL DOMAIN · referensi teknis', items: list.filter((s) => s.category === 'domain') },
      { key: 'lain', title: 'SKILL LAINNYA', items: list.filter((s) => s.category === null) },
    ]
      .filter((g) => g.items.length)
      .map((g) => ({ ...g, enabled: g.items.filter((s) => s.enabled).length }));
  });
  /** dikelompokkan per kategori; masing-masing urut slug */
  protected readonly filteredSkills = computed(() => {
    const q = this.q().trim().toLowerCase();
    const list = [...this.skills().data].sort((a, b) => (a.source === 'default') === (b.source === 'default') ? a.slug.localeCompare(b.slug) : a.source === 'default' ? -1 : 1);
    return q ? list.filter((s) => `${s.slug} ${s.name} ${s.description}`.toLowerCase().includes(q)) : list;
  });
  protected readonly enabledCount = computed(() => this.skills().data.filter((s) => s.enabled).length);

  protected readonly info = computed(() => parseId(this.active() ?? 'core/review.md'));
  protected readonly currentSkill = computed(() => this.skills().data.find((s) => s.slug === this.info().slug) ?? null);

  // versi file yang sedang dibuka (prompt inti / skill)
  private readonly promptVersions = liveQuery<Version>(
    () => query(collection(this.fb.db, `prompts/${this.info().kind === 'core' ? this.info().key : '_none'}/versions`), orderBy('version', 'desc')),
    (_id, d) => ({ version: Number(d['version']), content: String(d['content'] ?? ''), files: {}, message: String(d['message'] ?? ''), authorLogin: String(d['authorLogin'] ?? ''), createdAtMs: toMs(d['createdAt']), parentVersion: d['parentVersion'] ?? null }),
  );
  private readonly openSkillSlugs = computed(() => [...new Set([...this.expanded(), ...this.tabs().filter((t) => t.startsWith('skills/')).map((t) => parseId(t).slug)])]);
  private readonly skillVersions = liveQuery<Version>(
    () => query(collection(this.fb.db, `skills/${this.info().kind === 'skill' ? this.info().slug : '_none'}/versions`), orderBy('version', 'desc')),
    (_id, d) => ({ version: Number(d['version']), content: '', files: (d['files'] ?? {}) as Record<string, string>, message: String(d['message'] ?? ''), authorLogin: String(d['authorLogin'] ?? ''), createdAtMs: toMs(d['createdAt']), parentVersion: d['parentVersion'] ?? null }),
  );
  /** isi semua versi terbaru skill yang dibuka (dibaca per skill saat di-expand) */
  private readonly skillFiles = signal<Record<string, Record<string, string>>>({});

  protected readonly versions = computed<Version[]>(() => {
    const inf = this.info();
    if (inf.kind === 'core') return this.promptVersions().data;
    return this.skillVersions().data.map((v) => ({ ...v, content: v.files[inf.path] ?? '' }));
  });
  protected readonly activeVersion = computed(() => (this.info().kind === 'core' ? (this.core().find((p) => p.key === this.info().key)?.active ?? 1) : (this.currentSkill()?.latest ?? 1)));
  protected readonly latestVersion = computed(() => (this.info().kind === 'core' ? (this.core().find((p) => p.key === this.info().key)?.latest ?? 1) : (this.currentSkill()?.latest ?? 1)));
  protected readonly readonlyFile = computed(() => this.info().kind === 'skill' && this.info().path !== 'SKILL.md');
  protected readonly versionOpts = computed(() => this.versions().map((v) => ({ value: v.version, label: 'v' + v.version })));

  private contentOf(v: number) {
    return this.versions().find((x) => x.version === v)?.content ?? '';
  }
  protected readonly ops = computed(() => diffLines(this.contentOf(this.left()), this.contentOf(this.right())));
  protected readonly rows = computed(() => sideBySide(this.ops()));
  protected readonly diffSummary = computed(() => diffStats(this.ops()));
  protected readonly previewHtml = computed(() => {
    const id = this.active();
    if (!id) return '';
    // frontmatter SKILL.md tidak ikut dirender
    return miniMarkdown(this.draftOf(id).replace(/^﻿?---\n[\s\S]*?\n---\n?/, ''));
  });

  // statistik per versi prompt inti (dari job & temuan)
  private readonly jobs = liveQuery(
    () => query(collection(this.fb.db, 'jobs'), where('type', '==', 'review'), orderBy('createdAt', 'desc'), limit(500)),
    (_id, d) => ({ pv: d['promptVersions'] as Record<string, number> | undefined, findings: Number(d['result']?.findings?.length ?? 0), posted: d['status'] === 'posted' }),
  );
  private readonly findingsQ = liveQuery(() => query(collection(this.fb.db, 'findings'), orderBy('createdAt', 'desc'), limit(2000)), (_id, d) => ({
    pv: d['promptVersions'] as Record<string, number> | undefined,
    outcome: String(d['outcome'] ?? 'pending'),
  }));
  private readonly stats = computed(() => {
    const key = this.info().key;
    const m = new Map<number, { reviews: number; findings: number; addressed: number; disputed: number; total: number }>();
    const get = (v: number) => m.get(v) ?? { reviews: 0, findings: 0, addressed: 0, disputed: 0, total: 0 };
    for (const j of this.jobs().data) {
      const v = j.pv?.[key];
      if (!v || !j.posted) continue;
      const s = get(v);
      s.reviews++;
      s.findings += j.findings;
      m.set(v, s);
    }
    for (const f of this.findingsQ().data) {
      const v = f.pv?.[key];
      if (!v) continue;
      const s = get(v);
      s.total++;
      if (f.outcome === 'addressed') s.addressed++;
      if (f.outcome === 'disputed') s.disputed++;
      m.set(v, s);
    }
    return m;
  });
  protected stat(v: number) {
    const s = this.stats().get(v);
    if (!s) return { reviews: 0, avgFindings: '—', addressed: '—', disputed: '—' };
    return {
      reviews: s.reviews,
      avgFindings: s.reviews ? fmtNum(s.findings / s.reviews, 1) : '—',
      addressed: s.total ? fmtPct(s.addressed / s.total) : '—',
      disputed: s.total ? fmtPct(s.disputed / s.total) : '—',
    };
  }
  protected dt = (ms: number | null) => fmtDateTime(ms);

  constructor() {
    // buka file dari URL (?f=…), default review.md
    effect(() => {
      const f = this.f() || 'core/review.md';
      if (this.active() === null) this.open(f);
    });
    // muat isi skill yang di-expand / dibuka (versi terbaru) supaya pohon file & editor tahu isinya
    effect(() => {
      const open = new Set(this.openSkillSlugs());
      for (const s of this.skills().data) if (open.has(s.slug)) void this.loadSkillFiles(s.slug, s.latest);
    });
  }

  private loaded = new Map<string, number>();
  private async loadSkillFiles(slug: string, version: number) {
    if (this.loaded.get(slug) === version) return;
    this.loaded.set(slug, version);
    const snap = await getDoc(doc(this.fb.db, `skills/${slug}/versions/${version}`));
    this.skillFiles.update((m) => ({ ...m, [slug]: (snap.get('files') ?? {}) as Record<string, string> }));
  }

  protected treeOf(slug: string) {
    return skillTree(slug, Object.keys(this.skillFiles()[slug] ?? { 'SKILL.md': '' }));
  }

  /** isi tersimpan (versi aktif untuk prompt inti, terbaru untuk skill) */
  private savedOf(id: FileId): string {
    const inf = parseId(id);
    if (inf.kind === 'core') {
      const base = this.baseVersion()[id];
      const vs = id === this.active() ? this.promptVersions().data : [];
      const p = this.core().find((x) => x.key === inf.key);
      const v = vs.find((x) => x.version === (base ?? p?.active)) ?? vs[0];
      return v?.content ?? this.cachedCore[id] ?? '';
    }
    return this.skillFiles()[inf.slug]?.[inf.path] ?? '';
  }
  private cachedCore: Record<string, string> = {};
  protected draftOf(id: FileId): string {
    const d = this.drafts()[id];
    if (d !== undefined) return d;
    const s = this.savedOf(id);
    if (parseId(id).kind === 'core' && s) this.cachedCore[id] = s;
    return s;
  }
  protected dirty(id: FileId): boolean {
    const d = this.drafts()[id];
    return d !== undefined && d !== this.savedOf(id);
  }
  protected setDraft(id: FileId, v: string) {
    this.drafts.update((m) => ({ ...m, [id]: v }));
  }
  protected discard(id: FileId) {
    this.drafts.update((m) => {
      const { [id]: _drop, ...rest } = m;
      return rest;
    });
    this.message.set('');
  }

  protected label(id: FileId) {
    const inf = parseId(id);
    return inf.kind === 'core' ? `${inf.key}.md` : inf.path === 'SKILL.md' ? `SKILL.md — ${inf.slug}` : inf.path.split('/').at(-1)!;
  }
  protected crumb(id: FileId) {
    const inf = parseId(id);
    return inf.kind === 'core' ? `inti › ${inf.key}.md` : `skills › ${inf.slug} › ${inf.path.split('/').join(' › ')}`;
  }

  open(id: FileId) {
    const inf = parseId(id);
    if (inf.kind === 'skill') this.expanded.update((s) => new Set(s).add(inf.slug));
    if (!this.tabs().includes(id)) this.tabs.update((t) => [...t, id]);
    this.activate(id);
  }
  activate(id: FileId) {
    this.active.set(id);
    this.message.set('');
    this.msgError.set('');
    this.cursor.set({ line: 1, col: 1 });
    void this.router.navigate([], { queryParams: { f: id }, replaceUrl: true });
  }
  closeTab(id: FileId) {
    const t = this.tabs().filter((x) => x !== id);
    this.tabs.set(t);
    if (this.active() === id) {
      const next = t.at(-1) ?? null;
      this.active.set(next);
      if (next) this.activate(next);
    }
  }
  toggleFolder(slug: string) {
    const isOpen = this.expanded().has(slug);
    this.expanded.update((s) => {
      const n = new Set(s);
      if (isOpen) n.delete(slug);
      else n.add(slug);
      return n;
    });
    if (!isOpen) this.open(`skills/${slug}/SKILL.md`);
  }
  togglePanel(p: 'history' | 'compare') {
    this.panel.set(this.panel() === null ? p : null);
  }
  loadVersion(v: Version) {
    const id = this.active();
    if (!id) return;
    this.setDraft(id, v.content);
    if (this.info().kind === 'core') this.baseVersion.update((m) => ({ ...m, [id]: v.version }));
  }
  compareWith(v: number) {
    this.left.set(v);
    this.right.set(this.versions()[0]?.version ?? v);
    this.panel.set('compare');
  }

  async startSave() {
    const id = this.active();
    if (!id || this.readonlyFile()) return;
    if (this.message().trim().length < 3) {
      this.msgError.set('Pesan perubahan minimal 3 karakter');
      return;
    }
    const inf = parseId(id);
    const content = this.draftOf(id);
    this.busy.set(true);
    this.saving.set(true);
    try {
      let version: number;
      if (inf.kind === 'core') {
        const before = this.baseVersion()[id] ?? this.activeVersion();
        version = (await this.fb.call<unknown, { version: number }>('savePromptVersion')({ key: inf.key, content, message: this.message().trim(), activate: this.activateNow() })).version;
        this.left.set(before);
        this.right.set(version);
        this.panel.set('compare');
        if (!this.activateNow()) this.baseVersion.update((m) => ({ ...m, [id]: version }));
        this.cachedCore[id] = content;
      } else {
        version = (await this.fb.call<unknown, { version: number }>('saveSkillVersion')({ slug: inf.slug, content, message: this.message().trim() })).version;
        this.skillFiles.update((m) => ({ ...m, [inf.slug]: { ...(m[inf.slug] ?? {}), [inf.path]: content } }));
      }
      this.discard(id);
      this.snack.open(`Versi v${version} tersimpan.`, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal menyimpan: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
      this.saving.set(false);
    }
  }

  async activatePrompt(version: number) {
    try {
      await this.fb.call('activatePromptVersion')({ key: this.info().key, version });
      const id = this.active();
      if (id) this.baseVersion.update((m) => ({ ...m, [id]: version }));
      this.snack.open(`v${version} sekarang aktif.`, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal mengaktifkan: ' + (e as Error).message, 'Tutup');
    }
  }

  openImport() {
    this.dialog.open(ImportSkillsDialog, { width: '720px', maxWidth: '95vw' });
  }

  private async run(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try {
      await fn();
      this.snack.open(ok, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    } finally {
      this.busy.set(false);
    }
  }
  toggleSkill(slug: string, enabled: boolean) {
    return this.run(() => this.fb.call('setSkillEnabled')({ slug, enabled }), enabled ? 'Skill diaktifkan — dipakai di review berikutnya.' : 'Skill dinonaktifkan.');
  }
  async deleteSkill(slug: string) {
    await this.run(() => this.fb.call('deleteSkill')({ slug }), 'Skill dihapus.');
    for (const t of this.tabs().filter((x) => x.startsWith(`skills/${slug}/`))) this.closeTab(t);
    this.expanded.update((s) => {
      const n = new Set(s);
      n.delete(slug);
      return n;
    });
  }
}
