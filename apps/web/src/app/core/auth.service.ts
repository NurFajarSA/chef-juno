import { Injectable, computed, inject, signal } from '@angular/core';
import { GithubAuthProvider, onAuthStateChanged, signInWithCustomToken, signInWithPopup, signOut, type User } from 'firebase/auth';
import { FirebaseService } from './firebase';

export interface Membership {
  member: boolean;
  role: 'admin' | 'member' | null;
  githubLogin: string | null;
  githubUserId: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly fb = inject(FirebaseService);
  readonly user = signal<User | null>(null);
  readonly membership = signal<Membership | null>(null);
  readonly isAdmin = computed(() => this.membership()?.role === 'admin');
  private syncing: Promise<Membership> | null = null;

  constructor() {
    onAuthStateChanged(this.fb.auth, (u) => {
      // status anggota terikat ke uid: ganti akun (atau keluar) → hitung ulang
      if (!u || u.uid !== this.user()?.uid) {
        this.membership.set(null);
        this.syncing = null;
      }
      this.user.set(u);
    });
  }

  async ready(): Promise<User | null> {
    await this.fb.auth.authStateReady();
    const u = this.fb.auth.currentUser;
    if (u?.uid !== this.user()?.uid) {
      this.membership.set(null);
      this.syncing = null;
    }
    this.user.set(u);
    return u;
  }

  /** Panggil syncMembership sekali per sesi lalu refresh ID token supaya claim `cj` terbaca rules. */
  ensureMembership(): Promise<Membership> {
    if (this.membership()) return Promise.resolve(this.membership()!);
    if (!this.syncing) {
      this.syncing = (async () => {
        const u = this.fb.auth.currentUser;
        if (!u) return { member: false, role: null, githubLogin: null, githubUserId: null };
        let login: string | null = null;
        try {
          const r = await this.fb.call<unknown, { member: boolean; role?: 'admin' | 'member'; githubLogin: string | null }>(
            'syncMembership',
          )({});
          login = r.githubLogin;
        } catch {
          // fallback ke claim yang ada
        }
        const t = await u.getIdTokenResult(true);
        const cj = t.claims['cj'];
        const m: Membership = {
          member: cj === 'admin' || cj === 'member',
          role: cj === 'admin' || cj === 'member' ? cj : null,
          githubLogin: login,
          githubUserId: typeof t.claims['cjGh'] === 'string' ? (t.claims['cjGh'] as string) : null,
        };
        this.membership.set(m);
        return m;
      })().finally(() => (this.syncing = null));
    }
    return this.syncing;
  }

  async signInWithGithub() {
    await signInWithPopup(this.fb.auth, new GithubAuthProvider());
  }

  /** Khusus emulator/test: login dengan custom token. */
  async signInWithToken(token: string) {
    if (!this.fb.emulator) throw new Error('Hanya tersedia di emulator.');
    await signInWithCustomToken(this.fb.auth, token);
  }

  async signOut() {
    await signOut(this.fb.auth);
  }
}
