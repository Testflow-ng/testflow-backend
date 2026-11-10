import mongoose from 'mongoose';

export const WITHDRAWAL_STATUSES = Object.freeze(['pending', 'processing', 'success', 'failed']);

/**
 * One request to move an organisation's wallet balance to its bank account.
 *
 * `amountKobo` is what leaves the wallet, `feeKobo` is the transfer fee taken out of it, and
 * `netKobo` is what lands in the bank. Rows in `pending` or `processing` still count against the
 * balance; `failed` rows give the money back automatically because the balance is always computed.
 * The bank details are copied on, so a later change of payout account never rewrites history.
 */
const orgWithdrawalSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reference: { type: String, required: true, unique: true },
    currency: { type: String, default: 'NGN', uppercase: true },
    amountKobo: { type: Number, required: true, min: 1 },
    feeKobo: { type: Number, default: 0, min: 0 },
    netKobo: { type: Number, required: true, min: 1 },
    status: { type: String, enum: WITHDRAWAL_STATUSES, default: 'pending' },
    bankCode: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    transferCode: { type: String, trim: true, default: null },
    failureReason: { type: String, trim: true, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orgWithdrawalSchema.index({ organization: 1, createdAt: -1 });

orgWithdrawalSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const OrgWithdrawal = mongoose.model('OrgWithdrawal', orgWithdrawalSchema);
