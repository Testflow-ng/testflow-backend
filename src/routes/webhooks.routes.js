import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as studentPurchases from '../services/studentPurchase.service.js';
import * as orgSubs from '../services/orgSubscription.service.js';
import { handleTransferWebhook, WITHDRAWAL_PREFIX } from '../services/orgWithdrawal.service.js';
import { REFERENCE_PREFIX } from '../services/studentPurchase.service.js';

const router = Router();

/**
 * Central Paystack webhook (Test/Live uses one webhook URL per environment in dashboard).
 * Raw-body capture and signature verification happen in the delegated handlers/services.
 *
 * Dispatch by reference prefix:
 * - TFS-*  => student plan/Plus purchases
 * - SUB-*  => TestFlow for Everyone org subscriptions (Pro/Studio)
 * - WD-*   => organisation withdrawals (transfer.success / failed / reversed)
 *
 * Unknown references are acknowledged safely (ignored) by the relevant handler logic;
 * invalid signatures / malformed payloads / processing failures are not acknowledged as
 * successful settlement.
 */
router.post(
  '/paystack',
  asyncHandler(async (req, res) => {
    const signature = req.get('x-paystack-signature');
    const body = req.body;
    const reference = body?.data?.reference;

    if (!reference) {
      // Student handler validates payload shape/signature semantics consistently.
      const result = await studentPurchases.handleWebhook({ rawBody: req.rawBody, signature, body });
      return res.json({ endpoint: 'paystack', ...result });
    }

    if (String(reference).startsWith(REFERENCE_PREFIX)) {
      const result = await studentPurchases.handleWebhook({ rawBody: req.rawBody, signature, body });
      return res.json({ endpoint: 'paystack', source: 'student_subscription', ...result });
    }

    if (String(reference).startsWith('SUB-')) {
      const result = await orgSubs.handleSubscriptionWebhook(req.rawBody, signature, body);
      return res.json({ endpoint: 'paystack', source: 'org_subscription', ...result });
    }

    if (String(reference).startsWith(WITHDRAWAL_PREFIX)) {
      const result = await handleTransferWebhook(req.rawBody, signature, body);
      return res.json({ endpoint: 'paystack', source: 'org_withdrawal', ...result });
    }

    // Not a subscription reference handled by this consolidation (ads/tenant exam payments
    // may use separate configured webhooks). Acknowledge as ignored without side effects.
    return res.json({ endpoint: 'paystack', ignored: true, reference });
  }),
);

export default router;
