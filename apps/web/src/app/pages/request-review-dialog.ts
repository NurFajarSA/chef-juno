import { Component, inject, signal } from '@angular/core';
import { collection, orderBy, query } from 'firebase/firestore';
import { MatButton } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { FirebaseService } from '../core/firebase';
import { liveQuery } from '../core/live';

/**
 * CTA utama app bar: cara meminta Chef Juno mereview PR.
 * Review dipicu dari komentar di PR GitHub (bukan tombol di dashboard), jadi dialog ini menunjukkan perintahnya + tautan ke PR tiap repo.
 */
@Component({
  selector: 'cj-request-review-dialog',
  imports: [MatButton, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Minta review</h2>
    <mat-dialog-content>
      <p class="lead">Tulis komentar ini di pull request mana pun di repo yang terpasang Chef Juno:</p>
      <div class="cmd">
        <code data-testid="review-command">lapor &#64;chefjuno</code>
        <button matButton="tonal" type="button" (click)="copy()">
          <span class="material-symbols-rounded" aria-hidden="true">{{ copied() ? 'check' : 'content_copy' }}</span>{{ copied() ? 'Tersalin' : 'Salin' }}
        </button>
      </div>
      <ol class="steps">
        <li>Bisa ditambah instruksi, mis. <code>lapor &#64;chefjuno fokus ke query SQL</code>.</li>
        <li>Mesin reviewer yang online mengambil job-nya, lalu Chef Juno membalas di PR.</li>
        <li>Hasilnya juga muncul di halaman Review Kode.</li>
      </ol>
      @if (repos().data.length) {
        <p class="cj-muted label">Buka daftar PR:</p>
        <div class="repos">
          @for (r of repos().data; track r.id) {
            <a class="repo" [href]="'https://github.com/' + r.fullName + '/pulls'" target="_blank" rel="noopener">
              <span class="material-symbols-rounded" aria-hidden="true">folder_code</span>{{ r.fullName }}
              <span class="material-symbols-rounded ext" aria-hidden="true">open_in_new</span>
            </a>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button matButton mat-dialog-close>Tutup</button></mat-dialog-actions>
  `,
  styles: `
    .lead { margin-top: 0; }
    .cmd { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 12px 12px 12px 20px; border-radius: 16px;
      background: var(--mat-sys-surface-container-high); }
    .cmd code { font-size: 18px; }
    .steps { padding-left: 20px; line-height: 1.7; }
    .label { margin-bottom: 8px; }
    .repos { display: flex; flex-wrap: wrap; gap: 8px; }
    .repo { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface); text-decoration: none; font: var(--mat-sys-label-large); }
    .repo:hover { background: var(--mat-sys-surface-container-high); }
    .repo .material-symbols-rounded { font-size: 18px; }
    .repo .ext { font-size: 16px; color: var(--mat-sys-on-surface-variant); }
  `,
})
export class RequestReviewDialog {
  private readonly fb = inject(FirebaseService);
  protected readonly copied = signal(false);
  protected readonly repos = liveQuery(() => query(collection(this.fb.db, 'repos'), orderBy('fullName')), (id, d) => ({ id, fullName: d['fullName'] as string }));
  async copy() {
    try {
      await navigator.clipboard.writeText('lapor @chefjuno');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.copied.set(false);
    }
  }
}
