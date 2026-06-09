import twilio from 'twilio';

export class SmsService {
  private client: ReturnType<typeof twilio>;
  private from: string;

  constructor() {
    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.from = process.env.TWILIO_PHONE_NUMBER!;
  }

  private async send(to: string, body: string): Promise<void> {
    try {
      await this.client.messages.create({ to, from: this.from, body });
    } catch (e) {
      console.error('[sms] Failed to send SMS:', e);
    }
  }

  async sendPaymentReceivedSMS(phoneNumber: string, transferId: string, sgdAmount: number): Promise<void> {
    const short = transferId.slice(0, 8).toUpperCase();
    const body = `XIDR Transfer: SGD ${sgdAmount} payment received (#${short}). Converting to IDR — you'll be notified when sent.\n\nPembayaran SGD ${sgdAmount} diterima (#${short}). Sedang dikonversi ke IDR.`;
    await this.send(phoneNumber, body);
  }

  async sendTransferCompletedSMS(phoneNumber: string, transferId: string, idrAmount: number, recipientName: string): Promise<void> {
    const short = transferId.slice(0, 8).toUpperCase();
    const formatted = new Intl.NumberFormat('id-ID').format(idrAmount);
    const body = `XIDR Transfer: IDR ${formatted} sent to ${recipientName} (#${short}).\n\nIDR ${formatted} telah dikirim ke ${recipientName} (#${short}).`;
    await this.send(phoneNumber, body);
  }

  async sendTransferFailedSMS(phoneNumber: string, transferId: string, reason: string): Promise<void> {
    const short = transferId.slice(0, 8).toUpperCase();
    const body = `XIDR Transfer #${short} failed: ${reason}. Please contact support.\n\nTransfer #${short} gagal: ${reason}. Hubungi support kami.`;
    await this.send(phoneNumber, body);
  }
}

export const smsService = new SmsService();
