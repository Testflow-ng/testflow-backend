import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const resendClient = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;
const isSmtpConfigured = Boolean(config.SMTP_HOST && config.SMTP_PORT);

const transporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

const escapeHtml = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

/**
 * Modern, clean, minimal transactional email layout inspired by Linear & Stripe.
 * Stark neutral canvas, sharp typography, robust table structure, zero noisy gradients.
 */
export const buildCleanEmailHtml = ({
  badge = 'Update',
  title,
  preheader,
  bodyHtml,
  ctaText,
  ctaUrl,
  metadata = [], // Array of { label, value, isCode?, isGreen? }
  footerNote,
}) => {
  const metadataBoxHtml = metadata && metadata.length > 0 ? `
    <tr>
      <td style="padding-bottom: 24px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 14px 18px;">
          ${metadata.map((row) => `
            <tr>
              <td style="font-size: 13px; color: #71717a; padding: 5px 0;">${escapeHtml(row.label)}</td>
              <td align="right" style="font-size: 13px; font-weight: 600; padding: 5px 0; color: ${row.isGreen ? '#059669' : '#09090b'}; ${row.isCode ? 'font-family: monospace; font-size: 12px;' : ''}">
                ${escapeHtml(String(row.value))}
              </td>
            </tr>
          `).join('')}
        </table>
      </td>
    </tr>
  ` : '';

  const ctaHtml = ctaUrl && ctaText ? `
    <tr>
      <td style="padding-bottom: 28px;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 8px; background-color: #09090b;">
              <a href="${ctaUrl}" target="_blank" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 11px 22px; border-radius: 8px; border: 1px solid #09090b; display: inline-block; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
                ${escapeHtml(ctaText)} &rarr;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(title)}</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f9f9fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
      .header-padding { padding: 24px 20px 16px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f9f9fb; color: #18181b;">
  <div style="display:none; font-size:1px; color:#f9f9fb; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all;">
    ${escapeHtml(preheader || title)}
  </div>

  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9f9fb;">
    <tr>
      <td align="center" style="padding: 36px 12px;">
        <table border="0" cellpadding="0" cellspacing="0" width="560" class="email-container" style="background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <!-- Top Minimal Header -->
          <tr>
            <td class="header-padding" style="padding: 28px 36px 20px 36px; border-bottom: 1px solid #f4f4f5;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left" valign="middle">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width: 28px; height: 28px; background-color: #09090b; border-radius: 6px; text-align: center; vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 13px; font-weight: 800; font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 28px;">TF</span>
                        </td>
                        <td style="padding-left: 10px;">
                          <span style="font-size: 16px; font-weight: 700; letter-spacing: -0.4px; color: #09090b;">TestFlow</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  ${badge ? `
                  <td align="right" valign="middle">
                    <span style="display: inline-block; background-color: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; color: #52525b; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${escapeHtml(badge)}
                    </span>
                  </td>` : ''}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td class="content-padding" style="padding: 32px 36px 36px 36px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 16px; font-size: 21px; font-weight: 600; line-height: 28px; color: #09090b; letter-spacing: -0.4px;">
                    ${escapeHtml(title)}
                  </td>
                </tr>

                <tr>
                  <td style="font-size: 15px; line-height: 24px; color: #3f3f46; padding-bottom: ${ctaUrl || (metadata && metadata.length) ? '24px' : '8px'};">
                    ${bodyHtml}
                  </td>
                </tr>

                ${metadataBoxHtml}

                ${ctaHtml}

                <tr>
                  <td style="border-top: 1px solid #f4f4f5; padding-top: 20px; font-size: 13px; color: #71717a; line-height: 20px;">
                    ${footerNote || 'Have questions? Reach our team anytime at <a href="mailto:hello@testflow.com.ng" style="color: #09090b; font-weight: 500; text-decoration: underline;">hello@testflow.com.ng</a>.'}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Outer Sub-Footer -->
        <table border="0" cellpadding="0" cellspacing="0" width="560" class="email-container" style="margin-top: 20px;">
          <tr>
            <td align="center" style="padding: 0 20px; font-size: 12px; color: #a1a1aa; line-height: 18px;">
              TestFlow Academic &bull; Timed practice and CBT excellence<br>
              &copy; ${new Date().getFullYear()} TestFlow. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const DEFAULT_FROM = 'Testflow <hello@testflow.com.ng>';

/**
 * The sender line. Everybody mail keeps TestFlow's verified address (the only one we can sign) and
 * swaps the display name for the organisation's, so a student sees "Lagos Academy", not "Testflow".
 */
const fromLine = (fromName) => {
  const base = config.EMAIL_FROM || DEFAULT_FROM;
  if (!fromName) return base;
  const address = /<([^>]+)>/.exec(base)?.[1] ?? base;
  const name = String(fromName).replace(/["<>\\\r\n]/g, '').trim().slice(0, 80);
  return name ? `"${name}" <${address}>` : base;
};

const send = async ({ to, subject, html, text, fromName, replyTo }) => {
  const from = fromLine(fromName);

  if (resendClient) {
    try {
      const { data, error } = await resendClient.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      });
      if (error) {
        logger.error(`[email] Resend delivery error for "${subject}" -> ${to}:`, error);
        throw new Error(error.message || 'Resend delivery failed');
      }
      logger.info(`[email] Successfully sent via Resend to ${to} (id: ${data?.id})`);
      return data;
    } catch (err) {
      logger.error(`[email] Failed to send email via Resend to ${to}:`, err.message);
      throw err;
    }
  }

  if (transporter) {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
    logger.info(`[email] Successfully sent via SMTP to ${to}`);
    return;
  }

  // Neither Resend nor SMTP is configured (e.g. local development)
  logger.warn(`[email] Neither Resend nor SMTP configured; skipped sending "${subject}" -> ${to}`);
  logger.info(`[email] [DEV PREVIEW] ${text}`);
};

export const sendVerificationEmail = async (user, token) => {
  const url = `${config.CLIENT_URL}/verify-email?token=${token}`;
  logger.info(`[email] Verification link generated for ${user.email}: ${url}`);

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Hello <strong>${escapeHtml(user.fullName)}</strong>,</p>
    <p style="margin: 0 0 16px 0;">
      Welcome to TestFlow. To activate your account, access practice CBT exams, and start tracking your academic progress, please verify your email address.
    </p>
    <p style="margin: 0; font-size: 13px; color: #71717a;">
      This verification link is active for 24 hours. If you did not create an account on TestFlow, you can safely ignore this email.
    </p>
  `;

  await send({
    to: user.email,
    subject: 'Verify your TestFlow account',
    text: `Welcome to TestFlow, ${user.fullName}. Verify your email: ${url} (Link expires in 24 hours)`,
    html: buildCleanEmailHtml({
      badge: 'Verification',
      title: 'Verify your email address',
      preheader: 'Complete your TestFlow registration by verifying your email address.',
      bodyHtml,
      ctaText: 'Verify Email Address',
      ctaUrl: url,
    }),
  });
};

