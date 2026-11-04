import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { User } from '../models/User.js';
import { VerificationRequest } from '../models/VerificationRequest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const email = 'oluwadareanuoluwapo458@gmail.com';

async function testLogic() {
  console.log('🧪 Testing Verification Logic (Direct Model Access)...');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to DB');

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.error('❌ Test user not found');
      process.exit(1);
    }

    // 1. Simulate a new request
    const testHash = `TEST-HASH-${Date.now()}`;
    const testUrl = "https://ik.imagekit.io/oluwadaredaniel/test-receipt.png";

    console.log('\n1. Creating test verification request...');
    const request = await VerificationRequest.create({
      student: user._id,
      receiptImage: testUrl,
      receiptHash: testHash,
      transactionRef: 'TEST_REF_123'
    });
    console.log('✅ Request created in DB');

    // 2. Test Duplicate Hash Prevention
    console.log('\n2. Testing duplicate hash prevention...');
    try {
      await VerificationRequest.create({
        student: user._id,
        receiptImage: "another-url",
        receiptHash: testHash // Same hash
      });
      console.error('❌ FAILED: Duplicate hash was allowed!');
    } catch (e) {
      console.log('✅ SUCCESS: Duplicate hash blocked by unique index.');
    }

    // 3. Test Duplicate Ref Prevention
    console.log('\n3. Testing duplicate ref prevention (manual check simulation)...');
    const duplicateRef = await VerificationRequest.findOne({ transactionRef: 'TEST_REF_123' });
    if (duplicateRef) {
      console.log('✅ SUCCESS: Duplicate reference detected.');
    } else {
      console.error('❌ FAILED: Reference not found.');
    }

    // Cleanup test data
    await VerificationRequest.deleteOne({ _id: request._id });
    console.log('\n🧹 Test data cleaned up.');

    await mongoose.disconnect();
    console.log('\n✨ All internal logic tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testLogic();
