import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';

const email = 'oluwadare458@gmail.com';

const run = async () => {
  await connectDB();
  const user = await User.findOneAndUpdate({ email }, { role: 'super_admin' }, { new: true });
  if (user) {
    console.log(`Successfully promoted ${email} to super_admin`);
  } else {
    console.log(`User ${email} not found`);
  }
  await disconnectDB();
  process.exit(0);
};

run();
