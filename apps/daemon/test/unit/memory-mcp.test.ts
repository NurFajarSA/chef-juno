import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('chefjuno memory-mcp (stdio)', () => {
  it('tanpa kredensial mesin → berhenti dengan pesan jelas (tidak diam-diam jalan)', async () => {
    const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
    const client = new Client({ name: 't', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'memory-mcp'],
      env: { ...process.env, CHEFJUNO_HOME: '/tmp/cj-tidak-ada-' + Date.now() } as Record<string, string>,
      stderr: 'pipe',
    });
    let err = '';
    transport.stderr?.on('data', (d) => (err += d));
    await expect(client.connect(transport)).rejects.toThrow();
    expect(err).toContain('Belum login');
  });
});
