import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { AuthCode } from '../models/AuthCode.js';
import { User } from '../models/User.js';
import { OauthConsent } from '../models/OauthConsent.js';
import { OrgMembership } from '../models/OrgMembership.js';
import { AppError } from '../utils/AppError.js';
import { findSiteByHostname } from './orgSite.service.js';
import { recordAction } from './audit.service.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_TTL = '10m';
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const HANDOFF_CLIENT = 'tenant-handoff';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export const googleEnabled = () => Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);

const isLocalOrigin = (origin) => {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(origin).hostname) && !config.isProduction;
  } catch {
    return false;
  }
};

/**
 * Build the Google consent URL. `host` (optional) is an organisation site to hand the person back to;
 * `returnTo` is the origin the browser started on. Both are checked, so the callback can never be
 * pointed at an arbitrary address.
 */
export const startUrl = async ({ host, returnTo }) => {
  if (!googleEnabled()) throw new AppError(503, 'GOOGLE_DISABLED', 'Google sign-in is not set up.');
  const payload = { n: crypto.randomBytes(8).toString('hex') };
  if (host) {
    const site = await findSiteByHostname(String(host).toLowerCase());
    if (!site) throw new AppError(404, 'TENANT_NOT_FOUND', 'This site is not set up yet.');
    const origin = returnTo && isLocalOrigin(returnTo) ? new URL(returnTo).origin : `https://${site.host ?? host}`;
    payload.h = String(host).toLowerCase();
    payload.o = origin;
  }
  const state = jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: STATE_TTL });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();
  return url.toString();
};

/** Swap Google's code for the person's verified profile (the id_token arrives straight from Google over TLS). */
const profileFromCode = async (code) => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new AppError(401, 'GOOGLE_EXCHANGE_FAILED', 'Google sign-in failed. Try again.');
  const { id_token: idToken } = await res.json();
  const claims = jwt.decode(idToken);
  if (!claims?.email || claims.email_verified !== true || claims.aud !== config.GOOGLE_CLIENT_ID) {
    throw new AppError(401, 'GOOGLE_UNVERIFIED', 'Google could not confirm this email address.');
  }
  return { email: claims.email.toLowerCase(), fullName: claims.name || claims.email.split('@')[0] };
};

/** Find the account for a Google profile, or make one. A new account is a student account. */
export const userFromProfile = async ({ email, fullName }, req) => {
  let user = await User.findOne({ email }).select('+tokenVersion');
  if (!user) {
    user = await User.create({
      fullName, email, passwordHash: crypto.randomBytes(32).toString('hex'), role: 'student', isEmailVerified: true,
      memberships: [{ product: 'student', role: 'student' }],
    });
    await recordAction({ actorId: user._id, action: 'AUTH_REGISTER', targetId: user._id, targetType: 'User', metadata: { via: 'google' }, req });
  }
  return user;
};

/** Handle Google's redirect. Returns where to send the browser and, for the main app, the user to sign in. */
export const handleCallback = async ({ code, state }, req) => {
  let st;
  try {
    st = jwt.verify(String(state), config.JWT_ACCESS_SECRET);
  } catch {
    throw new AppError(400, 'INVALID_STATE', 'This sign-in link has expired. Start again.');
  }
  const user = await userFromProfile(await profileFromCode(code), req);
  if (!st.h) return { user, redirectTo: config.CLIENT_URL };

  const handoff = crypto.randomBytes(32).toString('base64url');
  await AuthCode.create({
    codeHash: sha256(handoff), user: user._id, clientId: HANDOFF_CLIENT, redirectUri: st.h, codeChallenge: 'none',
    expireAt: new Date(Date.now() + HANDOFF_TTL_MS),
  });
  return { user: null, redirectTo: `${st.o}/auth/complete?code=${handoff}` };
};

