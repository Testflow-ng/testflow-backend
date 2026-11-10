// Restore organisations that paid for a plan but still show Free.
// Dry run by default:   MONGODB_URI="<prod uri>" node scripts/repair-paid-subscriptions.mjs
// Apply the repair:     MONGODB_URI="<prod uri>" node scripts/repair-paid-subscriptions.mjs --apply
import mongoose from 'mongoose';
import { SubscriptionPayment } from '../src/models/SubscriptionPayment.js';
import { Subscription } from '../src/models/Subscription.js';
import { healPaidSubscription } from '../src/services/orgSubscription.service.js';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('Set MONGODB_URI first.'); process.exit(1); }
const apply = process.argv.includes('--apply');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const orgIds = await SubscriptionPayment.distinct('organization', { status: 'paid', planKey: { $ne: 'free' }, paidAt: { $gte: since } });
let fixed = 0;
for (const orgId of orgIds) {
  const best = (await Subscription.find({ organization: orgId, status: 'active' }).lean())
    .sort((a, b) => ['free', 'pro', 'studio'].indexOf(b.planKey) - ['free', 'pro', 'studio'].indexOf(a.planKey))[0];
  const pay = await SubscriptionPayment.findOne({ organization: orgId, status: 'paid', planKey: { $ne: 'free' }, paidAt: { $gte: since } }).sort({ paidAt: -1 }).lean();
  const needs = !best || best.planKey === 'free' || best.lastPaymentId !== String(pay._id) && best.planKey !== pay.planKey;
  console.log(`${needs ? 'NEEDS REPAIR' : 'ok          '} org=${orgId} paid=${pay.planKey} ref=${pay.reference} now=${best?.planKey ?? 'none'}`);
  if (needs && apply) { await healPaidSubscription(orgId); fixed += 1; }
}
console.log(apply ? `Repaired ${fixed} organisation(s).` : 'Dry run only. Add --apply to repair.');
await mongoose.disconnect();
