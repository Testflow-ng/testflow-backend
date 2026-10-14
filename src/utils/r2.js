import crypto from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from './AppError.js';

/**
 * Minimal Cloudflare R2 client (S3-compatible, AWS Signature V4) built on
 * node:crypto + fetch — no SDK dependency. Supports PUT, DELETE and presigned PUT.
 */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => p.split('/').map(enc).join('/');

const signingKey = (secret, date, region, service) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');

/**
 * Compute a SigV4 signature. Pure (all inputs explicit) so it can be verified
 * against AWS's published test vectors.
 * `headers` must include every header to sign (lowercase names); `host` is required.
 */
export const signV4 = ({ method, path, query = {}, headers, payloadHash, accessKeyId, secretAccessKey, region, service = 's3', amzDate }) => {
  const date = amzDate.slice(0, 8);
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalRequest = [method, encPath(path), canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, date, region, service)).update(toSign).digest('hex');
  return { signature, signedHeaders, scope, credential: `${accessKeyId}/${scope}` };
};

const creds = () => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = config;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured.');
  }
  return {
    host: `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: R2_BUCKET, accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY, publicUrl: R2_PUBLIC_URL.replace(/\/$/, ''),
  };
};

const stamp = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260101T120000Z

export const publicUrlFor = (key) => `${creds().publicUrl}/${key}`;

const send = async (method, key, { body, contentType, cacheControl } = {}) => {
  const c = creds();
  const amzDate = stamp();
  const payloadHash = sha256(body ?? '');
  const path = `/${c.bucket}/${key}`;
  const headers = { host: c.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  if (cacheControl) headers['cache-control'] = cacheControl;
  const s = signV4({ method, path, headers, payloadHash, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: 'auto', amzDate });
  const res = await fetch(`https://${c.host}${encPath(path)}`, {
    method,
    headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${s.credential}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}` },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    const err = new Error(`R2 ${method} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
};

export const putObject = (key, body, contentType, cacheControl = 'public, max-age=31536000, immutable') =>
  send('PUT', key, { body, contentType, cacheControl });

/** Missing objects count as deleted. */
export const deleteObject = (key) => send('DELETE', key);

/** Short-lived URL a browser can PUT a file to directly (payload unsigned). */
export const presignPut = (key, { expiresSec = 300 } = {}) => {
  const c = creds();
  const amzDate = stamp();
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${c.accessKeyId}/${scope}`, 'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec), 'X-Amz-SignedHeaders': 'host',
  };
  const path = `/${c.bucket}/${key}`;
  const { signature } = signV4({
    method: 'PUT', path, query, headers: { host: c.host }, payloadHash: 'UNSIGNED-PAYLOAD',
    accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: 'auto', amzDate,
  });
  const qs = Object.keys({ ...query }).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  return { uploadUrl: `https://${c.host}${encPath(path)}?${qs}&X-Amz-Signature=${signature}`, publicUrl: publicUrlFor(key), key, expiresInSec: expiresSec };
};
