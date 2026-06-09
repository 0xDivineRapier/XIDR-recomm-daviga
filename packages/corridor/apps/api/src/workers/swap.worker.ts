import { Worker } from 'bullmq';
import { redis, disburseQueue } from '../jobs/queue.js';
import { swapService } from '../services/swap.service.js';
import { smsService } from '../services/sms.service.js';
import { db } from '../db/index.js';
import { transfers, senders } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const swapWorker = new Worker(
  'corridor-swap',
  async (job) => {
    const { transfer_id } = job.data as { transfer_id: string };

    const transfer = await db.query.transfers.findFirst({ where: eq(transfers.id, transfer_id) });
    if (!transfer) throw new Error(`Transfer ${transfer_id} not found`);
    if (transfer.status !== 'payment_received') {
      console.warn(`[swap] Transfer ${transfer_id} not in payment_received state: ${transfer.status}`);
      return;
    }

    await db.update(transfers).set({ status: 'swapping' }).where(eq(transfers.id, transfer_id));

    try {
      const xsgdAmount = BigInt(Math.round(parseFloat(transfer.sgdNet)));
      const xidrExpected = BigInt(Math.round(parseFloat(transfer.xidrAmount)));
      const minXidrOut = (xidrExpected * 995n) / 1000n; // 0.5% slippage
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min

      const { txHash, xidrReceived } = await swapService.executeSwap({
        transferId: transfer_id,
        xsgdAmount,
        minXidrOut,
        deadline,
      });

      await db.update(transfers).set({
        status: 'swap_complete',
        swapTxHash: txHash,
        xidrAmount: xidrReceived.toString(),
        swapCompletedAt: new Date(),
      }).where(eq(transfers.id, transfer_id));

      await disburseQueue.add('disburse', { transfer_id }, { attempts: 1 });
    } catch (err) {
      console.error(`[swap] Swap failed for ${transfer_id}:`, err);
      await db.update(transfers).set({
        status: 'failed',
        failureReason: `Swap failed: ${(err as Error).message}`,
      }).where(eq(transfers.id, transfer_id));

      // Notify sender
      const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
      if (sender) {
        await smsService.sendTransferFailedSMS(sender.phoneNumber, transfer_id, 'Currency conversion failed');
      }
      throw err;
    }
  },
  { connection: redis, concurrency: 2 }
);
