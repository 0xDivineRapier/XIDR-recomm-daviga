import crypto from 'crypto';

const PERSONA_BASE_URL = 'https://withpersona.com/api/v1';

export class KycService {
  private apiKey: string;
  private webhookSecret: string;
  private individualTemplateId: string;
  private businessTemplateId: string;

  constructor() {
    this.apiKey = process.env.PERSONA_API_KEY!;
    this.webhookSecret = process.env.PERSONA_WEBHOOK_SECRET!;
    this.individualTemplateId = process.env.PERSONA_INDIVIDUAL_TEMPLATE_ID!;
    this.businessTemplateId = process.env.PERSONA_BUSINESS_TEMPLATE_ID!;
  }

  async createIndividualInquiry(userId: string): Promise<{ inquiryId: string; hostedFlowUrl: string }> {
    const response = await fetch(`${PERSONA_BASE_URL}/inquiries`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Persona-Version': '2023-01-05',
      },
      body: JSON.stringify({
        data: {
          type: 'inquiry',
          attributes: {
            'inquiry-template-id': this.individualTemplateId,
            'reference-id': userId,
          },
        },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Persona API error: ${err}`);
    }
    const data = await response.json() as any;
    return {
      inquiryId: data.data.id,
      hostedFlowUrl: data.data.attributes['resume-token']
        ? `https://withpersona.com/verify?inquiry-id=${data.data.id}&session-token=${data.data.attributes['resume-token']}`
        : `https://withpersona.com/verify?inquiry-id=${data.data.id}`,
    };
  }

  async createBusinessInquiry(userId: string): Promise<{ inquiryId: string; hostedFlowUrl: string }> {
    const response = await fetch(`${PERSONA_BASE_URL}/inquiries`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Persona-Version': '2023-01-05',
      },
      body: JSON.stringify({
        data: {
          type: 'inquiry',
          attributes: {
            'inquiry-template-id': this.businessTemplateId,
            'reference-id': userId,
          },
        },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Persona API error: ${err}`);
    }
    const data = await response.json() as any;
    return {
      inquiryId: data.data.id,
      hostedFlowUrl: `https://withpersona.com/verify?inquiry-id=${data.data.id}`,
    };
  }

  async getInquiry(inquiryId: string): Promise<any> {
    const response = await fetch(`${PERSONA_BASE_URL}/inquiries/${inquiryId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Persona-Version': '2023-01-05',
      },
    });
    if (!response.ok) throw new Error(`Persona API error fetching inquiry`);
    return response.json();
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

export const kycService = new KycService();
