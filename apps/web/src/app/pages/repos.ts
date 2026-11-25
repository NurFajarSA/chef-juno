import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CjPage } from '../ui/page';
import { CjChip, STATUS_TONE } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveQuery } from '../core/live';
import { fmtRelative, toMs } from '../core/format';
import { nowSignal } from '../core/now';
import { INDEX_LABEL } from './kb';

interface RepoRow {
  id: string;
  fullName: string;
  private: boolean;
  enabled: boolean;
  defaultBranch: string;
  /** branch knowledge base (pilihan admin, atau branch utama) */
  kbBranch: string;
  status: string;
  indexedSha: string | null;
  indexedAtMs: number | null;
}

/** Daftar repositori yang terpasang GitHub App: status review, branch knowledge base, status code map. */
@Component({
  selector: 'cj-repos',
  imports: [CjPage, CjChip, CjEmptyState, MatButton, MatSlideToggle, MatTableModule, RouterLink],
  template: `
    <cj-page heading="Repositori" icon="folder_code" subtitle="Repo yang terpasang GitHub App Chef Juno. Matikan review per repo, atur branch knowledge base di halaman Knowledge.">
      @if (auth.isAdmin()) {
        <a actions matButton="filled" routerLink="/setup" data-testid="add-repo">
          <span class="material-symbols-rounded" aria-hidden="true">add</span> Tambah repo
        </a>
      }
      @if (repos().loading) {
        <div class="cj-skeleton" style="height: 120px"></div>
      } @else if (repos().error) {
        <div class="cj-card"><cj-empty-state icon="error" title="Gagal memuat" [text]="repos().error!" /></div>
      } @else if (!rows().length) {
        <div class="cj-card"><cj-empty-state icon="folder_code" title="Belum ada repo" text="Pasang GitHub App Chef Juno di repo tim (lewat Tambah repo / halaman Setup). Repo muncul di sini otomatis." /></div>
      } @else {
        <div class="cj-table-wrap">
          <table mat-table [dataSource]="rows()" data-testid="repositories">
            <ng-container matColumnDef="repo">
              <th mat-header-cell *matHeaderCellDef>Repositori</th>
              <td mat-cell *matCellDef="let r" [attr.data-repo]="r.fullName">
                <a class="link" [routerLink]="['/kb', r.id]"><strong>{{ r.fullName }}</strong></a>
                <div class="cj-muted small">{{ r.private ? 'Privat' : 'Publik' }} · branch utama <code>{{ r.defaultBranch }}</code></div>
              </td>
            </ng-container>
            <ng-container matColumnDef="branch">
              <th mat-header-cell *matHeaderCellDef>Branch knowledge base</th>
              <td mat-cell *matCellDef="let r"><code data-testid="repo-kb-branch">{{ r.kbBranch }}</code></td>
            </ng-container>
            <ng-container matColumnDef="index">
              <th mat-header-cell *matHeaderCellDef>Code map</th>
              <td mat-cell *matCellDef="let r">
                <cj-chip [tone]="tone(r.status)" icon="account_tree">{{ idx(r.status) }}</cj-chip>
                <div class="cj-muted small">{{ r.indexedSha ? 'commit ' + r.indexedSha.slice(0, 7) + ' · ' + rel(r.indexedAtMs) : '—' }}</div>
              </td>
            </ng-container>
            <ng-container matColumnDef="review">
              <th mat-header-cell *matHeaderCellDef>Review</th>
              <td mat-cell *matCellDef="let r">
                @if (auth.isAdmin()) {
                  <mat-slide-toggle [checked]="r.enabled" (change)="toggle(r, $event.checked)" [aria-label]="'Review aktif untuk ' + r.fullName">{{ r.enabled ? 'Aktif' : 'Nonaktif' }}</mat-slide-toggle>
                } @else {
                  <span [class.cj-muted]="!r.enabled">{{ r.enabled ? 'Aktif' : 'Nonaktif' }}</span>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="cols"></tr>
            <tr mat-row *matRowDef="let row; columns: cols"></tr>
          </table>
        </div>
      }
    </cj-page>
  `,
  styles: `
    .small { font: var(--mat-sys-body-small); margin-top: 2px; }
    .link { color: inherit; text-decoration: none; }
    .link:hover strong { text-decoration: underline; }
    code { font-family: 'Google Sans Code', ui-monospace, monospace; font-size: 13px; }
  `,
})
export class ReposPage {
  private readonly fb = inject(FirebaseService);
  private readonly snack = inject(MatSnackBar);
  protected readonly auth = inject(AuthService);
  private readonly now = nowSignal();
  protected readonly cols = ['repo', 'branch', 'index', 'review'];
  protected readonly repos = liveQuery<RepoRow>(
    () => query(collection(this.fb.db, 'repos'), orderBy('fullName')),
    (id, d) => {
      const defaultBranch = String(d['defaultBranch'] ?? 'main');
      return {
        id,
        fullName: String(d['fullName'] ?? id),
        private: d['private'] !== false,
        enabled: d['enabled'] !== false,
        defaultBranch,
        kbBranch: (typeof d['indexBranch'] === 'string' && d['indexBranch'].trim()) || defaultBranch,
        status: String(d['index']?.status ?? 'none'),
        indexedSha: d['index']?.indexedSha ?? null,
        indexedAtMs: toMs(d['index']?.indexedAt),
      };
    },
  );
  protected readonly rows = computed(() => this.repos().data);
  protected idx = (s: string) => INDEX_LABEL[s] ?? s;
  protected tone = (s: string) => STATUS_TONE[s] ?? 'neutral';
  protected rel = (ms: number | null) => (ms ? fmtRelative(ms, this.now()) : '');
  async toggle(r: RepoRow, enabled: boolean) {
    try {
      await updateDoc(doc(this.fb.db, `repos/${r.id}`), { enabled, updatedAt: serverTimestamp() });
      this.snack.open(enabled ? `Review diaktifkan untuk ${r.fullName}.` : `Review dimatikan untuk ${r.fullName}.`, 'Tutup', { duration: 3000 });
    } catch (e) {
      this.snack.open('Gagal: ' + (e as Error).message, 'Tutup');
    }
  }
}
