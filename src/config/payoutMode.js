/**
 * How an organisation's money reaches it.
 *
 *  'direct': Paystack splits each payment at source. Testflow's percent stays in Testflow's Paystack
 *            balance automatically and the organisation's share settles to its bank (1 to 2 working days).
 *            There is no wallet and no Withdraw button.
 *  'wallet': every payment lands with Testflow and the owner withdraws their share with a Paystack
 *            transfer. Needs Paystack Transfers enabled on the account.
 *
 * Hardcoded to 'direct' for now. To make it configurable later, return `process.env.ORG_PAYOUT_MODE`
 * (validated against the two values above) from `payoutMode()`; nothing else needs to change.
 */
let mode = 'direct';

export const payoutMode = () => mode;
export const walletMode = () => mode === 'wallet';

/** Tests flip the mode and put it back. */
export const setPayoutModeForTests = (next) => { mode = next; };
