#!/usr/bin/env node
// Fake Codex CLI: meniru `codex exec --json -o <file> --output-schema <file>` (JSONL event + file hasil).
// Menolak flag yang tidak ada di fixtures/codex-exec-help.txt. Env: FAKE_CODEX_AUTH, FAKE_AGENT_MODE, FAKE_AGENT_RECORD_DIR.
import { readFileSync, writeFileSync } from 'node:fs';
import { argValue, flagsFromHelp, outputFor, readStdin, record, validateArgs } from './fake-common.mjs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write(readFileSync(new URL('./fixtures/codex-version.txt', import.meta.url), 'utf8'));
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  const mode = process.env.FAKE_CODEX_AUTH ?? 'chatgpt';
  process.stderr.write(
    mode === 'api-key'
      ? 'Logged in using an API key - sk-proj-***\n'
      : mode === 'none'
        ? 'Not logged in\n'
        : 'Logged in using ChatGPT\n',
  );
  process.exit(mode === 'none' ? 1 : 0);
}
if (args[0] !== 'exec') {
  process.stderr.write('fake-codex: hanya `exec` yang didukung\n');
  process.exit(2);
}
const rest = args.slice(1);
validateArgs(rest, flagsFromHelp('codex-exec-help.txt'));
for (const bad of ['--dangerously-bypass-approvals-and-sandbox', '--full-auto']) {
  if (rest.includes(bad)) {
    process.stderr.write(`fake-codex: ${bad} dilarang\n`);
    process.exit(3);
  }
}
const prompt = readStdin();
const schemaPath = argValue(rest, '--output-schema');
const outPath = argValue(rest, '-o', '--output-last-message');
const schema = schemaPath ? JSON.parse(readFileSync(schemaPath, 'utf8')) : {};
record('codex', {
  argv: args,
  prompt,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null, CODEX_API_KEY: process.env.CODEX_API_KEY ?? null },
});
const mode = process.env.FAKE_AGENT_MODE ?? 'ok';
if (mode === 'fail') process.exit(1);
const out = mode === 'bad-json' ? { nope: true } : outputFor(schema, prompt);
const ev = (o) => process.stdout.write(JSON.stringify(o) + '\n');
ev({ type: 'thread.started', thread_id: 'fake-thread' });
ev({ type: 'turn.started' });
ev({ type: 'item.completed', item: { id: 'item_r', type: 'reasoning', text: 'Fake Codex: memeriksa diff dulu.' } });
ev({
  type: 'item.completed',
  item: {
    id: 'item_c',
    type: 'command_execution',
    command: 'git diff --stat',
    aggregated_output: 'OUTPUT TIDAK DICATAT',
    exit_code: 0,
  },
});
ev({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(out) } });
ev({ type: 'turn.completed', usage: { input_tokens: 2100, cached_input_tokens: 0, output_tokens: 410 } });
if (outPath) writeFileSync(outPath, JSON.stringify(out));
