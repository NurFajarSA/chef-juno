#!/usr/bin/env node
// Fake Claude Code: meniru bentuk output `claude -p --output-format json --json-schema` persis.
// Menolak flag yang tidak ada di fixtures/claude-help.txt (§12.8). Env: FAKE_CLAUDE_AUTH, FAKE_AGENT_MODE, FAKE_AGENT_RECORD_DIR.
import { readFileSync } from 'node:fs';
import { argValue, flagsFromHelp, outputFor, readStdin, record, validateArgs } from './fake-common.mjs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(readFileSync(new URL('./fixtures/claude-version.txt', import.meta.url), 'utf8'));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  const mode = process.env.FAKE_CLAUDE_AUTH ?? 'claude.ai';
  const out =
    mode === 'none'
      ? { loggedIn: false }
      : { loggedIn: true, authMethod: mode === 'api-key' ? 'api_key' : 'claude.ai', apiProvider: 'firstParty' };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}
if (args[0] === '--help') {
  process.stdout.write(
    readFileSync(new URL(`./fixtures/${process.env.FAKE_CLAUDE_HELP ?? 'claude-help.txt'}`, import.meta.url), 'utf8'),
  );
  process.exit(0);
}
validateArgs(args, flagsFromHelp(process.env.FAKE_CLAUDE_HELP ?? 'claude-help.txt'));
if (!args.includes('-p') && !args.includes('--print')) {
  process.stderr.write('fake-claude: hanya mode -p yang didukung\n');
  process.exit(2);
}
if (args.includes('--bare')) {
  process.stderr.write('fake-claude: --bare dilarang (memaksa API key)\n');
  process.exit(3);
}
const prompt = readStdin();
const schema = JSON.parse(argValue(args, '--json-schema') ?? '{}');
const system = argValue(args, '--append-system-prompt') ?? '';
record('claude', {
  argv: args,
  prompt,
  system,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null },
});
const mode = process.env.FAKE_AGENT_MODE ?? 'ok';
if (mode === 'slow') await new Promise((r) => setTimeout(r, 60_000));
if (mode === 'fail') {
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 40 }) + '\n',
  );
  process.exit(1);
}
const structured = mode === 'bad-json' ? { nope: true } : outputFor(schema, prompt, system);
// --output-format stream-json: event per baris (seperti Claude Code sungguhan) sebelum baris hasil
if (argValue(args, '--output-format') === 'stream-json') {
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  line({ type: 'system', subtype: 'init', session_id: 'fake' });
  line({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'thinking',
          thinking:
            'Fake: menelusuri pemanggil fetchUser sebelum memutuskan. token=ghp_abcdefghijklmnopqrstuvwxyz123456',
        },
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/api/user.ts' } },
      ],
    },
  });
  line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ISI FILE RAHASIA TIDAK DICATAT' }] } });
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fake: keputusan — temuan dilaporkan.' }] } });
}
const model = argValue(args, '--model') ?? 'claude-sonnet-4-6';
process.stdout.write(
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    duration_api_ms: 1100,
    // body PR berisi FAKE_SHALLOW → jawab tanpa menelusuri (1 giliran), kecuali setelah ditegur (FAKE_SHALLOW_ALWAYS: tetap dangkal)
    num_turns:
      prompt.includes('FAKE_SHALLOW_ALWAYS') ||
      (prompt.includes('FAKE_SHALLOW') && !system.includes('PERHATIAN: percobaan sebelumnya'))
        ? 1
        : 4,
    result: JSON.stringify(structured),
    session_id: '00000000-0000-0000-0000-000000000000',
    total_cost_usd: 0,
    usage: { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 340 },
    modelUsage: { [model]: { inputTokens: 1200, outputTokens: 340 } },
    structured_output: structured,
  }) + '\n',
);
