import { Worker } from 'bullmq';
import { redis } from '../jobs/queue.js';
import { reserveService } from '../services/reserve.service.js';
import { notificationService } from '../services/notification.service.js';
import { db } from '../db/index.js';
import { reserveAttestations } from '../db/schema.js';
import { desc } from 'drizzle-orm';

export const reserveSyncWorker = new Worker(
  'reserve-sync',
  async () => {
    const { totalSupply } = await reserveService.getTotalSupply();
    const latest = await db.query.reserveAttestations.findFirst({
      orderBy: [desc(reserveAttestations.attestedAt)],
    });

    if (!latest) {
      console.log('[reserve-sync] No attestation found, skipping comparison');
      return;
    }

    const lastAttested = BigInt(latest.xidrTotalSupply);
    if (lastAttested === 0n) return;

    const changePct = Number((totalSupply - lastAttested) * 10000n / lastAttested) / 100;
    const absChange = Math.abs(changePct);

    if (absChange > 1) {
      console.log(`[reserve-sync] Supply changed ${changePct.toFixed(2)}% — alerting compliance team`);
      await notificationService.sendReserveDiscrepancyEmail({
        currentSupply: totalSupply.toString(),
        lastAttestedSupply: lastAttested.toString(),
        changePercent: changePct,
      });
    } else {
      console.log(`[reserve-sync] Supply change ${changePct.toFixed(2)}% within threshold`);
    }
  },
  { connection: redis }
);

reserveSyncWorker.on('failed', (job, err) => {
  console.error(`[reserve-sync] Job ${job?.id} failed:`, err.message);
});
