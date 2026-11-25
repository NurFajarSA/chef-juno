import { describe, expect, it } from 'vitest';
import { containerRunArgs, verificationSection } from '../../src/jobs/verify.js';

describe('verifikasi statis: argumen container dikunci', () => {
  it('analisis berjalan tanpa jaringan, tanpa capability, tanpa eskalasi, dengan batas sumber daya', () => {
    const a = containerRunArgs({
      image: 'ghcr.io/cirruslabs/flutter:stable',
      dir: '/tmp/job/verify/head',
      script: 'flutter analyze',
      network: false,
    });
    const at = (flag: string) => a[a.indexOf(flag) + 1];
    expect(a[0]).toBe('run');
    expect(a).toContain('--rm');
    expect(at('--network')).toBe('none');
    expect(at('--cap-drop')).toBe('ALL');
    expect(at('--security-opt')).toBe('no-new-privileges');
    expect(at('--memory')).toBe('4g');
    expect(at('--pids-limit')).toBe('512');
    expect(at('-v')).toBe('/tmp/job/verify/head:/src');
    // tidak ada env yang diteruskan ke container dan tidak ada mount lain
    expect(a).not.toContain('-e');
    expect(a).not.toContain('--env');
    expect(a.filter((x) => x === '-v')).toHaveLength(1);
    expect(a.slice(-3)).toEqual(['sh', '-c', 'flutter analyze']);
  });
  it('setup boleh berjaringan (unduh dependensi), tetap tanpa capability', () => {
    const a = containerRunArgs({ image: 'img', dir: '/x', script: 'flutter pub get', network: true });
    expect(a[a.indexOf('--network') + 1]).toBe('bridge');
    expect(a[a.indexOf('--cap-drop') + 1]).toBe('ALL');
  });
  it('bagian prompt: kosong bila tidak dijalankan; menyebut masalah baru bila ada', () => {
    expect(verificationSection({ ran: false, reason: 'x' })).toBe('');
    const s = verificationSection({
      ran: true,
      image: 'img',
      commands: ['flutter analyze'],
      newIssues: ['warning • x • lib/a.dart:3 • y'],
    });
    expect(s).toContain('baru muncul di PR ini');
    expect(s).toContain('lib/a.dart:3');
    expect(verificationSection({ ran: true, image: 'img', commands: ['a'], newIssues: [] })).toContain(
      'Tidak ada masalah baru',
    );
  });
});
