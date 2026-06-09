import nodemailer from 'nodemailer';

export class NotificationService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendKycApprovalEmail(userEmail: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_USER,
      to: userEmail,
      subject: 'XIDR KYC Approved',
      html: `<p>Your identity verification has been approved. You can now use XIDR.</p>`,
    });
  }

  async sendKycRejectionEmail(userEmail: string, reason: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_USER,
      to: userEmail,
      subject: 'XIDR KYC — Action Required',
      html: `<p>Your verification was not approved.</p><p>Reason: ${reason}</p><p>Please contact support if you have questions.</p>`,
    });
  }

  async sendAmlAlertEmail(details: {
    txHash: string;
    severity: string;
    alertType: string;
    riskScore?: number;
  }): Promise<void> {
    const complianceEmail = process.env.COMPLIANCE_TEAM_EMAIL!;
    await this.transporter.sendMail({
      from: process.env.SMTP_USER,
      to: complianceEmail,
      subject: `[XIDR AML] ${details.severity.toUpperCase()} Alert — ${details.txHash}`,
      html: `
        <h2>AML Alert</h2>
        <p><strong>Severity:</strong> ${details.severity}</p>
        <p><strong>Type:</strong> ${details.alertType}</p>
        <p><strong>TX Hash:</strong> ${details.txHash}</p>
        ${details.riskScore !== undefined ? `<p><strong>Risk Score:</strong> ${details.riskScore}/100</p>` : ''}
        <p>Please review in the compliance admin panel.</p>
      `,
    });
  }

  async sendReserveDiscrepancyEmail(details: {
    currentSupply: string;
    lastAttestedSupply: string;
    changePercent: number;
  }): Promise<void> {
    const complianceEmail = process.env.COMPLIANCE_TEAM_EMAIL!;
    await this.transporter.sendMail({
      from: process.env.SMTP_USER,
      to: complianceEmail,
      subject: `[XIDR] Reserve Re-attestation Required`,
      html: `
        <h2>Reserve Supply Change Detected</h2>
        <p>XIDR total supply has changed by <strong>${details.changePercent.toFixed(2)}%</strong> since last attestation.</p>
        <p>Current supply: ${details.currentSupply}</p>
        <p>Last attested: ${details.lastAttestedSupply}</p>
        <p>Please perform a new reserve attestation in the admin panel.</p>
      `,
    });
  }
}

export const notificationService = new NotificationService();
