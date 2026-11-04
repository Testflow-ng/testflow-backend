import { z } from 'zod';

/** Number of whitespace-separated words. */
export const countWords = (text) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

/** Reject control characters and HTML-ish markup: ad copy is plain text. */
// eslint-disable-next-line no-control-regex
const PLAIN = /^[^<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
export const plainText = (max, label) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`)
    .regex(PLAIN, `${label} contains unsupported characters`);

const isPrivateHost = (host) => {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return true; // IP literals (v4 / v6)
  return !host.includes('.'); // single-label hosts
};

/**
 * Validate an advertiser destination URL. https only, no credentials, no
 * IP/localhost/internal hosts, bounded length. Returns the normalized URL.
 */
export const parseDestinationUrl = (raw) => {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: 'Enter a valid URL, e.g. https://example.com' };
  }
  if (url.protocol !== 'https:') return { ok: false, message: 'Only https:// links are allowed.' };
  if (url.username || url.password) return { ok: false, message: 'Links with embedded credentials are not allowed.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isPrivateHost(host)) return { ok: false, message: 'This link points to a disallowed address.' };
  if (url.href.length > 2000) return { ok: false, message: 'Link is too long.' };
  if (url.port && url.port !== '443') return { ok: false, message: 'Custom ports are not allowed.' };
  return { ok: true, url: url.href };
};

/**
 * Normalize a WhatsApp number to digits-only international format (E.164
 * without "+"). Nigerian local formats (0803…) are converted to 234….
 */
export const parseWhatsappNumber = (raw) => {
  let digits = raw.replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0[789]\d{9}$/.test(digits)) digits = `234${digits.slice(1)}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return { ok: false, message: 'Enter a valid WhatsApp number, e.g. 08012345678 or +2348012345678.' };
  }
  if (digits.startsWith('234') && digits.length !== 13) {
    return { ok: false, message: 'Nigerian numbers must have 10 digits after +234.' };
  }
  return { ok: true, number: digits };
};

export const whatsappHref = (number) => `https://wa.me/${number}`;

/** Lowercase, collapse whitespace, de-duplicate keywords. */
export const normalizeKeywords = (keywords) => [
  ...new Set(keywords.map((k) => k.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)),
];
