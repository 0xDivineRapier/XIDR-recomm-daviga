import crypto from 'crypto';

const CHAINALYSIS_BASE_URL = 'https://api.chainalysis.com/api/kyt/v2';

export class AmlService {
  private apiKey: string;
  private webhookSecret: string;

  constructor() {
    this.apiKey = process.env.CHAINALYSIS_API_KEY!;
    this.webhookSecret = process.env.CHAINALYSIS_WEBHOOK_SECRET!;
  }

  async registerTransaction(params: {
    txHash: string;
    asset: string;
    network: string;
    direction: 'sent' | 'received';
    address: string;
    amount: string;
  }): Promise<{ externalId: string; riskScore?: number }> {
    const response = await fetch(`${CHAINALYSIS_BASE_URL}/transfers`, {
      method: 'POST',
      headers: {
        'Token': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        network: params.network,
        asset: params.asset,
        transferReference: params.txHash,
        direction: params.direction,
        address: params.address,
        amount: params.amount,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Chainalysis API error: ${err}`);
    }
    const data = await response.json() as any;
    return {
      externalId: data.externalId || params.txHash,
      riskScore: data.riskScore,
    };
  }

  async getTransferSummary(txHash: string): Promise<any> {
    const response = await fetch(`${CHAINALYSIS_BASE_URL}/transfers/${txHash}/summary`, {
      headers: { 'Token': this.apiKey },
    });
    if (!response.ok) throw new Error(`Chainalysis API error fetching summary`);
    return response.json();
  }

  verifyWebhookSignature(payload: string, secret: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

export const amlService = new AmlService();
