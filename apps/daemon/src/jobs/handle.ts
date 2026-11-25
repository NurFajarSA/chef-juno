import type { JobContext } from '../daemon.js';
import { runReviewJob } from './review.js';
import { runIndexJob } from './index-job.js';
import { runTextJob } from './learn-job.js';
import { runAppVerifyJob } from './app-verify-job.js';

export async function handleJob(ctx: JobContext): Promise<void> {
  switch (ctx.job.type) {
    case 'review':
      return runReviewJob(ctx);
    case 'index':
      return runIndexJob(ctx);
    case 'learn':
      return runTextJob(ctx, 'learn');
    case 'recap':
      return runTextJob(ctx, 'recap');
    case 'app-verify':
      return runAppVerifyJob(ctx);
    default:
      throw Object.assign(new Error(`Tipe job ${ctx.job.type} belum didukung`), { stage: 'daemon' });
  }
}