/**
 * Tell an organiser what a plan change did to their exams. Only the exams a downgrade unpublished
 * are named; nothing was deleted, so the mail is recoverable information, not a warning.
 */
export const sendPlanChangeEmail = async ({ to, name, orgName, planName, liveUnpublished = 0, paidUnpublished = 0 }) => {
  const lines = [];
  if (liveUnpublished) lines.push(`${liveUnpublished} scheduled Live CBT exam${liveUnpublished === 1 ? '' : 's'} (not yet started) were unpublished.`);
  if (paidUnpublished) lines.push(`${paidUnpublished} paid exam${paidUnpublished === 1 ? '' : 's'} were unpublished so no new student is charged.`);
  const detail = lines.join(' ') || 'No exams were affected.';

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Hello <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 16px 0;">
      <strong>${escapeHtml(orgName)}</strong> is now on the <strong>${escapeHtml(planName)}</strong>.
    </p>
    <p style="margin: 0 0 16px 0; color: #52525b;">${escapeHtml(detail)}</p>
    <p style="margin: 0; font-size: 13px; color: #71717a;">
      Nothing was deleted: you can publish your exams again whenever you renew or upgrade.
    </p>
  `;

  await send({
    to,
    subject: `Your ${orgName} plan changed`,
    text: `Hello ${name}, ${orgName} is now on ${planName}. ${detail} Nothing was deleted: publish them again after you upgrade.`,
    html: buildCleanEmailHtml({
      badge: 'Plan Update',
      title: 'Your organization plan was updated',
      preheader: `${orgName} plan updated to ${planName}.`,
      bodyHtml,
    }),
  });
};

export const sendPasswordResetEmail = async (user, token) => {
  const url = `${config.CLIENT_URL}/reset-password?token=${token}`;
  logger.info(`[email] Password reset link generated for ${user.email}: ${url}`);

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Hello <strong>${escapeHtml(user.fullName)}</strong>,</p>
    <p style="margin: 0 0 16px 0;">
      We received a request to reset the password for your TestFlow account. Click the button below to choose a new password.
    </p>
    <p style="margin: 0; font-size: 13px; color: #71717a;">
      This security link will expire in 30 minutes. If you did not request a password reset, you can safely ignore this message.
    </p>
  `;

  await send({
    to: user.email,
    subject: 'Reset your TestFlow password',
    text: `We received a request to reset your TestFlow password. Reset here: ${url} (Link expires in 30 minutes)`,
    html: buildCleanEmailHtml({
      badge: 'Security',
      title: 'Reset your password',
      preheader: 'Choose a new password for your TestFlow account.',
      bodyHtml,
      ctaText: 'Reset Password',
      ctaUrl: url,
    }),
  });
};

