import dns from 'node:dns/promises';
import { OrgDomain } from '../models/OrgDomain.js';
import { AppError } from '../utils/AppError.js';
import { RESERVED_SLUGS } from '../validators/everybody.schema.js';

/**
 * The addresses an organisation is reachable on: a platform subdomain (`jamb.testflow.com.ng`) or
 * a domain the owner brings. A subdomain belongs to the platform, so it is live as soon as it is
 * claimed; a custom domain is verified against DNS before it goes live.
 */

const SUBDOMAIN_HOST = 'testflow.com.ng';
const CUSTOM_CNAME_TARGET = 'sites.testflow.com.ng';
const VERIFICATION_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const token = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export const toDomainView = (domain) => {
  const verification = domain.verification ?? {};
  const records = [];
  if (domain.type === 'custom') {
    records.push({ type: 'CNAME', host: domain.hostname, value: CUSTOM_CNAME_TARGET });
    if (verification.token) records.push({ type: 'TXT', host: `_testflow.${domain.hostname}`, value: verification.token });
  }
  return {
    id: String(domain._id),
    hostname: domain.hostname,
    type: domain.type,
    status: domain.status,
    isPrimary: Boolean(domain.isPrimary),
    verifiedAt: domain.verifiedAt ?? null,
    expiresAt: verification.expiresAt ?? null,
    records: domain.status === 'active' ? [] : records,
  };
};

export const listDomains = async (orgId) => {
  const rows = await OrgDomain.find({ organization: orgId, status: { $ne: 'removed' } })
    .select('+verification.token')
    .sort({ createdAt: -1 })
    .lean();
  return { items: rows.map(toDomainView), total: rows.length };
};

/** A free subdomain is available unless it is reserved or already claimed anywhere on the platform. */
export const checkSubdomain = async (name) => {
  const label = String(name ?? '').trim().toLowerCase();
  if (label.length < 3 || label.length > 30) return { available: false, reason: 'Use 3 to 30 characters.' };
  if (!LABEL_RE.test(label) || label.includes('--')) return { available: false, reason: 'Use lowercase letters, numbers and single hyphens.' };
  if (RESERVED_SLUGS.includes(label)) return { available: false, reason: 'That name is reserved.' };

  const hostname = `${label}.${SUBDOMAIN_HOST}`;
  const taken = await OrgDomain.findOne({ hostname, status: { $ne: 'removed' } }).lean();
  if (taken) return { available: false, reason: 'That name is already taken.', hostname };
  return { available: true, hostname };
};

export const addDomain = async (org, { type, hostname }) => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  if (type === 'subdomain') {
    if (!host.endsWith(`.${SUBDOMAIN_HOST}`)) {
      throw new AppError(422, 'VALIDATION_ERROR', `A free address must end in .${SUBDOMAIN_HOST}.`);
    }
    const label = host.slice(0, -(`.${SUBDOMAIN_HOST}`.length));
    const available = await checkSubdomain(label);
    if (!available.available) throw new AppError(409, 'SUBDOMAIN_TAKEN', available.reason ?? 'That name is taken.');

    const created = await OrgDomain.create({ organization: org._id, hostname: host, type, status: 'active', verifiedAt: new Date() });
    return toDomainView(created.toObject());
  }

  if (host.split('.').length < 2 || !/^[a-z0-9.-]+$/.test(host)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Enter a domain such as exams.mybrand.com.');
  }
  const existing = await OrgDomain.findOne({ hostname: host, status: { $ne: 'removed' } }).select('organization').lean();
  if (existing) throw new AppError(409, 'DOMAIN_TAKEN', 'That domain is already connected.');

  const created = await OrgDomain.create({
    organization: org._id,
    hostname: host,
    type: 'custom',
    status: 'pending',
    verification: { method: 'cname', token: token(), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
  });
  return toDomainView(created.toObject());
};

/**
 * Re-check a custom domain against DNS. A CNAME that points at our target, or the TXT token, is
 * enough to go live; anything else leaves it pending so the owner can try again after the record
 * propagates.
 */
export const verifyDomain = async (orgId, domainId) => {
  const domain = await OrgDomain.findOne({ _id: domainId, organization: orgId, status: { $ne: 'removed' } })
    .select('+verification.token')
    .lean();
  if (!domain) throw new AppError(404, 'DOMAIN_NOT_FOUND', 'That domain is not connected.');

  if (domain.type === 'subdomain') {
    const updated = await OrgDomain.findByIdAndUpdate(
      domain._id,
      { $set: { status: 'active', verifiedAt: new Date(), 'verification.lastCheckedAt': new Date() } },
      { new: true },
    ).lean();
    return toDomainView(updated);
  }

  let verified = false;
  try {
    const cnames = await dns.resolveCname(domain.hostname);
    if (cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === CUSTOM_CNAME_TARGET)) verified = true;
  } catch { /* no CNAME yet */ }

  if (!verified && domain.verification?.token) {
    try {
      const rows = await dns.resolveTxt(`_testflow.${domain.hostname}`);
      if (rows.flat().join('').includes(domain.verification.token)) verified = true;
    } catch { /* no TXT yet */ }
  }

  const updated = await OrgDomain.findByIdAndUpdate(
    domain._id,
    verified
      ? { $set: { status: 'active', verifiedAt: new Date(), 'verification.lastCheckedAt': new Date(), 'verification.failures': 0 } }
      : { $set: { 'verification.lastCheckedAt': new Date() }, $inc: { 'verification.failures': 1 } },
    { new: true },
  ).lean();
  return toDomainView(updated);
};

export const removeDomain = async (orgId, domainId) => {
  const removed = await OrgDomain.findOneAndDelete({ _id: domainId, organization: orgId }).lean();
  if (!removed) throw new AppError(404, 'DOMAIN_NOT_FOUND', 'That domain is not connected.');
  return { id: String(domainId), removed: true };
};
