import { Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { strFromU8, unzipSync } from 'fflate';
import { groupSkillFiles, SKILL_LIMITS, SKILL_TEXT_EXT, type GroupedSkill } from '@chefjuno/shared';
import { AuthService } from '../core/auth.service';
import { FirebaseService } from '../core/firebase';

interface RawFile {
  path: string;
  content: string;
}

const isText = (path: string) => SKILL_TEXT_EXT.some((e) => path.toLowerCase().endsWith(e)) || /(^|\/)skill\.md$/i.test(path);

/** Baca File[] dari input/drag-drop: teks biasa, folder (webkitRelativePath), dan .zip (diekstrak di browser). */
async function readFiles(list: File[]): Promise<{ files: RawFile[]; skipped: number }> {
  const files: RawFile[] = [];
  let skipped = 0;
  for (const f of list) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [p, data] of Object.entries(entries)) {
        if (p.endsWith('/')) continue;
        if (!isText(p) || data.length > SKILL_LIMITS.maxFileBytes) {
          skipped++;
          continue;
        }
        files.push({ path: p, content: strFromU8(data) });
      }
    } else if (isText(path) && f.size <= SKILL_LIMITS.maxFileBytes) {
      files.push({ path, content: await f.text() });
    } else skipped++;
  }
  return { files, skipped };
}

/** Kumpulkan File dari DataTransfer, termasuk isi folder yang di-drop (webkitGetAsEntry). */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(new File([file], file.name, { type: file.type }));
      Object.defineProperty(out[out.length - 1], 'webkitRelativePath', { value: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      } while (batch.length);
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, '');
  else out.push(...[...dt.files]);
  return out;
}