/**
 * Beautiful confirmation email sent to a student immediately upon successful payment verification.
 */
export const sendStudentPaymentSuccessEmail = async ({ user, purchase }) => {
  const planName = purchase.planSnapshot?.name || 'Plus';
  const durationDays = purchase.planSnapshot?.durationDays || 30;
  const amountFormatted = `₦${(purchase.amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  const dateFormatted = new Date(purchase.paidAt || Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const receiptUrl = `${config.CLIENT_URL}/billing/invoices`;
  const dashboardUrl = `${config.CLIENT_URL}/dashboard`;

  const subject = `Receipt: Your TestFlow ${planName} subscription is active! 🚀`;

  const text = `Hello ${user.fullName},

Thank you for subscribing to TestFlow ${planName}! Your payment of ${amountFormatted} was successful.

Transaction Reference: ${purchase.reference}
Date: ${dateFormatted}
Plan: ${planName} (${durationDays} Days)
Status: Paid via Paystack

What you now have access to:
- No ads anywhere in Testflow
- Live CBT access and session hosting
- Early access to AI study tools
- Access to create 2 free CBT sections for everyone

Open your dashboard: ${dashboardUrl}
View and print your official receipt: ${receiptUrl}

Best regards,
The TestFlow Team
hello@testflow.com.ng`;

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Hello <strong>${escapeHtml(user.fullName)}</strong>,</p>
    <p style="margin: 0 0 16px 0;">
      Thank you for your payment. Your <strong>TestFlow ${escapeHtml(planName)}</strong> subscription is now active for the next <strong>${durationDays} days</strong>.
    </p>
    <div style="margin: 0 0 20px 0; padding: 14px 16px; background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px;">
      <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #18181b;">Unlocked with your subscription:</p>
      <ul style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 20px; color: #52525b;">
        <li>Ad-free experience across all practice and CBT sessions</li>
        <li>Live CBT room hosting and real-time multiplayer practice</li>
        <li>Priority access to upcoming AI study and revision tools</li>
        <li>Two free CBT section creations for everyone</li>
      </ul>
    </div>
  `;

  await send({
    to: user.email,
    subject,
    text,
    html: buildCleanEmailHtml({
      badge: 'Receipt',
      title: `You're now on TestFlow ${planName}`,
      preheader: `Payment confirmed for TestFlow ${planName} (${amountFormatted}).`,
      bodyHtml,
      metadata: [
        { label: 'Plan', value: `${planName} (${durationDays} Days)` },
        { label: 'Amount Paid', value: amountFormatted, isGreen: true },
        { label: 'Date', value: dateFormatted },
        { label: 'Reference', value: purchase.reference, isCode: true },
        { label: 'Payment Method', value: 'Paystack' },
        { label: 'Status', value: 'Paid / Confirmed' },
      ],
      ctaText: 'Open Dashboard',
      ctaUrl: dashboardUrl,
      footerNote: `View your receipt online anytime in your <a href="${receiptUrl}" style="color: #09090b; font-weight: 500; text-decoration: underline;">billing settings</a>. Need help? Contact <a href="mailto:hello@testflow.com.ng" style="color: #09090b; font-weight: 500; text-decoration: underline;">hello@testflow.com.ng</a>.`,
    }),
  });
};

