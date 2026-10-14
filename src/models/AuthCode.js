import mongoose from 'mongoose';

/** One-time authorization code for the code + PKCE exchange (other-domain clients). Stored hashed; expires in 2 minutes. */
const authCodeSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    redirectUri: { type: String, required: true },
    codeChallenge: { type: String, required: true },
    product: { type: String },
    usedAt: { type: Date, default: null },
    expireAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AuthCode = mongoose.model('AuthCode', authCodeSchema);
