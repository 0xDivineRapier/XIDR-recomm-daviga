import { Worker } from 'bullmq';
import { redis } from '../jobs/queue.js';
import { amlService } from '../services/aml.service.js';
import { notificationService } from '../services/notification.service.js';
import { blocklistService } from '../services/blocklist.service.js';
import { db } from '../db/index.js';
import { transactions, amlAlerts, blocklistSyncLog } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const amlScreeningWorker = new Worker(
  'aml-screening',
  async (job) => {
    const { transactionId, txHash } = job.data as {
      transactionId: string;
      txHash: string;
      alertId?: string;
    };

    const tx = await db.query.transactions.findFirst({ where: eq(transactions.id, transactionId) });
    if (!tx) throw new Error(`Transaction ${transactionId} not found`);

    const result = await amlService.registerTransaction({
      txHash,
      asset: 'XIDR',
      network: tx.chainId === 8453 ? 'BASE' : 'BASE_TESTNET',
      direction: 'sent',
      address: tx.fromAddress,
      amount: tx.amount,
    });

    const riskScore = result.riskScore || 0;
    let amlStatus: 'cleared' | 'flagged' | 'blocked' = 'cleared';

    if (riskScore > 90) {
      amlStatus = 'blocked';
      // Auto-block the wallet on-chain
      try {
        const blockTxHash = await blocklistService.blockAddress(tx.fromAddress);
        await db.insert(blocklistSyncLog).values({
          walletAddress: tx.fromAddress,
          action: 'block',
          reason: `Auto-blocked: critical AML risk score ${riskScore}`,
          txHash: blockTxHash,
          initiatedBy: null, // system action
        });
        console.log(`[aml-screening] Auto-blocked ${tx.fromAddress} (score=${riskScore})`);
      } catch (e) {
        console.error('[aml-screening] Failed to auto-block address:', e);
      }
    } else if (riskScore > 70) {
      amlStatus = 'flagged';
    }

    await db.update(transactions)
      .set({ riskScore, amlStatus, screenedAt: new Date() })
      .where(eq(transactions.id, transactionId));

    if (riskScore > 70) {
      const severity: 'high' | 'critical' = riskScore > 90 ? 'critical' : 'high';
      await db.insert(amlAlerts).values({
        transactionId,
        alertType: 'risk_score',
        severity,
        chainalysisData: { riskScore, txHash },
        status: 'open',
      });
      await notificationService.sendAmlAlertEmail({
        txHash,
        severity,
        alertType: 'risk_score',
        riskScore,
      });
      console.log(`[aml-screening] Created ${severity} alert for tx ${txHash} (score=${riskScore})`);
    } else {
      console.log(`[aml-screening] Cleared tx ${txHash} (score=${riskScore})`);
    }
  },
  { connection: redis }
);

amlScreeningWorker.on('failed', (job, err) => {
  console.error(`[aml-screening] Job ${job?.id} failed:`, err.message);
});
