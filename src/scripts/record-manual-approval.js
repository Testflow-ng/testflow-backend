import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { User } from '../models/User.js';
import { VerificationRequest } from '../models/VerificationRequest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const email = 'oluwadareanuoluwapo458@gmail.com';

async function recordApproval() {
  console.log(`🚀 Recording manual approval record for: ${email}...`);

  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.error(`❌ User not found with email: ${email}`);
      process.exit(1);
    }

    // Create the verification request record
    await VerificationRequest.create({
      student: user._id,
      status: 'approved',
      receiptImage: 'https://ik.imagekit.io/oluwadaredaniel/manual_approval_placeholder.png', // Generic placeholder
      receiptHash: `MANUAL-${user._id}-${Date.now()}`,
      transactionRef: 'MANUAL_GRANT',
      processedBy: user._id, // Self-approved or system approved
      processedAt: new Date()
    });

    console.log(`✨ Success! Manual approval record created for ${user.fullName}. It will now show in history.`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error recording approval:', error.message);
    process.exit(1);
  }
}

recordApproval();
