import { Component, computed, inject, signal } from '@angular/core';
import { collection, doc, orderBy, query, updateDoc } from 'firebase/firestore';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { machineStatus, MACHINE_STATUS_LABEL, type MachineStatus } from '@chefjuno/shared';
import { CjPage } from '../ui/page';
import { CjChip, STATUS_TONE } from '../ui/chip';
import { CjEmptyState } from '../ui/empty-state';
import { CjSelect } from '../ui/select';
import { FirebaseService } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { liveQuery } from '../core/live';
import { fmtRelative, toMs } from '../core/format';
import { nowSignal } from '../core/now';
import { AddMachineDialog } from './add-machine-dialog';

interface AgentChip {
  name: string;
  version: string;
  isolation: string;
  enabled: boolean;
  warning: string | null;
}
interface MachineRow {
  id: string;
  name: string;
  ownerLogin: string;
  lastSeenAtMs: number | null;
  platform: string;
  daemonVersion: string;
  concurrency: number;
  currentJobIds: string[];
  revoked: boolean;
  agents: AgentChip[];
}

@Component({
  selector: 'cj-machines',
  imports: [CjPage, CjChip, CjEmptyState, CjSelect, MatButton, MatIconButton, MatTableModule, MatDialogModule, MatTooltip],
  template: `
    <cj-page heading="Mesin" subtitle="Mesin reviewer milik tim. Menjalankan Claude Code atau Codex lewat langganan.">
      <button actions matButton="filled" (click)="add()" data-testid="add-machine">
        <span class="material-symbols-rounded" aria-hidden="true">add</span> Tambah mesin
      </button>
      <div class="cj-grid stats">
        <div class="cj-card"><div class="cj-muted">Online</div><div class="big" data-testid="online-count">{{ counts().online }}</div></div>
        <div class="cj-card"><div class="cj-muted">Sibuk</div><div class="big">{{ counts().busy }}</div></div>
        <div class="cj-card"><div class="cj-muted">Offline</div><div class="big">{{ counts().offline }}</div></div>
      </div>
      <div>
        @if (machines().loading) {
          <div class="cj-skeleton" style="height: 120px"></div>
        } @else if (machines().error) {
          <div class="cj-card"><cj-empty-state icon="error" title="Gagal memuat" [text]="machines().error!" /></div>
        } @else if (!rows().length) {
          <div class="cj-card"><cj-empty-state icon="dns" title="Belum ada mesin" text="Tambahkan mesin pertama lewat tombol Tambah mesin, lalu jalankan perintah login di mesin itu." /></div>
        } @else {
          <div class="cj-table-wrap">
            <table mat-table [dataSource]="rows()" data-testid="machines-table">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Nama</th>
                <td mat-cell *matCellDef="let m"><strong>{{ m.name }}</strong><div class="cj-muted small">{{ m.ownerLogin ? '@' + m.ownerLogin : '' }} {{ m.platform }}</div></td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let m"><cj-chip [tone]="tone(m.status)" [attr.data-status]="m.status">{{ label(m.status) }}</cj-chip></td>
              </ng-container>
              <ng-container matColumnDef="agents">
                <th mat-header-cell *matHeaderCellDef>Agent</th>
                <td mat-cell *matCellDef="let m">
                  <div class="cj-row-actions">
                    @for (a of m.agents; track a.name) {
                      <cj-chip [tone]="a.enabled ? 'primary' : 'error'" [matTooltip]="a.warning ?? ('isolasi ' + a.isolation)">
                        {{ a.name === 'claude' ? 'Claude' : 'Codex' }} {{ a.version }} · {{ a.enabled ? a.isolation : 'tidak dipakai' }}
                      </cj-chip>
                    } @empty {
                      <span class="cj-muted">—</span>
                    }
                  </div>
                </td>
              </ng-container>
              <ng-container matColumnDef="jobs">
                <th mat-header-cell *matHeaderCellDef>Job</th>
                <td mat-cell *matCellDef="let m">
                  @if (auth.isAdmin() && !m.revoked) {
                    <div class="cap">
                      <span>{{ m.currentJobIds.length }} /</span>
                      <cj-select [label]="'Kapasitas job sekaligus ' + m.name" [options]="capOpts" [value]="m.concurrency" (valueChange)="setCapacity(m, $event)" [testId]="'capacity-' + m.id" />
                    </div>
                  } @else {
                    {{ m.currentJobIds.length }}/{{ m.concurrency }}
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="seen">
                <th mat-header-cell *matHeaderCellDef>Terakhir terlihat</th>
                <td mat-cell *matCellDef="let m">{{ rel(m.lastSeenAtMs) }}</td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef><span class="cdk-visually-hidden">Aksi</span></th>
                <td mat-cell *matCellDef="let m">
                  @if (auth.isAdmin() && !m.revoked) {
                    <button matIconButton (click)="revoke(m)" [attr.aria-label]="'Cabut ' + m.name" matTooltip="Cabut mesin">
                      <span class="material-symbols-rounded" aria-hidden="true">block</span>
                    </button>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="cols"></tr>
              <tr mat-row *matRowDef="let row; columns: cols"></tr>
            </table>
          </div>
        }
      </div>
    </cj-page>
  `,
  styles: `
    .cap { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .stats { margin-bottom: 16px; }
    .big { font: var(--mat-sys-display-small); margin-top: 4px; }
    .small { font: var(--mat-sys-body-small); }
  `,
})
export class MachinesPage {
  private readonly fb = inject(FirebaseService);
  protected readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly cols = ['name', 'status', 'agents', 'jobs', 'seen', 'actions'];
  private readonly now = nowSignal(5000);
  protected readonly busy = signal(false);

