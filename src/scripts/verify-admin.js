import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';

const email = 'oluwadare458@gmail.com';

const run = async () => {
  await connectDB();
  const user = await User.findOne({ email });
  if (user) {
    console.log(`User found: ${user.fullName} | Role: ${user.role}`);
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      console.log('Ensuring user is at least an admin...');
      user.role = 'admin';
      await user.save();
      console.log('Role updated to admin.');
    }
  } else {
    console.log(`User ${email} not found.`);
  }
  await disconnectDB();
  process.exit(0);
};

run();
