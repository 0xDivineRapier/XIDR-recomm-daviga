import crypto from 'crypto';

// Generates EMVCo-compliant PayNow QR strings (SGQR / NETS variant)
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return ((crc & 0xffff).toString(16).toUpperCase().padStart(4, '0'));
}

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

export interface PayNowQRResult {
  qrString: string;
  reference: string;
}

export class PayNowService {
  private uen: string;

  constructor() {
    this.uen = process.env.PAYNOW_UEN || '202412345A';
  }

  generateQR(params: {
    sgdAmount: number;
    reference: string;
    expiresAt: Date;
  }): PayNowQRResult {
    const ref = params.reference.slice(0, 20).toUpperCase();
    const amount = params.sgdAmount.toFixed(2);
    const expiry = params.expiresAt.toISOString().slice(0, 10).replace(/-/g, '');

    // PayNow merchant account info (tag 26)
    const paynowAccount = [
      tlv('00', 'SG.PAYNOW'),
      tlv('01', '2'),          // 2 = UEN
      tlv('02', this.uen),
      tlv('03', '1'),          // 1 = amount editable = no (fixed)
      tlv('04', expiry),
    ].join('');

    const body = [
      tlv('00', '01'),                          // Payload Format Indicator
      tlv('01', '12'),                          // Point of Initiation: dynamic
      tlv('26', paynowAccount),                 // Merchant Account Info - PayNow
      tlv('52', '0000'),                        // Merchant Category Code
      tlv('53', '702'),                         // Currency: SGD
      tlv('54', amount),                        // Transaction Amount
      tlv('58', 'SG'),                          // Country Code
      tlv('59', 'XIDR Corridor'),               // Merchant Name
      tlv('60', 'Singapore'),                   // Merchant City
      tlv('62', tlv('05', ref)),                // Additional Data: Bill Number
    ].join('');

    const withCrcPrefix = body + '6304';
    const checksum = crc16(withCrcPrefix);
    const qrString = withCrcPrefix + checksum;

    return { qrString, reference: ref };
  }

  verifyWebhookSignature(payload: string, token: string): boolean {
    const expected = process.env.LIQUID_GROUP_WEBHOOK_SECRET || '';
    if (!expected) return true; // dev mode
    try {
      return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

export const paynowService = new PayNowService();
