import { asyncHandler } from '../middleware/asyncHandler.js';
import { User } from '../models/User.js';
import { AdvertiserProfile } from '../models/AdvertiserProfile.js';
import { AdAsset } from '../models/AdAsset.js';
import { AppError } from '../utils/AppError.js';
import * as identity from '../services/identity.service.js';
import { setAuthCookies } from '../services/token.service.js';
import * as campaigns from '../services/ads/campaign.service.js';
import * as payments from '../services/ads/payment.service.js';
import * as analytics from '../services/ads/analytics.service.js';
import * as settingsSvc from '../services/ads/settings.service.js';
import { uploadAdAsset } from '../services/ads/image.service.js';

// ---------- auth & profile: thin wrappers over the centralized identity ----------
const profileOf = (userId) => AdvertiserProfile.findOne({ user: userId });
/** Legacy response shape ({user, profile}) plus the new identity fields. */
const adsSession = async (res, status, user, activeProduct = 'ads') => {
  const payload = await identity.accountPayload(user, activeProduct);
  const csrfToken = setAuthCookies(res, user, payload.activeProduct);
  res.status(status).json({ ...payload, profile: await profileOf(user._id), csrfToken });
};

export const register = asyncHandler(async (req, res) => {
  const { fullName, email, password, businessName, contactPhone } = req.body;
  const user = await identity.registerAccount({ product: 'ads', fullName, email, password, profile: { businessName, contactPhone } }, req);
  await adsSession(res, 201, user);
});

export const login = asyncHandler(async (req, res) => {
  const { user, activeProduct } = await identity.loginAccount({ ...req.body, product: 'ads' }, req);
  await adsSession(res, 200, user, activeProduct);
});

export const me = asyncHandler(async (req, res) => {
  const payload = await identity.accountPayload(req.user, req.activeProduct);
  res.json({ ...payload, profile: await profileOf(req.user._id) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, ...rest } = req.body;
  if (fullName) await User.updateOne({ _id: req.user._id }, { $set: { fullName } });
  const profile = await AdvertiserProfile.findOneAndUpdate({ user: req.user._id }, { $set: rest }, { new: true });
  res.json({ user: await User.findById(req.user._id), profile });
});

// ---------- pricing & settings ----------
export const pricing = asyncHandler(async (_req, res) => res.json({ settings: settingsSvc.publicSettings(await settingsSvc.getSettings()) }));
export const quote = asyncHandler(async (req, res) => res.json(await payments.quote(req.user, req.body.campaignIds)));

// ---------- assets ----------
export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(422, 'VALIDATION_ERROR', 'Attach an image in the "image" field.');
  const asset = await uploadAdAsset(req.user, req.file.buffer, await settingsSvc.getSettings());
  res.status(201).json({ asset: { id: String(asset._id), url: asset.url, width: asset.width, height: asset.height, bytes: asset.bytes, format: asset.format } });
});

export const deleteAsset = asyncHandler(async (req, res) => {
  const asset = await AdAsset.findOne({ _id: req.params.id, owner: req.user._id });
  if (!asset) throw new AppError(404, 'NOT_FOUND', 'Asset not found.');
  const { Campaign } = await import('../models/Campaign.js');
  if (await Campaign.exists({ image: asset._id })) throw new AppError(409, 'ASSET_IN_USE', 'This image is used by a campaign.');
  const { deleteStoredImage } = await import('../services/ads/image.service.js');
  await deleteStoredImage(asset.storageKey);
  await asset.deleteOne();
  res.status(204).end();
});

// ---------- campaigns ----------
export const dashboard = asyncHandler(async (req, res) => res.json(await campaigns.dashboardSummary(req.user)));
export const list = asyncHandler(async (req, res) => res.json(await campaigns.listCampaigns(req.user, req.query)));
export const create = asyncHandler(async (req, res) => res.status(201).json({ campaign: await campaigns.createCampaign(req.user, req.body) }));
export const get = asyncHandler(async (req, res) => res.json(await campaigns.getCampaign(req.user, req.params.id)));
export const update = asyncHandler(async (req, res) => res.json({ campaign: await campaigns.updateCampaign(req.user, req.params.id, req.body) }));
export const remove = asyncHandler(async (req, res) => { await campaigns.deleteDraft(req.user, req.params.id); res.status(204).end(); });
export const resubmit = asyncHandler(async (req, res) => res.json({ campaign: await campaigns.resubmit(req.user, req.params.id) }));
export const archive = asyncHandler(async (req, res) => res.json({ campaign: await campaigns.archive(req.user, req.params.id) }));
export const republish = asyncHandler(async (req, res) => res.status(201).json({ campaign: await campaigns.republish(req.user, req.params.id) }));
export const campaignAnalytics = asyncHandler(async (req, res) => {
  const c = await campaigns.findOwned(req.user, req.params.id);
  res.json(await analytics.campaignAnalytics(c, req.query));
});

// ---------- checkout & payments ----------
export const checkout = asyncHandler(async (req, res) => {
  const key = req.get('Idempotency-Key')?.slice(0, 100);
  res.status(201).json(await payments.createCheckout(req.user, { ...req.body, idempotencyKey: key }, req));
});
export const cancelCheckout = asyncHandler(async (req, res) => res.json(await payments.cancelCheckout(req.user, req.params.id)));
export const verifyPayment = asyncHandler(async (req, res) => {
  const { payment } = await payments.verifyByReference(req.query.reference, { source: 'client-verify', advertiserId: req.user._id });
  res.json(payments.checkoutView(payment));
});
export const myPayments = asyncHandler(async (req, res) => {
  const out = await payments.listPayments({ advertiser: req.user._id }, req.query);
  res.json({ ...out, items: out.items.map((p) => ({ ...payments.checkoutView(p), createdAt: p.createdAt, paidAt: p.paidAt })) });
});

/** Public, signature-protected. Always 200 for valid signatures so the provider stops retrying. */
export const webhook = asyncHandler(async (req, res) => {
  const result = await payments.handleWebhook(req.rawBody, req.get('x-paystack-signature'), req.body);
  res.status(200).json({ received: true, ...result });
});
