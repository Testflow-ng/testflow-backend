import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const isConfigured = Boolean(config.SMTP_HOST && config.SMTP_PORT);

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

const escapeHtml = (value = '') =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const send = async ({ to, subject, html, text }) => {
  if (!transporter) {
    // No SMTP configured (e.g. local dev): log instead of failing the request.
    logger.warn(`[email] SMTP not configured; skipped "${subject}" -> ${to}`);
    logger.debug(`[email] ${text}`);
    return;
  }
  await transporter.sendMail({
    from: config.EMAIL_FROM || 'no-reply@testflow.app',
    to,
    subject,
    text,
    html,
  });
};

export const sendVerificationEmail = async (user, token) => {
  const url = `${config.CLIENT_URL}/verify-email?token=${token}`;
  await send({
    to: user.email,
    subject: 'Verify your TestFlow account',
    text: `Welcome to TestFlow, ${user.fullName}. Verify your email: ${url} (Link expires in 24 hours)`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111;">
        <h1 style="color: #2563eb; font-size: 24px; font-weight: bold; margin-bottom: 16px;">Welcome to TestFlow!</h1>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
          Hello ${escapeHtml(user.fullName)},<br><br>
          Thank you for joining TestFlow. To start taking practice exams and tracking your progress, please verify your email address by clicking the button below:
        </p>
        <a href="${url}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Verify Email Address</a>
        <p style="font-size: 14px; color: #666; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
          This link will expire in 24 hours.<br>
          If you did not create a TestFlow account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async (user, token) => {
  const url = `${config.CLIENT_URL}/reset-password?token=${token}`;
  await send({
    to: user.email,
    subject: 'Reset your TestFlow password',
    text: `We received a request to reset your TestFlow password. Reset here: ${url} (Link expires in 30 minutes)`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111;">
        <h1 style="color: #2563eb; font-size: 24px; font-weight: bold; margin-bottom: 16px;">Password Reset Request</h1>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
          Hello ${escapeHtml(user.fullName)},<br><br>
          We received a request to reset your TestFlow password. Click the button below to choose a new one:
        </p>
        <a href="${url}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Reset Password</a>
        <p style="font-size: 14px; color: #666; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
          This link will expire in 30 minutes for security.<br>
          If you did not request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};
