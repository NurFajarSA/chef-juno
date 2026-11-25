import { DestroyRef, effect, inject, signal, type Signal } from '@angular/core';
import { onSnapshot, type DocumentReference, type Query, type DocumentData } from 'firebase/firestore';

export interface Live<T> {
  loading: boolean;
  data: T;
  error: string | null;
}

/**
 * Query Firestore realtime → signal (wajib untuk OnPush + zoneless).
 * `source` dievaluasi ulang di dalam effect; ganti dependency → subscribe ulang.
 * Harus dipanggil di injection context.
 */
export function liveQuery<T>(source: () => Query<DocumentData> | null, map: (id: string, d: DocumentData) => T): Signal<Live<T[]>> {
  const out = signal<Live<T[]>>({ loading: true, data: [], error: null });
  const destroy = inject(DestroyRef);
  let unsub: (() => void) | null = null;
  effect((onCleanup) => {
    const q = source();
    if (!q) {
      out.set({ loading: false, data: [], error: null });
      return;
    }
    out.update((v) => ({ ...v, loading: true }));
    unsub = onSnapshot(
      q,
      (snap) => out.set({ loading: false, data: snap.docs.map((d) => map(d.id, d.data())), error: null }),
      (err) => out.set({ loading: false, data: [], error: pesanError(err) }),
    );
    onCleanup(() => unsub?.());
  });
  destroy.onDestroy(() => unsub?.());
  return out.asReadonly();
}

export function liveDoc<T>(source: () => DocumentReference<DocumentData> | null, map: (id: string, d: DocumentData) => T): Signal<Live<T | null>> {
  const out = signal<Live<T | null>>({ loading: true, data: null, error: null });
  const destroy = inject(DestroyRef);
  let unsub: (() => void) | null = null;
  effect((onCleanup) => {
    const r = source();
    if (!r) {
      out.set({ loading: false, data: null, error: null });
      return;
    }
    unsub = onSnapshot(
      r,
      (snap) => out.set({ loading: false, data: snap.exists() ? map(snap.id, snap.data()) : null, error: null }),
      (err) => out.set({ loading: false, data: null, error: pesanError(err) }),
    );
    onCleanup(() => unsub?.());
  });
  destroy.onDestroy(() => unsub?.());
  return out.asReadonly();
}

export function pesanError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code.includes('permission-denied')) return 'Tidak punya izin membaca data ini.';
  if (code.includes('unavailable')) return 'Server tidak bisa dihubungi. Coba lagi.';
  return (err as { message?: string })?.message ?? 'Terjadi kesalahan.';
}
