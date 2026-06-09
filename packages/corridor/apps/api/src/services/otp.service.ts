import twilio from 'twilio';

export class OtpService {
  private client: ReturnType<typeof twilio>;
  private serviceSid: string;

  constructor() {
    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  }

  async sendOTP(phoneNumber: string): Promise<string> {
    const verification = await this.client.verify.v2
      .services(this.serviceSid)
      .verifications.create({ to: phoneNumber, channel: 'sms' });
    return verification.sid;
  }

  async verifyOTP(phoneNumber: string, code: string): Promise<'approved' | 'pending' | 'expired'> {
    try {
      const check = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phoneNumber, code });
      return check.status as 'approved' | 'pending' | 'expired';
    } catch {
      return 'expired';
    }
  }
}

export const otpService = new OtpService();
