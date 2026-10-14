import crypto from 'node:crypto';
import { config } from '../../config/env.js';

/**
 * Domain-separated keyed hash. Used to give campaigns a stable training-data
 * key that is NOT the database id: after the campaign is purged the key can
 * no longer be tied back to any campaign content or advertiser.
 */
export const pseudonym = (domain, value) =>
  crypto
    .createHmac('sha256', config.ADS_EVENT_SECRET ?? `${config.JWT_ACCESS_SECRET}:ads-events`)
    .update(`${domain}|${value}`)
    .digest('hex')
    .slice(0, 24);

export const campaignKeyOf = (campaignId) => pseudonym('training-campaign', String(campaignId));
