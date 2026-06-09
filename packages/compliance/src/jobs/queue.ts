import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const kycReviewQueue = new Queue('kyc-review', { connection: redis });
export const amlScreeningQueue = new Queue('aml-screening', { connection: redis });
export const reserveSyncQueue = new Queue('reserve-sync', { connection: redis });

// Schedule reserve-sync to run every hour
export async function scheduleReserveSync() {
  await reserveSyncQueue.add(
    'sync',
    {},
    {
      repeat: { every: 3600000 },
      jobId: 'reserve-sync-recurring',
    }
  );
}
