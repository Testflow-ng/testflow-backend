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
    subject: 'Verify your TestFlow email',
    text: `Welcome to TestFlow. Verify your email: ${url} (link expires in 24 hours)`,
    html: `<p>Welcome to TestFlow, ${escapeHtml(user.fullName)}.</p>
<p><a href="${url}">Verify your email address</a></p>
<p>This link expires in 24 hours.</p>`,
  });
};

export const sendPasswordResetEmail = async (user, token) => {
  const url = `${config.CLIENT_URL}/reset-password?token=${token}`;
  await send({
    to: user.email,
    subject: 'Reset your TestFlow password',
    text: `Reset your TestFlow password: ${url} (link expires in 30 minutes)`,
    html: `<p>We received a request to reset your TestFlow password.</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
  });
};
