import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';

const founderDetails = {
  fullName: 'Founder',
  email: 'owaedison18@gmail.com',
  passwordHash: 'Eddyrus1234', // The model pre-save hook will hash this
  role: 'super_admin',
  isEmailVerified: true
};

const run = async () => {
  try {
    await connectDB();

    // Check if user already exists
    let user = await User.findOne({ email: founderDetails.email });

    if (user) {
      console.log(`User ${founderDetails.email} already exists. Promoting to super_admin...`);
      user.role = 'super_admin';
      user.isEmailVerified = true;
      await user.save();
      console.log('Update successful.');
    } else {
      console.log(`Creating new Super Admin: ${founderDetails.email}...`);
      await User.create(founderDetails);
      console.log('Creation successful.');
    }

  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
};

run();