/** The organisation site trades its one-time handoff code for a student session. */
export const completeHandoff = async ({ code, org, host }, req) => {
  const doc = await AuthCode.findOneAndUpdate(
    { codeHash: sha256(String(code)), clientId: HANDOFF_CLIENT, usedAt: null, expireAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!doc || doc.redirectUri !== host) throw new AppError(400, 'INVALID_GRANT', 'This sign-in link has expired. Start again.');
  const user = await User.findById(doc.user).select('+tokenVersion');
  if (!user) throw new AppError(400, 'INVALID_GRANT', 'This sign-in link has expired. Start again.');
  await joinOrg(org._id, user);
  await recordAction({ actorId: user._id, action: 'TENANT_GOOGLE_LOGIN', targetId: org._id, targetType: 'Organization', req });
  return user;
};

/** Make the person a student of the organisation, unless the organisation suspended them. */
export const joinOrg = async (orgId, user) => {
  const existing = await OrgMembership.findOne({ organization: orgId, user: user._id });
  if (existing) {
    if (existing.status === 'suspended') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your access to this organisation has been suspended. Contact them for help.');
    if (existing.status === 'active') return existing;
    existing.status = 'active';
    return existing.save();
  }
  return OrgMembership.create({ organization: orgId, user: user._id, role: 'student', status: 'active' });
};

const TESTFLOW_CLIENT = 'testflow-everyone';

/** An organisation site may be handed back to only if it is a real tenant (or localhost in development). */
export const trustedSiteOrigin = async (origin) => {
  let u;
  try { u = new URL(String(origin)); } catch { return null; }
  if (isLocalOrigin(u.origin)) return u.origin;
  if (u.protocol !== 'https:') return null;
  return (await findSiteByHostname(u.hostname.toLowerCase())) ? u.origin : null;
};

/** Redirect target for "Log in with Testflow": the state names the organisation site to return to. */
export const testflowReturn = async ({ code, state }) => {
  let origin = null;
  try { origin = (JSON.parse(Buffer.from(String(state), 'base64url').toString()) || {}).o; } catch { /* handled below */ }
  const trusted = await trustedSiteOrigin(origin);
  if (!trusted) throw new AppError(400, 'INVALID_STATE', 'This sign-in link is not valid.');
  return `${trusted}/auth/testflow?${new URLSearchParams({ code, state })}`;
};

/** The person rejected on the authorize page: send them back to the site they came from. */
export const testflowDenied = async ({ state }) => {
  const back = (await testflowReturn({ code: 'denied', state })).replace('/auth/testflow?', '/signin?');
  const url = new URL(back);
  return `${url.origin}/signin?error=cancelled`;
};

/** The organisation site redeems the code with its PKCE verifier and the person becomes its student. */
export const completeTestflow = async ({ code, codeVerifier, redirectUri, org }, req) => {
  const { redeemCode } = await import('./oauth.service.js');
  const doc = await redeemCode({ code, codeVerifier, clientId: TESTFLOW_CLIENT, redirectUri });
  const user = await User.findById(doc.user).select('+tokenVersion');
  if (!user) throw new AppError(400, 'INVALID_GRANT', 'This sign-in link has expired. Start again.');
  await joinOrg(org._id, user);
  await recordAction({ actorId: user._id, action: 'TENANT_GOOGLE_LOGIN', targetId: org._id, targetType: 'Organization', metadata: { via: 'testflow' }, req });
  return user;
};

const siteFromState = async (state) => {
  let origin = null;
  try { origin = (JSON.parse(Buffer.from(String(state), 'base64url').toString()) || {}).o; } catch { return null; }
  const trusted = await trustedSiteOrigin(origin);
  if (!trusted) return null;
  const host = new URL(trusted).hostname;
  const site = await findSiteByHostname(host);
  return { host, name: site?.config?.published?.brand?.name || site?.org?.name || host };
};

/** Has this person already approved the site named in `state`? Also returns the verified site name for the screen. */
export const testflowConsent = async (user, state) => {
  const site = await siteFromState(state);
  if (!site) throw new AppError(400, 'INVALID_STATE', 'This sign-in link is not valid.');
  const granted = Boolean(await OauthConsent.exists({ user: user._id, clientId: TESTFLOW_CLIENT, site: site.host }));
  return { site: site.host, name: site.name, granted };
};

/** Remember the approval, so the next "Log in with Testflow" on this site goes straight through. */
export const rememberTestflowConsent = async (user, state) => {
  const site = await siteFromState(state);
  if (!site) return;
  await OauthConsent.updateOne({ user: user._id, clientId: TESTFLOW_CLIENT, site: site.host }, { $setOnInsert: {} }, { upsert: true });
};
