import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const swapQueue = new Queue('corridor-swap', { connection: redis });
export const disburseQueue = new Queue('corridor-disburse', { connection: redis });
export const rateCacheQueue = new Queue('corridor-rate-cache', { connection: redis });

export async function scheduleRateRefresh() {
  await rateCacheQueue.add('refresh', {}, {
    repeat: { every: 60000 },
    jobId: 'rate-cache-recurring',
  });
}
