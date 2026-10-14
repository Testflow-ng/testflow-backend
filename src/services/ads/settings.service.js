import { AdSettings } from '../../models/AdSettings.js';
import { recordAction } from '../audit.service.js';
import { validationError } from '../../utils/ads/errors.js';

const PUBLIC_FIELDS = [
  'dailyFeeKobo', 'pricingPolicy', 'tiers', 'minDurationDays', 'maxDurationDays', 'maxDescriptionWords',
  'maxTitleChars', 'maxKeywordChars', 'maxCampaignsPerCheckout', 'imageTargetBytes', 'imageMaxBytes',
  'retentionDays', 'rejectedRetentionDays', 'termsVersion', 'termsUrl', 'contentRulesUrl', 'privacyUrl',
];

export const getSettings = async () => (await AdSettings.getInstance()).toObject();

/** Settings safe to show advertisers (no serving internals). */
export const publicSettings = (s) => {
  const out = { currency: 'NGN', recommendedDescriptionWords: 60 };
  for (const f of PUBLIC_FIELDS) out[f] = s[f];
  return out;
};

export const updateSettings = async (patch, req) => {
  const current = await AdSettings.getInstance();
  const merged = { ...current.toObject(), ...patch };
  if (merged.minDurationDays > merged.maxDurationDays) {
    throw validationError({ minDurationDays: 'minDurationDays cannot exceed maxDurationDays' });
  }
  if (merged.imageTargetBytes > merged.imageMaxBytes) {
    throw validationError({ imageTargetBytes: 'imageTargetBytes cannot exceed imageMaxBytes' });
  }
  const before = {};
  for (const k of Object.keys(patch)) before[k] = current[k];
  current.set(patch);
  await current.save();
  await recordAction({
    actorId: req.user._id, action: 'AD_SETTINGS_UPDATE', targetId: current._id, targetType: 'AdSettings',
    metadata: { before, after: patch }, req,
  });
  return current.toObject();
};
