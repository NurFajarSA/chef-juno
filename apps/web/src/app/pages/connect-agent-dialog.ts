import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { AuthService } from '../core/auth.service';

/** Cara memasang code map & memory tim ke Claude Code / Codex milik developer (server MCP lokal, read-only). */
@Component({
  selector: 'cj-connect-agent-dialog',
  imports: [MatDialogModule, MatButton],
  template: `
    <h2 mat-dialog-title>Hubungkan ke agent</h2>
    <mat-dialog-content>
      <p>Pasang server MCP Chef Juno di Claude Code atau Codex milikmu supaya agent bisa bertanya ke <b>code map</b> dan <b>memory tim</b>.
        Semua dijalankan lokal di mesinmu dan read-only. Mesin harus sudah <code>chefjuno login</code>.</p>
      <h3>1. Memory tim (aturan + kesalahan yang sering kamu ulangi)</h3>
      <pre data-testid="mcp-memory">{{ memoryCmd }}</pre>
      <h3>2. Code map {{ data.repo ? 'untuk ' + data.repo : '' }}</h3>
      <pre data-testid="mcp-graph">{{ graphCmd }}</pre>
      <h3>3. Atau cukup file memori untuk CLAUDE.md / AGENTS.md</h3>
      <pre>{{ pullCmd }}</pre>
      <button matButton="tonal" (click)="copy()">{{ copied() ? 'Tersalin' : 'Salin semua perintah' }}</button>
    </mat-dialog-content>
    <mat-dialog-actions align="end"><button matButton mat-dialog-close>Tutup</button></mat-dialog-actions>
  `,
  styles: `
    pre { white-space: pre-wrap; word-break: break-all; background: var(--mat-sys-surface-container-high); padding: 12px; border-radius: 12px; font-size: 12px; }
    h3 { font: var(--mat-sys-title-small); margin: 16px 0 6px; }
  `,
})
export class ConnectAgentDialog {
  protected readonly data = inject<{ repoId: string; repo: string }>(MAT_DIALOG_DATA);
  private readonly login = inject(AuthService).membership()?.githubLogin ?? '<github-login>';
  protected readonly copied = signal(false);
  protected readonly memoryCmd = `claude mcp add chefjuno_memory -- node <path-repo-chefjuno-ai>/apps/daemon/dist/cli.js memory-mcp`;
  protected readonly graphCmd = `claude mcp add chefjuno_graph -- node <path-repo-chefjuno-ai>/apps/daemon/dist/cli.js graph-mcp --db ~/.chefjuno/index/${this.data.repoId || '<repoId>'}/graph.db --root <path-checkout-repo>`;
  protected readonly pullCmd = `node <path-repo-chefjuno-ai>/apps/daemon/dist/cli.js memory pull --login ${this.login}`;
  async copy() {
    try {
      await navigator.clipboard.writeText([this.memoryCmd, this.graphCmd, this.pullCmd].join('\n'));
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
