import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { Errors } from '../utils/errors.ts';

interface SentMailRecord {
  to: string;
  subject: string;
  codeOrToken: string;
  sentAt: Date;
}

const devTestMailSink: SentMailRecord[] = [];
let cachedTransporter: Transporter | null = null;
let transporterMode: 'smtp' | 'ethereal' | 'stream' = 'stream';

export function getLastTestEmailForRecipient(email: string): SentMailRecord | undefined {
  if (env.nodeEnv === 'production') return undefined;
  const normalized = email.trim().toLowerCase();
  for (let i = devTestMailSink.length - 1; i >= 0; i--) {
    if (devTestMailSink[i].to.toLowerCase() === normalized) {
      return devTestMailSink[i];
    }
  }
  return undefined;
}

async function getTransporter(): Promise<Transporter> {
  if (cachedTransporter) return cachedTransporter;

  if (env.smtp.enabled) {
    transporterMode = 'smtp';
    cachedTransporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
    });
    return cachedTransporter;
  }

  if (env.nodeEnv === 'production') {
    throw Errors.serviceUnavailable(
      'SMTP email service is not configured. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.',
      'SMTP_UNCONFIGURED'
    );
  }

  if (!process.env.VITEST) {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporterMode = 'ethereal';
      cachedTransporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      return cachedTransporter;
    } catch {
      // Fallback to Nodemailer JSON transport when outbound port 587 is restricted in container sandboxes
    }
  }

  transporterMode = 'stream';
  cachedTransporter = nodemailer.createTransport({ jsonTransport: true });
  return cachedTransporter;
}

export async function sendVerificationOtpEmail(params: {
  to: string;
  displayName: string;
  otp: string;
  expiresInMinutes: number;
}): Promise<{ previewUrl?: string; deliveryMode: string }> {
  const transporter = await getTransporter();
  const subject = 'Verify your ChatSphere account';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0b1120; color:#f8fafc; padding:32px; border-radius:12px; max-width:520px; margin:0 auto;">
      <h2 style="margin:0 0 12px; color:#f8fafc; font-size:20px;">Verify your ChatSphere email</h2>
      <p style="color:#94a3b8; font-size:14px; line-height:1.6;">
        Hello ${params.displayName}, enter the verification code below to activate your account. This code expires in ${params.expiresInMinutes} minutes.
      </p>
      <div style="margin:24px 0; padding:18px; background:#111827; border:1px solid #1e293b; border-radius:8px; text-align:center; font-family:monospace; font-size:28px; letter-spacing:8px; font-weight:700; color:#22d3ee;">
        ${params.otp}
      </div>
      <p style="color:#64748b; font-size:12px; line-height:1.5;">
        If you did not create a ChatSphere account, you can safely ignore this message.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: env.smtp.from,
    to: params.to,
    subject,
    text: `Your ChatSphere verification code is ${params.otp}. It expires in ${params.expiresInMinutes} minutes.`,
    html,
  });

  if (env.nodeEnv !== 'production') {
    devTestMailSink.push({
      to: params.to,
      subject,
      codeOrToken: params.otp,
      sentAt: new Date(),
    });
    if (devTestMailSink.length > 200) devTestMailSink.shift();
  }

  const previewUrl =
    transporterMode === 'ethereal' ? (nodemailer.getTestMessageUrl(info) || undefined) : undefined;

  logger.info('Dispatched email verification OTP', {
    recipientDomain: params.to.split('@')[1],
    deliveryMode: transporterMode,
    hasPreviewUrl: Boolean(previewUrl),
  });

  return { previewUrl, deliveryMode: transporterMode };
}

export async function sendPasswordResetEmail(params: {
  to: string;
  displayName: string;
  resetUrl: string;
  rawToken: string;
  expiresInMinutes: number;
}): Promise<{ previewUrl?: string; deliveryMode: string }> {
  const transporter = await getTransporter();
  const subject = 'Reset your ChatSphere password';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0b1120; color:#f8fafc; padding:32px; border-radius:12px; max-width:520px; margin:0 auto;">
      <h2 style="margin:0 0 12px; color:#f8fafc; font-size:20px;">Password Reset Request</h2>
      <p style="color:#94a3b8; font-size:14px; line-height:1.6;">
        Hello ${params.displayName}, we received a request to reset your ChatSphere password. Use the button below within ${params.expiresInMinutes} minutes.
      </p>
      <div style="margin:24px 0;">
        <a href="${params.resetUrl}" style="display:inline-block; background:#06b6d4; color:#082f49; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px; font-size:14px;">
          Reset Password
        </a>
      </div>
      <p style="color:#64748b; font-size:12px; line-height:1.5;">
        If you did not request a password reset, no changes have been made to your account.
      </p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: env.smtp.from,
    to: params.to,
    subject,
    text: `Reset your ChatSphere password using this link (expires in ${params.expiresInMinutes} minutes): ${params.resetUrl}`,
    html,
  });

  if (env.nodeEnv !== 'production') {
    devTestMailSink.push({
      to: params.to,
      subject,
      codeOrToken: params.rawToken,
      sentAt: new Date(),
    });
    if (devTestMailSink.length > 200) devTestMailSink.shift();
  }

  const previewUrl =
    transporterMode === 'ethereal' ? (nodemailer.getTestMessageUrl(info) || undefined) : undefined;

  logger.info('Dispatched password reset email', {
    recipientDomain: params.to.split('@')[1],
    deliveryMode: transporterMode,
  });

  return { previewUrl, deliveryMode: transporterMode };
}
