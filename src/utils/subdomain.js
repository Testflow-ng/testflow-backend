const RESERVED_SLUGS = [
  'www', 'api', 'admin', 'ads', 'app', 'mail', 'cdn', 'static',
  'everybody', 'everyone', 'docs', 'status', 'support', 'billing', 'login',
];

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/;

export const isValidHostname = (host) => {
  if (!host) return false;
  const cleaned = host.toLowerCase().replace(/:.*$/, ''); // strip port
  if (cleaned === 'localhost') return false;
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return false;
  const parts = cleaned.split('.');
  if (parts.length < 2) return false;
  if (parts.some(p => p.length > 63)) return false;
  if (parts.some(p => !HOSTNAME_RE.test(p))) return false;
  if (parts.some(p => p.includes('--'))) return false;
  if (RESERVED_SLUGS.includes(parts[0])) return false;
  return true;
};

export const extractSubdomain = (host) => {
  if (!host) return null;
  const cleaned = host.toLowerCase().replace(/:.*$/, '');
  const parts = cleaned.split('.');
  // .testflow.com.ng → subdomain is everything before the last 2 parts
  if (parts.length <= 2) return null;
  // Check it's a testflow.com.ng apex or subdomain
  const tldPart = parts[parts.length - 2] + '.' + parts[parts.length - 1];
  if (tldPart !== 'testflow.com.ng') return null; // not a testflow subdomain
  const subdomain = parts.slice(0, -2).join('.');
  return subdomain || null;
};