export const sendStudentSubscriptionExpiringEmail = async ({ user, entitlement }) => {
  const planName = 'Plus';
  const expiryDate = new Date(entitlement.expiresAt || Date.now());
  const dateFormatted = expiryDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
  const timeFormatted = expiryDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Lagos',
  });

  const billingUrl = `${config.CLIENT_URL}/billing`;
  const subject = `Reminder: Your TestFlow ${planName} subscription expires tomorrow at ${timeFormatted} ⏳`;

  const text = `Hello ${user.fullName},

This is a reminder that your TestFlow ${planName} subscription will expire tomorrow on ${dateFormatted} at ${timeFormatted} (WAT).

When your subscription expires, your account will revert to the free tier:
- Standard ad placements will resume during practice
- Live CBT room hosting will be locked
- Early access to new AI study tools will be paused

To keep your uninterrupted ad-free practice and active perks, renew your subscription for ₦500:
${billingUrl}

Your study progress, test history, and badges are always safe with Testflow.

Best regards,
The TestFlow Team
hello@testflow.com.ng`;

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Hello <strong>${escapeHtml(user.fullName)}</strong>,</p>
    <p style="margin: 0 0 16px 0;">
      Your <strong>TestFlow ${escapeHtml(planName)}</strong> subscription will expire tomorrow at <strong>${escapeHtml(timeFormatted)} (WAT)</strong>.
    </p>
    <p style="margin: 0 0 16px 0; color: #52525b; font-size: 14px; line-height: 22px;">
      After expiration, your account reverts to the standard tier with ad placements and locked Live CBT hosting. Your test records, scores, and badges remain safe.
    </p>
  `;

  await send({
    to: user.email,
    subject,
    text,
    html: buildCleanEmailHtml({
      badge: 'Reminder',
      title: 'Your subscription expires tomorrow',
      preheader: `TestFlow ${planName} subscription expires tomorrow at ${timeFormatted} (WAT).`,
      bodyHtml,
      metadata: [
        { label: 'Current Plan', value: `${planName} (30 Days)` },
        { label: 'Expires On', value: dateFormatted },
        { label: 'Time (WAT)', value: `${timeFormatted} WAT` },
        { label: 'Renewal Price', value: '₦500 / 30 Days', isGreen: true },
      ],
      ctaText: 'Renew Subscription (₦500)',
      ctaUrl: billingUrl,
      footerNote: `Prefer not to renew? No action is required — you will remain on our free tier. Questions? Contact <a href="mailto:hello@testflow.com.ng" style="color: #09090b; font-weight: 500; text-decoration: underline;">hello@testflow.com.ng</a>.`,
    }),
  });
};


export const sendStudentAnnouncementEmail = async ({ user, title, body, linkUrl }) => {
  const ctaUrl = linkUrl
    ? (linkUrl.startsWith('http') ? linkUrl : `${config.CLIENT_URL}${linkUrl.startsWith('/') ? linkUrl : `/${linkUrl}`}`)
    : `${config.CLIENT_URL}/dashboard`;
  const subject = `[TestFlow Announcement] ${title}`;

  const text = `Hello ${user.fullName},

