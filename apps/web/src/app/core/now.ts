import { DestroyRef, inject, signal } from '@angular/core';

/** Signal waktu sekarang yang berdetak (untuk status mesin yang dihitung, §12.7). */
export function nowSignal(intervalMs = 10_000) {
  const now = signal(Date.now());
  const id = setInterval(() => now.set(Date.now()), intervalMs);
  inject(DestroyRef).onDestroy(() => clearInterval(id));
  return now.asReadonly();
}
