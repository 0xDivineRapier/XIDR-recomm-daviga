import { swapWorker } from './swap.worker.js';
import { disburseWorker } from './disburse.worker.js';
import { rateCacheWorker } from './rate-cache.worker.js';
import { scheduleRateRefresh } from '../jobs/queue.js';

await scheduleRateRefresh();

console.log('[workers] swap worker started');
console.log('[workers] disburse worker started');
console.log('[workers] rate-cache worker started');

process.on('SIGTERM', async () => {
  await Promise.all([
    swapWorker.close(),
    disburseWorker.close(),
    rateCacheWorker.close(),
  ]);
  process.exit(0);
});
