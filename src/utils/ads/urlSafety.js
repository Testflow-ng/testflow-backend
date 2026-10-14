import { config } from '../../config/env.js';
import { logger } from '../logger.js';

/** Link shorteners hide the real destination, so they are not accepted. */
export const SHORTENER_HOSTS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy',
]);

export const isShortener = (url) => SHORTENER_HOSTS.has(new URL(url).hostname.toLowerCase().replace(/^www\./, ''));

let checkerOverride = null;
/** Test hook: replace the Safe Browsing lookup. */
export const setSafeBrowsingForTests = (fn) => { checkerOverride = fn; };

/** Google Safe Browsing v4 lookup. Returns true when the URL is flagged. */
const flaggedBySafeBrowsing = async (url) => {
  if (checkerOverride) return checkerOverride(url);
  if (!config.GOOGLE_SAFE_BROWSING_KEY) return false;
  const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.GOOGLE_SAFE_BROWSING_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      client: { clientId: 'testflow-ads', clientVersion: '1.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }],
      },
    }),
  });
  if (!res.ok) throw new Error(`Safe Browsing ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.matches) && json.matches.length > 0;
};

/**
 * Returns an error message if the URL must be refused, else null.
 * Shorteners are always refused. Safe Browsing runs when a key is configured and
 * FAILS OPEN (logged) on lookup errors; admins still review every link.
 */
export const checkDestinationSafety = async (url) => {
  if (isShortener(url)) return 'Shortened links are not allowed. Use the full destination URL.';
  try {
    if (await flaggedBySafeBrowsing(url)) return 'This link was flagged as unsafe and cannot be used.';
  } catch (e) {
    logger.warn('Safe Browsing lookup failed; allowing link for manual review', e.message);
  }
  return null;
};