${title}

${body}

${ctaUrl ? `Learn more / Open: ${ctaUrl}` : ''}

Best regards,
The TestFlow Team
hello@testflow.com.ng`;

  // Preserve paragraphs and newlines cleanly in HTML
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const formattedContent = paragraphs.length > 0
    ? paragraphs.map((p) => `<p style="margin: 0 0 16px 0; line-height: 24px; color: #3f3f46;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p style="margin: 0 0 16px 0; line-height: 24px; color: #3f3f46;">${escapeHtml(body)}</p>`;

  const bodyHtml = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #18181b;">Hello <strong>${escapeHtml(user.fullName)}</strong>,</p>
    ${formattedContent}
  `;

  await send({
    to: user.email,
    subject,
    text,
    html: buildCleanEmailHtml({
      badge: 'Announcement',
      title,
      preheader: body.slice(0, 120),
      bodyHtml,
      ctaText: 'View on TestFlow',
      ctaUrl,
      footerNote: `You received this announcement as an active member of TestFlow. Have questions? Reach out to <a href="mailto:hello@testflow.com.ng" style="color: #09090b; font-weight: 500; text-decoration: underline;">hello@testflow.com.ng</a>.`,
    }),
  });
};

/* ----------------------------------------------------------- Everybody (organisation) mail */

/** Same transport as every other mail; only the sender name and reply-to belong to the organisation. */
const sendOrgMail = ({ org, to, subject, text, heading, paragraphs, cta }) => {
  const bodyHtml = paragraphs
    .map((p) => `<p style="margin: 0 0 16px 0; line-height: 24px; color: #3f3f46;">${escapeHtml(p)}</p>`)
    .join('');

  return send({
    to,
    subject,
    text,
    fromName: org.name,
    replyTo: org.contactEmail || undefined,
    html: buildCleanEmailHtml({
      badge: org.name,
      title: heading,
      preheader: paragraphs[0] || heading,
      bodyHtml,
      ctaText: cta?.label,
      ctaUrl: cta?.url,
      footerNote: `Sent on behalf of <strong>${escapeHtml(org.name)}</strong> via TestFlow.`,
    }),
  });
};

export const sendOrgInvitationEmail = async ({ org, to, role, inviterName, url }) => {
  const who = inviterName ? `${inviterName} invited you` : 'You have been invited';
  return sendOrgMail({
    org,
    to,
    subject: `You're invited to join ${org.name}`,
    text: `${who} to join ${org.name} as ${role}. Accept: ${url}`,
    heading: `Join ${org.name}`,
    paragraphs: [`${who} to join ${org.name} as ${role}. This invitation expires in 7 days.`],
    cta: { label: 'Accept invitation', url },
  });
};

export const sendOrgAnnouncementEmail = async ({ org, to, text, url }) =>
  sendOrgMail({
    org,
    to,
    subject: `New announcement from ${org.name}`,
    text: `${text}\n${url}`,
    heading: 'New announcement',
    paragraphs: [text],
    cta: { label: `Open ${org.name}`, url },
  });

/** Exposed so the sender rule can be tested without a mail provider. */
export const senderFor = fromLine;

/** A student added by an organisation. New accounts get a set-password link; existing ones just a sign-in link. */
export const sendOrgStudentEmail = async ({ org, to, setupUrl, signInUrl }) =>
  sendOrgMail({
    org,
    to,
    subject: `${org.name} added you`,
    text: setupUrl
      ? `${org.name} added you as a student. Set your password to get started: ${setupUrl}`
      : `${org.name} added you as a student. Sign in: ${signInUrl}`,
    heading: `Welcome to ${org.name}`,
    paragraphs: setupUrl
      ? [`${org.name} has created your student account. Choose a password to get started. This link expires in 7 days.`]
      : [`${org.name} added you as a student. Sign in with your existing account to see your exams.`],
    cta: setupUrl ? { label: 'Set your password', url: setupUrl } : { label: 'Sign in', url: signInUrl },
  });
