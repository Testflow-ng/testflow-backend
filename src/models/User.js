import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    username: { type: String, unique: true, sparse: true, trim: true, lowercase: true, minlength: 3, maxlength: 20 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Students only; sparse+unique so admins (no matric) don't collide on null.
    matricNumber: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['student', 'admin', 'super_admin'], default: 'student' },

    // Post-UTME specific fields
    isPostUtmePaid: { type: Boolean, default: false },
    verificationCode: { type: String, unique: true, sparse: true, uppercase: true },
    hasMigrated: { type: Boolean, default: false },
    utmeData: {
      jambScore: { type: Number, min: 0, max: 400, default: 0 },
      oLevelPoints: { type: Number, min: 0, max: 10, default: 0 },
      departmentChoice: { type: String, trim: true },
    },

    level: { type: String, enum: ['100', '200', '300', '400', '500'] },
    department: { type: String, trim: true },

    streakCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
    pinnedSubjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    showOnLeaderboard: { type: Boolean, default: true },

    isEmailVerified: { type: Boolean, default: false },

    // Hashed, single-use, expiring tokens (never store the plaintext token).
    emailVerifyTokenHash: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // Bumped on logout / password reset to invalidate all outstanding JWTs.
    tokenVersion: { type: Number, default: 0, select: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

// Supports admin roster queries (filter by role, then department/level).
userSchema.index({ role: 1, department: 1, level: 1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ role: 1, isPostUtmePaid: 1 });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('passwordHash')) {
    return;
  }
  this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_COST);
});

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// Strip sensitive fields from every serialized response; expose `id`, not `_id`.
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete ret._id;
    delete ret.passwordHash;
    delete ret.emailVerifyTokenHash;
    delete ret.emailVerifyExpires;
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetExpires;
    delete ret.tokenVersion;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
