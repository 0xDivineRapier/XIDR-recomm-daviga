export interface RedeemResult {
  redeemRequestId: string;
}

export class DisbursementService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.FIX3_API_BASE_URL || 'http://localhost:3001';
    this.apiKey = process.env.CORRIDOR_API_KEY || '';
  }

  async createRedeemRequest(params: {
    transferId: string;
    xidrAmount: number;
    recipientBankCode: string;
    recipientAccountNumber: string;
    recipientName: string;
  }): Promise<RedeemResult> {
    const resp = await fetch(`${this.baseUrl}/v1/redeem/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        idempotency_key: params.transferId,
        xidr_amount: params.xidrAmount,
        sender_wallet: process.env.CORRIDOR_WALLET_ADDRESS!,
        recipient_bank_code: params.recipientBankCode,
        recipient_account_number: params.recipientAccountNumber,
        recipient_name: params.recipientName,
        metadata: { source: 'corridor', transfer_id: params.transferId },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Fix 3 redeem request failed: ${resp.status} ${err}`);
    }

    const data = await resp.json() as any;
    return { redeemRequestId: data.redeem_request_id };
  }

  async getRedeemStatus(redeemRequestId: string): Promise<{ status: string }> {
    const resp = await fetch(`${this.baseUrl}/v1/redeem/${redeemRequestId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!resp.ok) throw new Error(`Failed to get redeem status: ${resp.status}`);
    const data = await resp.json() as any;
    return { status: data.status };
  }
}

export const disbursementService = new DisbursementService();
