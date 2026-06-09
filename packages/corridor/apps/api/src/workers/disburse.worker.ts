import { Worker } from 'bullmq';
import { redis } from '../jobs/queue.js';
import { disbursementService } from '../services/disbursement.service.js';
import { smsService } from '../services/sms.service.js';
import { db } from '../db/index.js';
import { transfers, recipients, senders } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const disburseWorker = new Worker(
  'corridor-disburse',
  async (job) => {
    const { transfer_id } = job.data as { transfer_id: string };

    const transfer = await db.query.transfers.findFirst({ where: eq(transfers.id, transfer_id) });
    if (!transfer) throw new Error(`Transfer ${transfer_id} not found`);
    if (transfer.status !== 'swap_complete') {
      console.warn(`[disburse] Transfer ${transfer_id} not in swap_complete: ${transfer.status}`);
      return;
    }

    const recipient = await db.query.recipients.findFirst({ where: eq(recipients.id, transfer.recipientId) });
    if (!recipient) throw new Error(`Recipient not found for transfer ${transfer_id}`);

    await db.update(transfers).set({ status: 'disbursing' }).where(eq(transfers.id, transfer_id));

    try {
      const bankCode = recipient.bankCode || '014'; // fallback BCA
      const { redeemRequestId } = await disbursementService.createRedeemRequest({
        transferId: transfer_id,
        xidrAmount: Math.round(parseFloat(transfer.xidrAmount)),
        recipientBankCode: bankCode,
        recipientAccountNumber: recipient.accountNumber,
        recipientName: recipient.fullName,
      });

      await db.update(transfers).set({ redeemRequestId }).where(eq(transfers.id, transfer_id));
      // Status moves to 'completed' only when Fix 3 webhook fires (corridor-redeem webhook)
    } catch (err) {
      // CRITICAL: XIDR has been swapped but IDR not sent — do NOT retry, alert ops
      console.error(`[disburse] CRITICAL: Disbursement failed for ${transfer_id} after swap:`, err);
      await db.update(transfers).set({
        status: 'failed',
        failureReason: `Disbursement failed after swap: ${(err as Error).message}`,
      }).where(eq(transfers.id, transfer_id));

      const sender = await db.query.senders.findFirst({ where: eq(senders.id, transfer.senderId) });
      if (sender) {
        await smsService.sendTransferFailedSMS(sender.phoneNumber, transfer_id, 'Bank transfer initiation failed — our team is investigating');
      }
      // Do NOT re-throw — this job should NOT be retried (funds could double-disburse)
    }
  },
  { connection: redis, concurrency: 1 } // serial for safety
);
