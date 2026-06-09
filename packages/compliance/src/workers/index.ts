import { kycReviewWorker } from './kyc-review.worker.js';
import { amlScreeningWorker } from './aml-screening.worker.js';
import { reserveSyncWorker } from './reserve-sync.worker.js';
import { scheduleReserveSync } from '../jobs/queue.js';

scheduleReserveSync().then(() => {
  console.log('[workers] Reserve sync scheduled');
}).catch((err) => {
  console.error('[workers] Failed to schedule reserve sync:', err);
});

console.log('[workers] KYC review worker started');
console.log('[workers] AML screening worker started');
console.log('[workers] Reserve sync worker started');

process.on('SIGTERM', async () => {
  console.log('[workers] Shutting down...');
  await Promise.all([
    kycReviewWorker.close(),
    amlScreeningWorker.close(),
    reserveSyncWorker.close(),
  ]);
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[workers] Shutting down (SIGINT)...');
  await Promise.all([
    kycReviewWorker.close(),
    amlScreeningWorker.close(),
    reserveSyncWorker.close(),
  ]);
  process.exit(0);
});
