import { Component, inject, signal } from '@angular/core';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MachineRegistrationInputSchema } from '@chefjuno/shared';
import { FirebaseService } from '../core/firebase';
import { machineLoginCommand, MACHINE_START_COMMAND } from '../core/machine-cmd';

@Component({
  selector: 'cj-add-machine-dialog',
  imports: [MatDialogModule, MatButton, MatFormFieldModule, MatInput, FormField],
  template: `
    <h2 mat-dialog-title>Tambah mesin</h2>
    <mat-dialog-content>
      @if (!result()) {
        <p class="cj-muted">Mesin menjalankan Claude Code / Codex milik pemiliknya (langganan, tanpa API key).</p>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Nama mesin</mat-label>
          <input matInput [formField]="f.name" data-testid="machine-name" placeholder="mis. MacBook Tim" />
          @if (f.name().touched() && f.name().errors().length) {
            <mat-error>{{ f.name().errors()[0].message }}</mat-error>
          }
        </mat-form-field>
        @if (error()) {
          <p class="err" role="alert">{{ error() }}</p>
        }
      } @else {
        <p>Kode berlaku 10 menit dan hanya bisa dipakai sekali. Jalankan di mesin itu:</p>
        <div class="code" data-testid="machine-code">{{ result()!.code }}</div>
        <pre class="cmd" data-testid="machine-command">{{ command() }}</pre>
        <div class="row">
          <button matButton="tonal" (click)="copy()">{{ copied() ? 'Tersalin' : 'Salin perintah' }}</button>
        </div>
        <p class="cj-muted small">Lalu: <code>{{ startCmd }}</code></p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>{{ result() ? 'Selesai' : 'Batal' }}</button>
      @if (!result()) {
        <button matButton="filled" (click)="submit()" [disabled]="busy()" data-testid="machine-submit">Buat kode</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .full { width: 100%; }
    .code { font: var(--mat-sys-display-small); font-family: 'Google Sans Code Variable', monospace; letter-spacing: 4px; text-align: center; padding: 12px;
      background: var(--mat-sys-surface-container-high); border-radius: 16px; margin: 8px 0; }
    .cmd { white-space: pre-wrap; word-break: break-all; background: var(--mat-sys-surface-container-high); padding: 12px; border-radius: 12px; font-size: 12px; }
    .row { display: flex; justify-content: flex-end; }
    .err { color: var(--mat-sys-error); }
    .small { font: var(--mat-sys-body-small); }
  `,
})
export class AddMachineDialog {
  private readonly fb = inject(FirebaseService);
  protected readonly model = signal({ name: '' });
  protected readonly f = form(this.model, (p) => validateStandardSchema(p, MachineRegistrationInputSchema));
  protected readonly result = signal<{ code: string; expiresAt: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly copied = signal(false);
  protected readonly startCmd = MACHINE_START_COMMAND;

  protected command() {
    return machineLoginCommand(this.fb.functionsBaseUrl(), this.result()?.code ?? '');
  }

  async submit() {
    this.f.name().markAsTouched();
    if (this.f().invalid()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.result.set(await this.fb.call<{ name: string }, { code: string; expiresAt: string }>('createMachineRegistration')(this.model()));
    } catch (e) {
      this.error.set('Gagal membuat kode: ' + (e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.command());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
