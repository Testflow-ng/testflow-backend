import { connectDB, disconnectDB } from '../config/db.js';
import { User } from '../models/User.js';

// One-off cleanup for diagnostic accounts created while debugging the
// registration flow on 2026-07-30. Targets exact _ids so re-running is safe
// and can never touch a real account. Run against the production database:
//   MONGODB_URI="<prod uri>" node src/scripts/cleanup-test-accounts.js
const TEST_ACCOUNT_IDS = [
  '6a6b18019d2ffc7e52e64134', // "Test User" (probe_1785403387)
  '6a6b18539d2ffc7e52e641e1', // "T A" (freed milesmora28@gmail.com)
  '6a6b18649d2ffc7e52e64220', // "T B" (freed username "miles")
];

const run = async () => {
  await connectDB();
  const found = await User.find({ _id: { $in: TEST_ACCOUNT_IDS } }).select(
    'fullName email username',
  );
  found.forEach((u) => console.log(`Removing: ${u.fullName} <${u.email}> @${u.username}`));

  const result = await User.deleteMany({ _id: { $in: TEST_ACCOUNT_IDS } });
  console.log(`Deleted ${result.deletedCount} test account(s).`);

  await disconnectDB();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
