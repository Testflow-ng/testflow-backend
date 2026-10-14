import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/env.js';
import { AuthCode } from '../models/AuthCode.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { hasMembership, defaultActiveProduct } from '../utils/identity.js';
import { verifyPkce } from '../utils/pkce.js';
import { signAccessToken } from './token.service.js';
import { recordAction } from './audit.service.js';
import { accountPayload } from './identity.service.js';

const CODE_TTL_MS = 2 * 60 * 1000;
const clientsSchema = z.array(z.object({ id: z.string().min(1).max(60), redirectUris: z.array(z.string().url()).min(1) }));

let override = null;
/** Test hook. */
export const setClientsForTests = (clients) => { override = clients; };

/** Allow-listed clients from AUTH_CLIENTS (JSON). Invalid config = no clients (fail closed). */
export const getClients = () => {
  if (override) return override;
  if (!config.AUTH_CLIENTS) return [];
  try {
    return clientsSchema.parse(JSON.parse(config.AUTH_CLIENTS));
  } catch {
    return [];
  }
};

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const bad = (code, msg, status = 400) => new AppError(status, code, msg);

const validateRedirect = (clientId, redirectUri) => {
  const client = getClients().find((c) => c.id === clientId);
  if (!client) throw bad('INVALID_CLIENT', 'Unknown client.');
  // Exact string match only — no prefix/wildcard matching.
  if (!client.redirectUris.includes(redirectUri)) throw bad('INVALID_REDIRECT_URI', 'Redirect URI is not allowed for this client.');
  const u = new URL(redirectUri);
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && !config.isProduction)) throw bad('INVALID_REDIRECT_URI', 'Redirect URI must use https.');
  if (u.hash) throw bad('INVALID_REDIRECT_URI', 'Redirect URI must not contain a fragment.');
  return u;
};

/** Issue a single-use code for the signed-in user. The client must later present the PKCE verifier. */
export const issueCode = async (user, { clientId, redirectUri, codeChallenge, state, product }, req) => {
  const target = validateRedirect(clientId, redirectUri);
  if (product && !hasMembership(user, product)) {
    const err = bad('NO_MEMBERSHIP', `This account does not have access to ${product}.`, 403);
    err.details = { product, canJoin: true };
    throw err;
  }
  const code = crypto.randomBytes(32).toString('base64url');
  await AuthCode.create({
    codeHash: sha256(code), user: user._id, clientId, redirectUri, codeChallenge, product, expireAt: new Date(Date.now() + CODE_TTL_MS),
  });
  target.searchParams.set('code', code);
  if (state) target.searchParams.set('state', state);
  await recordAction({ actorId: user._id, action: 'OAUTH_CODE_ISSUED', targetId: user._id, targetType: 'User', metadata: { clientId, product }, req });
  return { redirectTo: target.toString() };
};

/** Exchange code + verifier for a short-lived bearer access token. The code is burned on first use, valid or not. */
export const exchangeCode = async ({ code, codeVerifier, clientId, redirectUri }, req) => {
  const doc = await AuthCode.findOneAndUpdate(
    { codeHash: sha256(code), usedAt: null, expireAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true },
  );
  const invalid = () => bad('INVALID_GRANT', 'The authorization code is invalid, expired or already used.');
  if (!doc) throw invalid();
  if (doc.clientId !== clientId || doc.redirectUri !== redirectUri) throw invalid();
  if (!verifyPkce(codeVerifier, doc.codeChallenge)) throw invalid();

  const user = await User.findById(doc.user).select('+tokenVersion');
  if (!user) throw invalid();
  const activeProduct = defaultActiveProduct(user, doc.product);
  const accessToken = signAccessToken(user, activeProduct, { cid: clientId });
  const { exp, iat } = jwt.decode(accessToken);
  await recordAction({ actorId: user._id, action: 'OAUTH_TOKEN_ISSUED', targetId: user._id, targetType: 'User', metadata: { clientId }, req });
  return { accessToken, tokenType: 'Bearer', expiresIn: exp - iat, ...(await accountPayload(user, activeProduct)) };
};
