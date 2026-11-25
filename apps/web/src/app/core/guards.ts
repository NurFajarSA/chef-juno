import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { doc, getDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { FirebaseService } from './firebase';

export const memberGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ready();
  if (!user) return router.parseUrl('/login');
  const m = await auth.ensureMembership();
  return m.member ? true : router.parseUrl('/no-access');
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ready();
  if (!user) return router.parseUrl('/login');
  const m = await auth.ensureMembership();
  if (!m.member) return router.parseUrl('/no-access');
  return m.role === 'admin' ? true : router.parseUrl('/');
};

/**
 * Instalasi baru: admin diarahkan ke onboarding (/setup) selama setup belum selesai.
 * "Belum selesai" = settings/global belum ada, atau onboarding.completedAt masih null (dibuat setupWorkspace init).
 * Instalasi lama (settings tanpa field onboarding) dianggap sudah selesai.
 */
export const setupGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const fb = inject(FirebaseService);
  const router = inject(Router);
  const m = await auth.ensureMembership();
  if (!m.member || m.role !== 'admin') return true;
  try {
    const s = await getDoc(doc(fb.db, 'settings/global'));
    const needsSetup = !s.exists() || s.get('onboarding.completedAt') === null;
    return needsSetup ? router.parseUrl('/setup') : true;
  } catch {
    return true; // gagal membaca setting tidak boleh mengunci dashboard
  }
};
