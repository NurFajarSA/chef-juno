import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { adminGuard, memberGuard, setupGuard } from './core/guards';
import { Shell } from './shell';
import { LoginPage } from './pages/login';
import { NoAccessPage } from './pages/no-access';

export const routes: Routes = [
  { path: 'login', component: LoginPage, title: 'Masuk · Chef Juno' },
  { path: 'no-access', component: NoAccessPage, title: 'Tidak punya akses · Chef Juno' },
  { path: 'setup', canActivate: [adminGuard], loadComponent: () => import('./pages/onboarding').then((m) => m.OnboardingPage), title: 'Setup · Chef Juno' },
  {
    path: '',
    component: Shell,
    canActivate: [memberGuard, setupGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'reviews' },
      { path: 'reviews', loadComponent: () => import('./pages/reviews').then((m) => m.ReviewsPage), title: 'Review Kode · Chef Juno' },
      { path: 'reviews/:jobId', loadComponent: () => import('./pages/review-detail').then((m) => m.ReviewDetailPage), title: 'Detail review · Chef Juno' },
      { path: 'analytics', loadComponent: () => import('./pages/analytics').then((m) => m.AnalyticsPage), title: 'Analitik · Chef Juno', data: { tab: 'pr' } },
      { path: 'analytics/temuan', loadComponent: () => import('./pages/analytics').then((m) => m.AnalyticsPage), title: 'Temuan · Chef Juno', data: { tab: 'temuan' } },
      { path: 'analytics/biaya', loadComponent: () => import('./pages/analytics').then((m) => m.AnalyticsPage), title: 'Biaya & waktu · Chef Juno', data: { tab: 'biaya' } },
      { path: 'analytics/skills', loadComponent: () => import('./pages/analytics').then((m) => m.AnalyticsPage), title: 'Analitik Skills · Chef Juno', data: { tab: 'skills' } },
      { path: 'analytics/dampak', loadComponent: () => import('./pages/analytics').then((m) => m.AnalyticsPage), title: 'Dampak · Chef Juno', data: { tab: 'dampak' } },
      { path: 'findings', redirectTo: 'analytics/temuan' },
      { path: 'kb', loadComponent: () => import('./pages/kb').then((m) => m.KbPage), title: 'Knowledge Base · Chef Juno' },
      { path: 'kb/:repoId', loadComponent: () => import('./pages/kb').then((m) => m.KbPage), title: 'Knowledge Base · Chef Juno' },
      { path: 'kb/:repoId/:moduleId', loadComponent: () => import('./pages/kb').then((m) => m.KbPage), title: 'Knowledge Base · Chef Juno' },
      { path: 'repos', loadComponent: () => import('./pages/repos').then((m) => m.ReposPage), title: 'Repositori · Chef Juno' },
      { path: 'repos/:repoId', redirectTo: 'kb/:repoId' },
      { path: 'machines', loadComponent: () => import('./pages/machines').then((m) => m.MachinesPage), title: 'Mesin · Chef Juno' },
      { path: 'docs', loadComponent: () => import('./pages/docs').then((m) => m.DocsPage), title: 'Panduan · Chef Juno' },
      { path: 'docs/:slug', loadComponent: () => import('./pages/docs').then((m) => m.DocsPage), title: 'Panduan · Chef Juno' },
      { path: 'skills', loadComponent: () => import('./pages/skills-editor').then((m) => m.SkillsEditorPage), title: 'Skills · Chef Juno' },
      { path: 'skills/:slug', redirectTo: ({ params }) => inject(Router).createUrlTree(['/skills'], { queryParams: { f: `skills/${params['slug']}/SKILL.md` } }) },
      { path: 'prompts', pathMatch: 'full', redirectTo: 'skills' },
      { path: 'prompts/:key', redirectTo: ({ params }) => inject(Router).createUrlTree(['/skills'], { queryParams: { f: `core/${params['key']}.md` } }) },
      { path: 'memory', loadComponent: () => import('./pages/memory').then((m) => m.MemoryPage), title: 'Memory · Chef Juno' },
      { path: 'rapor', loadComponent: () => import('./pages/rapor').then((m) => m.RaporPage), title: 'Rapor · Chef Juno' },
      { path: 'rapor/:login', loadComponent: () => import('./pages/rapor-person').then((m) => m.RaporPersonPage), title: 'Rapor · Chef Juno' },
      { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage), title: 'Pengaturan · Chef Juno' },
      { path: 'settings/:section', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage), title: 'Pengaturan · Chef Juno' },
    ],
  },
  { path: '**', redirectTo: '' },
];
