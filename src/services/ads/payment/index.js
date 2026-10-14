import { config } from '../../../config/env.js';
import { paystackProvider } from './paystack.js';

let override = null;
/** Test hook: inject a fake provider. Pass null to restore. */
export const setProviderForTests = (p) => {
  override = p;
};

/** Returns the configured provider or null when none is configured. */
export const getProvider = () => {
  if (override) return override;
  if (config.PAYMENT_PROVIDER === 'paystack' && config.PAYSTACK_SECRET_KEY) return paystackProvider;
  return null;
};
