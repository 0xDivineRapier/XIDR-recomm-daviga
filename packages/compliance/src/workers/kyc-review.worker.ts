import { Worker } from 'bullmq';
import { redis } from '../jobs/queue.js';
import { kycService } from '../services/kyc.service.js';
import { notificationService } from '../services/notification.service.js';
import { db } from '../db/index.js';
import { users, kycSubmissions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const kycReviewWorker = new Worker(
  'kyc-review',
  async (job) => {
    const { userId, kycSubmissionId, personaInquiryId } = job.data as {
      userId: string;
      kycSubmissionId: string;
      personaInquiryId: string;
    };

    const inquiry = await kycService.getInquiry(personaInquiryId);
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error(`User ${userId} not found`);

    const inquiryStatus: string = inquiry.data?.attributes?.status || '';

    if (inquiryStatus === 'approved') {
      await db.update(users)
        .set({ kycStatus: 'approved', updatedAt: new Date() })
        .where(eq(users.id, userId));
      await db.update(kycSubmissions)
        .set({ status: 'approved', reviewedAt: new Date() })
        .where(eq(kycSubmissions.id, kycSubmissionId));
      await notificationService.sendKycApprovalEmail(user.email);
      console.log(`[kyc-review] Approved KYC for user ${userId}`);
    } else if (inquiryStatus === 'declined' || inquiryStatus === 'failed') {
      const reason = inquiry.data?.attributes?.['rejection-reason'] || 'Declined during review';
      await db.update(users)
        .set({ kycStatus: 'rejected', updatedAt: new Date() })
        .where(eq(users.id, userId));
      await db.update(kycSubmissions)
        .set({ status: 'rejected', rejectionReason: reason, reviewedAt: new Date() })
        .where(eq(kycSubmissions.id, kycSubmissionId));
      await notificationService.sendKycRejectionEmail(user.email, reason);
      console.log(`[kyc-review] Rejected KYC for user ${userId}: ${reason}`);
    } else {
      console.log(`[kyc-review] Inquiry ${personaInquiryId} status=${inquiryStatus}, no action taken`);
    }
  },
  { connection: redis }
);

kycReviewWorker.on('failed', (job, err) => {
  console.error(`[kyc-review] Job ${job?.id} failed:`, err.message);
});
