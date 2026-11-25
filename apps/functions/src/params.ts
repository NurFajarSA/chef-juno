import { defineList, defineSecret, defineString } from 'firebase-functions/params';

export const GITHUB_APP_ID = defineSecret('GITHUB_APP_ID');
export const GITHUB_APP_PRIVATE_KEY = defineSecret('GITHUB_APP_PRIVATE_KEY');
export const GITHUB_WEBHOOK_SECRET = defineSecret('GITHUB_WEBHOOK_SECRET');
export const BOOTSTRAP_ADMIN_GITHUB_IDS = defineList('BOOTSTRAP_ADMIN_GITHUB_IDS', { default: [] });
export const FUNCTIONS_SA = defineString('FUNCTIONS_SA');
/** Slug GitHub App (github.com/apps/<slug>) untuk tombol "Pasang GitHub App" di onboarding. */
export const GITHUB_APP_SLUG = defineString('GITHUB_APP_SLUG', { default: '' });
/** URL dashboard (mis. https://chefjuno.web.app) untuk tautan bukti di komentar PR; kosong = tanpa tautan. */
export const DASHBOARD_URL = defineString('DASHBOARD_URL', { default: '' });
/** API key config Firebase web (publik, bukan rahasia) untuk daemon; wajib di produksi. */
export const WEB_API_KEY = defineString('WEB_API_KEY', { default: '' });

export const githubApiUrl = () => process.env.GITHUB_API_URL || 'https://api.github.com';
export const offlineAfterMs = () => Number(process.env.OFFLINE_AFTER_MS || 90_000);