  protected readonly machines = liveQuery<MachineRow>(
    () => query(collection(this.fb.db, 'machines'), orderBy('createdAt', 'desc')),
    (id, d) => ({
      id,
      name: d['name'] ?? id,
      ownerLogin: d['ownerLogin'] ?? '',
      lastSeenAtMs: toMs(d['lastSeenAt']),
      platform: d['platform'] ?? '',
      daemonVersion: d['daemonVersion'] ?? '',
      concurrency: d['concurrency'] ?? 1,
      currentJobIds: d['currentJobIds'] ?? [],
      revoked: !!d['revoked'],
      agents: Object.entries((d['agents'] ?? {}) as Record<string, Omit<AgentChip, 'name'>>).map(([name, a]) => ({ name, ...a })),
    }),
  );

  protected readonly rows = computed(() =>
    this.machines().data.map((m) => ({ ...m, status: machineStatus(m, this.now()) })),
  );
  protected readonly counts = computed(() => {
    const c = { online: 0, busy: 0, offline: 0 };
    for (const r of this.rows()) if (r.status in c) c[r.status as keyof typeof c]++;
    return c;
  });

  protected tone = (s: MachineStatus) => STATUS_TONE[s];
  protected label = (s: MachineStatus) => MACHINE_STATUS_LABEL[s];
  protected rel = (ms: number | null) => (ms ? fmtRelative(ms, this.now()) : 'belum pernah');

  add() {
    this.dialog.open(AddMachineDialog, { width: '560px', maxWidth: '95vw' });
  }

  /** Kapasitas job sekaligus per mesin; mesin membacanya langsung tanpa restart. */
  protected readonly capOpts = [1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? '1 job' : `${n} job` }));
  async setCapacity(m: MachineRow, n: number) {
    try {
      await updateDoc(doc(this.fb.db, `machines/${m.id}`), { concurrency: n });
      this.snack.open(`${m.name} sekarang mengerjakan maksimal ${n} job sekaligus.`, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal mengubah kapasitas: ' + (e as Error).message, 'Tutup');
    }
  }
  async revoke(m: MachineRow) {
    try {
      await this.fb.call<{ machineId: string }, unknown>('revokeMachine')({ machineId: m.id });
      this.snack.open(`Mesin ${m.name} dicabut.`, 'Tutup', { duration: 4000 });
    } catch (e) {
      this.snack.open('Gagal mencabut: ' + (e as Error).message, 'Tutup');
    }
  }
}
