import { AppError } from '../AppError.js';

/**
 * Pure pricing. All money is integer KOBO (₦1 = 100 kobo) to avoid float drift.
 * Policy "flat": days × dailyFee.
 * Policy "tiered": the highest tier whose `minDays` <= days gives `percentOff`
 * off the whole total (rounded down to a whole kobo in the advertiser's favour
 * never; rounded to nearest kobo).
 */
export const computePrice = ({ dailyFeeKobo, pricingPolicy = 'flat', tiers = [] }, days) => {
  if (!Number.isInteger(days) || days < 1) {
    throw new AppError(422, 'INVALID_DURATION', 'Duration must be a whole number of days.');
  }
  const gross = dailyFeeKobo * days;
  let percentOff = 0;
  if (pricingPolicy === 'tiered') {
    for (const tier of tiers) {
      if (days >= tier.minDays && tier.percentOff > percentOff) percentOff = tier.percentOff;
    }
  }
  const discountKobo = Math.round((gross * percentOff) / 100);
  return {
    days,
    dailyFeeKobo,
    grossKobo: gross,
    percentOff,
    discountKobo,
    totalKobo: gross - discountKobo,
    currency: 'NGN',
  };
};

export const koboToNaira = (kobo) => kobo / 100;
