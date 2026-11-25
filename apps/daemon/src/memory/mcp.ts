import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCreds } from '../creds.js';
import { connect } from '../fb.js';
import {
  applicableRules,
  loadActiveRules,
  loadPerson,
  precheckDiff,
  topMistakes,
  type PersonData,
  type RuleData,
} from './data.js';

export interface MemorySource {
  rules(): Promise<RuleData[]>;
  person(login: string): Promise<PersonData>;
}

/** Tool memori tim (§6.8): dipisah dari transport supaya bisa dites langsung. */
export function memoryTools(src: MemorySource) {
  return {
    get_team_rules: {
      description: 'Aturan tim aktif untuk repo (global + repo).',
      input: { repo: z.string().optional(), paths: z.array(z.string()).optional() },
      run: async (a: { repo?: string; paths?: string[] }) =>
        applicableRules(await src.rules(), a.repo ?? null, a.paths ?? []).map((r) => ({
          id: r.id,
          text: r.text,
          category: r.category,
          paths: r.scope.paths,
        })),
    },
    get_my_lessons: {
      description: 'Kesalahan yang sering kamu ulangi + pelajaran terbaru dari review Chef Juno.',
      input: { login: z.string() },
      run: async (a: { login: string }) => {
        const p = await src.person(a.login);
        return { recurringMistakes: topMistakes(p, 10), lessons: p.lessons.slice(0, 10) };
      },
    },
    precheck_diff: {
      description: 'Cocokkan diff lokal dengan kesalahan yang sering diulang (tanpa LLM) sebelum membuka PR.',
      input: { diff: z.string(), login: z.string() },
      run: async (a: { diff: string; login: string }) =>
        precheckDiff(a.diff, (await src.person(a.login)).recurringMistakes),
    },
  };
}

export async function runMemoryMcp(_args: string[]) {
  const creds = loadCreds();
  if (!creds) throw new Error('Belum login. Jalankan: chefjuno login --server <url> --code XXXX-XXXX');
  const s = await connect(creds);
  const tools = memoryTools({ rules: () => loadActiveRules(s.db), person: (l) => loadPerson(s.db, l) });
  const server = new McpServer({ name: 'chefjuno_memory', version: '0.1.0' });
  for (const [name, t] of Object.entries(tools)) {
    server.registerTool(
      name,
      { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true } },
      async (a: unknown) => ({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(await (t.run as (x: unknown) => Promise<unknown>)(a), null, 1),
          },
        ],
      }),
    );
  }
  await server.connect(new StdioServerTransport());
}
