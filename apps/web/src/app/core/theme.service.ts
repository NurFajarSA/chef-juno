import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = 'cj-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(this.load());

  constructor() {
    this.apply(this.mode());
  }

  private load(): ThemeMode {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  }

  isDark(): boolean {
    const m = this.mode();
    if (m === 'system') return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
    return m === 'dark';
  }

  toggle() {
    this.set(this.isDark() ? 'light' : 'dark');
  }

  set(m: ThemeMode) {
    this.mode.set(m);
    try {
      if (m === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, m);
    } catch {
      // abaikan (mode privat)
    }
    this.apply(m);
  }

  private apply(m: ThemeMode) {
    const el = document.documentElement;
    el.classList.toggle('theme-light', m === 'light');
    el.classList.toggle('theme-dark', m === 'dark');
  }
}
