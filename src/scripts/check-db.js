import { connectDB, disconnectDB } from '../config/db.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';

const run = async () => {
  await connectDB();

  const subjects = await Subject.find();
  console.log(`Found ${subjects.length} subjects.`);

  for (const s of subjects) {
    const qCount = await Question.countDocuments({ subject: s._id });
    const activeQCount = await Question.countDocuments({ subject: s._id, isActive: true });
    console.log(`Subject: ${s.code} (${s.title}) - Total Questions: ${qCount}, Active: ${activeQCount}`);
  }

  const allQuestions = await Question.find().limit(5);
  console.log('Sample Questions:', JSON.stringify(allQuestions, null, 2));

  await disconnectDB();
  process.exit(0);
};

run();
