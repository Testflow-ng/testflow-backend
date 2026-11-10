import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

/**
 * CLI script to create an admin account.
 * Usage: node src/scripts/create-admin.js <fullName> <email> <password>
 */
const run = async () => {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: node src/scripts/create-admin.js <fullName> <email> <password>');
    process.exit(1);
  }

  const [fullName, email, password] = args;

  await connectDB();

  try {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      logger.warn(`A user with email ${email} already exists. Updating role to admin...`);
      existing.role = 'admin';
      existing.isEmailVerified = true; // Auto-verify admins
      await existing.save();
      logger.info(`User ${email} is now an admin.`);
    } else {
      await User.create({
        fullName,
        email: email.toLowerCase(),
        passwordHash: password,
        role: 'admin',
        isEmailVerified: true,
      });
      logger.info(`Admin account created successfully for ${email}`);
    }
  } catch (error) {
    logger.error('Failed to create admin account', error);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
};

run();
