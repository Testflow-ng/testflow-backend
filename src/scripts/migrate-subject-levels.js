import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Subject } from '../models/Subject.js';

async function migrate() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB');

    const subjects = await Subject.find({});
    let updatedCount = 0;

    for (const subject of subjects) {
      // Logic: Extract the first digit from the course code (e.g., MTH101 -> 1)
      const match = subject.code.match(/\d/);
      if (match) {
        const firstDigit = match[0];
        const level = `${firstDigit}00`;

        // Only update if it's a valid level (100-500)
        if (['100', '200', '300', '400', '500'].includes(level)) {
          subject.level = level;
          await subject.save();
          updatedCount++;
        }
      }
    }

    console.log(`Successfully migrated ${updatedCount} subjects.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
