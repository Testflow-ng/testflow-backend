import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { User } from '../models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const email = process.argv[2] || 'oluwadareanuoluwapo458@gmail.com';

async function grantAccess() {
  console.log(`🚀 Granting Post-UTME access to: ${email}...`);

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to Database');

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.error(`❌ User not found with email: ${email}`);
      process.exit(1);
    }

    if (user.isPostUtmePaid) {
      console.log(`⚠️ User ${email} already has access.`);
    } else {
      user.isPostUtmePaid = true;
      await user.save();
      console.log(`✨ Success! Post-UTME access granted to ${user.fullName} (${email}).`);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error granting access:', error.message);
    process.exit(1);
  }
}

grantAccess();
