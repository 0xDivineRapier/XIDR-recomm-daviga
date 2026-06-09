import Stripe from 'stripe';
import crypto from 'crypto';

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
      apiVersion: '2024-04-10',
    });
  }

  async createPaymentIntent(params: {
    amountCents: number;
    transferId: string;
    senderEmail?: string;
  }): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const pi = await this.stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: 'sgd',
      metadata: { transfer_id: params.transferId },
      receipt_email: params.senderEmail,
      automatic_payment_methods: { enabled: true },
    });
    return { clientSecret: pi.client_secret!, paymentIntentId: pi.id };
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(paymentIntentId);
  }

  async refundPaymentIntent(paymentIntentId: string, amountCents: number): Promise<void> {
    await this.stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents });
  }

  verifyWebhookSignature(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  }
}

export const stripeService = new StripeService();