@Component({
  selector: 'cj-import-skills-dialog',
  imports: [MatDialogModule, MatButton, MatProgressSpinner],
  template: `
    <h2 mat-dialog-title>Import skills</h2>
    <mat-dialog-content>
      @if (!result()) {
        <p class="cj-muted">Format skill Claude Code: satu folder per skill berisi <code>SKILL.md</code> (frontmatter <code>name</code> &amp; <code>description</code>) plus file pendukung. Bisa banyak skill sekaligus.</p>
        <div class="drop" [class.over]="over()" (dragover)="$event.preventDefault(); over.set(true)" (dragleave)="over.set(false)" (drop)="onDrop($event)" data-testid="skills-drop">
          <span class="material-symbols-rounded big" aria-hidden="true">drive_folder_upload</span>
          <p><b>Tarik folder, file .md, atau .zip ke sini</b></p>
          <div class="btns">
            <button matButton="tonal" type="button" (click)="dirInput.click()"><span class="material-symbols-rounded" aria-hidden="true">folder_open</span> Pilih folder</button>
            <button matButton="tonal" type="button" (click)="fileInput.click()"><span class="material-symbols-rounded" aria-hidden="true">upload_file</span> Pilih file / .zip</button>
          </div>
          <input #dirInput type="file" webkitdirectory multiple hidden (change)="onPick($any($event.target))" aria-label="Pilih folder skill" />
          <input #fileInput type="file" multiple accept=".md,.markdown,.zip,.txt,.json,.yaml,.yml" hidden (change)="onPick($any($event.target))" aria-label="Pilih file skill" data-testid="skills-file-input" />
        </div>
        @if (reading()) {<p class="row"><mat-progress-spinner diameter="18" mode="indeterminate" /> Membaca file…</p>}
        @if (preview(); as p) {
          <h3>{{ p.skills.length }} skill siap di-import{{ skipped() ? ' · ' + skipped() + ' file biner/terlalu besar dilewati' : '' }}</h3>
          <ul class="list" data-testid="skills-preview">
            @for (s of p.skills; track s.slug) {
              <li>
                <span class="material-symbols-rounded ico" aria-hidden="true">folder</span>
                <span class="main"><b>{{ s.name }}</b> <code>{{ s.slug }}/</code><span class="ds">{{ s.description }}</span></span>
                <span class="cj-muted small">{{ fileCount(s) }} file</span>
              </li>
            }
          </ul>
          @if (p.errors.length) {
            <div class="errs" role="alert" data-testid="skills-preview-errors">
              <b>{{ p.errors.length }} masalah (tidak di-import):</b>
              <ul>@for (e of p.errors; track e) {<li>{{ e }}</li>}</ul>
            </div>
          }
          @if (!auth.isAdmin() && p.skills.length) {<p class="cj-muted small">Skill baru dari anggota masuk sebagai nonaktif sampai diaktifkan admin.</p>}
        }
        @if (error()) {<p class="err" role="alert">{{ error() }}</p>}
      } @else {
        <div class="done" data-testid="skills-import-result">
          <span class="material-symbols-rounded ok" aria-hidden="true">check_circle</span>
          <p>{{ result()!.created.length }} skill baru, {{ result()!.updated.length }} diperbarui, {{ result()!.unchanged.length }} tidak berubah.</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>{{ result() ? 'Selesai' : 'Batal' }}</button>
      @if (!result()) {
        <button matButton="filled" (click)="submit()" [disabled]="busy() || !(preview()?.skills?.length)" data-testid="skills-import-submit">
          Import {{ preview()?.skills?.length || '' }} skill
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .drop { border: 2px dashed var(--mat-sys-outline-variant); border-radius: 20px; padding: 28px; text-align: center; margin: 12px 0; transition: background .15s; }
    .drop.over { background: var(--mat-sys-primary-container); border-color: var(--mat-sys-primary); }
    .drop p { margin: 4px 0 14px; }
    .big { font-size: 40px; color: var(--mat-sys-primary); }
    .btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .row { display: flex; gap: 10px; align-items: center; }
    h3 { font: var(--mat-sys-title-small); margin: 16px 0 8px; }
    .list { list-style: none; padding: 0; margin: 0; max-height: 260px; overflow: auto; border-radius: 16px; background: var(--mat-sys-surface-container-low); }
    .list li { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .list li:last-child { border-bottom: 0; }
    .ico { color: var(--mat-sys-primary); }
    .main { flex: 1; min-width: 0; } .main code { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .ds { display: block; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .errs { margin-top: 12px; padding: 12px 16px; border-radius: 12px; background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .errs ul { margin: 6px 0 0; padding-left: 18px; }
    .err { color: var(--mat-sys-error); } .ok { color: var(--mat-sys-primary); font-size: 40px; }
    .done { text-align: center; padding: 16px; }
    .small { font: var(--mat-sys-body-small); }
  `,
})
export class ImportSkillsDialog {
  private readonly fb = inject(FirebaseService);
  private readonly ref = inject(MatDialogRef<ImportSkillsDialog>);
  protected readonly auth = inject(AuthService);
  protected readonly over = signal(false);
  protected readonly reading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly skipped = signal(0);
  private readonly raw = signal<RawFile[] | null>(null);
  protected readonly preview = computed(() => {
    const r = this.raw();
    return r ? groupSkillFiles(r) : null;
  });
  protected readonly result = signal<{ created: string[]; updated: string[]; unchanged: string[] } | null>(null);
  protected fileCount = (s: GroupedSkill) => Object.keys(s.files).length;

  async onPick(input: HTMLInputElement) {
    await this.load([...(input.files ?? [])]);
    input.value = '';
  }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    this.over.set(false);
    if (e.dataTransfer) await this.load(await filesFromDrop(e.dataTransfer));
  }

  private async load(list: File[]) {
    if (!list.length) return;
    this.reading.set(true);
    this.error.set('');
    try {
      const { files, skipped } = await readFiles(list);
      this.skipped.set(skipped);
      this.raw.set(files);
    } catch (e) {
      this.error.set('Gagal membaca file: ' + (e as Error).message);
    } finally {
      this.reading.set(false);
    }
  }

  async submit() {
    const p = this.preview();
    if (!p?.skills.length) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.fb.call<unknown, { created: string[]; updated: string[]; unchanged: string[] }>('importSkills')({
        skills: p.skills.map((s) => ({ files: s.files })),
      });
      this.result.set(r);
    } catch (e) {
      this.error.set('Import gagal: ' + (e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  close() {
    this.ref.close();
  }
}
