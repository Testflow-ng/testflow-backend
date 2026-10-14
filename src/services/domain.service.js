import crypto from 'node:crypto';
import { OrgDomain } from '../models/OrgDomain.js';
import { AppError } from '../utils/AppError.js';

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

export const checkDomainVerification = async (hostname) => {
  const orgDomain = await OrgDomain.findOne({ hostname }).lean();
  if (!orgDomain) return null;
  if (orgDomain.status === 'active') return { status: 'active' };
  if (orgDomain.status === 'removed') return null;
  if (orgDomain.verification?.expiresAt && new Date(orgDomain.verification.expiresAt) < new Date()) {
    await OrgDomain.findByIdAndUpdate(orgDomain._id, { $inc: { 'verification.failures': 1 }, status: 'failed' });
    return { status: 'failed' };
  }
  return { status: orgDomain.status };
};

export const attemptSubdomain = async (org, subdomain) => {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Subdomain must be lowercase letters, numbers, and single hyphens.');
  }
  if (subdomain.length < 3 || subdomain.length > 30) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Subdomain must be 3–30 characters.');
  }
  if (subdomain.includes('--')) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Consecutive hyphens are not allowed.');
  }
  const reserved = ['www', 'api', 'admin', 'ads', 'app', 'mail', 'cdn', 'static', 'everybody', 'status', 'support', 'billing', 'login'];
  if (reserved.includes(subdomain)) {
    throw new AppError(422, 'SUBDOMAIN_RESERVED', 'That subdomain is reserved.');
  }
  let orgDomain = await OrgDomain.findOne({ organization: org._id, hostname: subdomain + '.testflow.com.ng' }).lean();
  if (!orgDomain) {
    orgDomain = await OrgDomain.create({
      organization: org._id,
      hostname: subdomain + '.testflow.com.ng',
      type: 'subdomain',
    });
  }
  if (orgDomain.status === 'active') return { success: true, domain: orgDomain.hostname };
  if (orgDomain.status === 'pending') {
    if (orgDomain.verification?.token) {
      return { success: false, domain: orgDomain.hostname, status: 'pending', needsVerification: true };
    }
    const token = crypto.randomBytes(16).toString('hex');
    await OrgDomain.findByIdAndUpdate(orgDomain._id, {
      'verification.token': token,
      'verification.expiresAt': new Date(Date.now() + SIX_DAYS_MS),
    });
    return { success: false, domain: orgDomain.hostname, status: 'pending', needsVerification: true, token };
  }
  if (orgDomain.status === 'failed') {
    throw new AppError(409, 'DOMAIN_NOT_VERIFIED', 'Previous verification attempts failed. Contact support.');
  }
  throw new AppError(404, 'NOT_FOUND', 'Organization domain not found.');
};

export const verifyDomainByDns = async (orgDomainId, token) => {
  const orgDomain = await OrgDomain.findById(orgDomainId).lean();
  if (!orgDomain || orgDomain.verification.token !== token) {
    throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Invalid or expired verification token.');
  }
  await OrgDomain.findByIdAndUpdate(orgDomain._id, {
    'verification.method': 'dns',
    'verification.verifiedAt': new Date(),
    'verification.failures': 0,
    status: 'active',
  });
  return { success: true, domain: orgDomain.hostname, status: 'active' };
};

export const listOrgDomains = async (orgId) => {
  return OrgDomain.find({ organization: orgId })
    .select('hostname type status verification.verifiedAt verification.method')
    .sort({ createdAt: -1 })
    .lean();
};

export const isSubdomainAvailable = async (orgId, subdomain) => {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain)) return false;
  if (subdomain.length < 3 || subdomain.length > 30) return false;
  if (subdomain.includes('--')) return false;
  const reserved = ['www', 'api', 'admin', 'ads', 'app', 'mail', 'cdn', 'static', 'everybody', 'status', 'support', 'billing', 'login'];
  if (reserved.includes(subdomain)) return false;
  const existing = await OrgDomain.findOne({
    organization: orgId,
    hostname: subdomain + '.testflow.com.ng',
    status: 'active',
  }).lean();
  return !existing;
};

export const getOrgDomainByHostname = async (hostname) => {
  return OrgDomain.findOne({ hostname }).lean();
};