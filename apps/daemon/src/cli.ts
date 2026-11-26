import { parseArgs } from 'node:util';
import { doc, getDoc } from 'firebase/firestore';
import { machineStatus, MACHINE_STATUS_LABEL } from '@chefjuno/shared';
import { exchangeCode } from './api.js';
import { deleteCreds, loadCreds, saveCreds } from './creds.js';
import { Daemon } from './daemon.js';
import { connect } from './fb.js';
import { handleJob } from './jobs/handle.js';
import type { AgentName } from './agents/types.js';
import { cfg } from './env.js';
import { applyUpdate, headCommit, npmBin, planUpdate, repoRoot, RESTART_CODE, supervise } from './updater.js';

const HELP = `chefjuno — daemon mesin reviewer Chef Juno

Perintah:
  chefjuno login --server <functionsBaseUrl> --code XXXX-XXXX   Daftarkan mesin ini
  chefjuno start [--agents claude,codex] [--no-app]              Nyalakan mesin (heartbeat + ambil job);
                 [--no-auto-update]                              --no-app: tanpa uji aplikasi (mesin tanpa emulator)
                                                                 Mesin memperbarui dirinya ke rilis daemon saat kosong
                                                                 (--no-auto-update untuk mematikan)
  chefjuno status                                                Tampilkan status mesin
  chefjuno logout                                                Hapus kredensial lokal
  chefjuno memory pull --login <github>                          Tulis memori untuk agent pribadimu
  chefjuno graph-mcp --db <graph.db> --root <dir>                Server MCP peta kode (stdio)
  chefjuno memory-mcp                                            Server MCP memori tim (stdio)
`;

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'login': {
      const { values } = parseArgs({ args: rest, options: { server: { type: 'string' }, code: { type: 'string' } } });
      if (!values.server || !values.code) throw new Error('Pakai: chefjuno login --server <url> --code XXXX-XXXX');
      const r = await exchangeCode(values.server, values.code);
      saveCreds({
        server: values.server,
        machineId: r.machineId,
        machineSecret: r.machineSecret,
        firebaseConfig: r.firebaseConfig,
      });
      console.log(
        `✅ Mesin terdaftar (id ${r.machineId}). Kredensial disimpan di ${cfg.home()}/credentials.json (0600).`,
      );
      console.log('Jalankan: chefjuno start');
      return;
    }
    case 'start': {
      const { values } = parseArgs({
        args: rest,
        options: {
          agents: { type: 'string' },
          'no-app': { type: 'boolean' },
          'no-auto-update': { type: 'boolean' },
        },
      });
      // proses induk = supervisor kecil yang menyalakan ulang daemon setelah pembaruan
      if (process.env.CHEFJUNO_SUPERVISED !== '1') {
        supervise(process.argv.slice(1));
        return;
      }
      const creds = loadCreds();
      if (!creds) throw new Error('Belum login. Jalankan: chefjuno login --server <url> --code XXXX-XXXX');
      const allowAgents = values.agents ? (values.agents.split(',').map((s) => s.trim()) as AgentName[]) : undefined;
      const root = repoRoot();
      const updater =
        values['no-auto-update'] || !root
          ? undefined
          : {
              head: () => headCommit(root),
              plan: (t: string) => planUpdate(root, t),
              apply: (p: { from: string; to: string }) =>
                applyUpdate(root, p, { npm: npmBin(), log: (m) => console.log(m) }),
              restart: () => process.exit(RESTART_CODE),
            };
      const d = new Daemon({ creds, allowAgents, handler: handleJob, noApp: values['no-app'] === true, updater });
      await d.start();
      if (!updater)
        console.log(
          root
            ? 'Pembaruan otomatis dimatikan (--no-auto-update).'
            : 'Bukan checkout git: pembaruan otomatis tidak aktif.',
        );
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        console.log('Mematikan mesin…');
        await d.stop();
        process.exit(0);
      };
      // supervisor mati tanpa sempat meneruskan sinyal (mis. SIGKILL) → jangan jadi proses yatim
      setInterval(() => {
        if (process.ppid === 1) void stop();
      }, 5000).unref();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return;
    }
    case 'status': {
      const creds = loadCreds();
      if (!creds) {
        console.log('Belum login di mesin ini.');
        return;
      }
      const s = await connect(creds);
      const m = await getDoc(doc(s.db, `machines/${creds.machineId}`));
      const st = machineStatus(
        {
          revoked: m.get('revoked'),
          lastSeenAtMs: m.get('lastSeenAt')?.toMillis?.() ?? null,
          currentJobIds: m.get('currentJobIds'),
          concurrency: m.get('concurrency'),
        },
        Date.now(),
      );
      console.log(`Mesin: ${m.get('name')} (${creds.machineId})`);
      console.log(`Status: ${MACHINE_STATUS_LABEL[st]}`);
      console.log(`Server: ${creds.server}`);
      const agents = (m.get('agents') ?? {}) as Record<
        string,
        { version: string; enabled: boolean; isolation: string }
      >;
      for (const [k, v] of Object.entries(agents))
        console.log(`Agent ${k}: ${v.version} · ${v.enabled ? 'aktif' : 'tidak dipakai'} · isolasi ${v.isolation}`);
      await s.close();
      process.exit(0);
      return;
    }
    case 'logout': {
      console.log(deleteCreds() ? '✅ Kredensial lokal dihapus.' : 'Tidak ada kredensial di mesin ini.');
      return;
    }
    case 'memory': {
      const { memoryCommand } = await import('./memory/cli.js');
      await memoryCommand(rest);
      return;
    }
    case 'graph-mcp': {
      const { runGraphMcp } = await import('./graph/mcp.js');
      await runGraphMcp(rest);
      return;
    }
    case 'memory-mcp': {
      const { runMemoryMcp } = await import('./memory/mcp.js');
      await runMemoryMcp(rest);
      return;
    }
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
