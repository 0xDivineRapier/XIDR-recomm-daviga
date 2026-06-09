import { Worker } from 'bullmq';
import { redis } from '../jobs/queue.js';
import { FxRateService } from '../services/fx-rate.service.js';

const fxRateService = new FxRateService(redis);

let lastRate: number | null = null;

export const rateCacheWorker = new Worker(
  'corridor-rate-cache',
  async () => {
    const snapshot = await fxRateService.refreshRate();
    if (!snapshot) return;

    if (lastRate !== null) {
      const changePct = Math.abs((snapshot.effectiveRate - lastRate) / lastRate);
      if (changePct > 0.02) {
        console.warn(`[rate-cache] Rate moved ${(changePct * 100).toFixed(2)}% — ops alert needed`);
        // TODO: integrate notification service if needed
      }
    }
    lastRate = snapshot.effectiveRate;
    console.log(`[rate-cache] Rate updated: 1 SGD = ${snapshot.effectiveRate.toFixed(2)} IDR (${snapshot.source})`);
  },
  { connection: redis }
);
