import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api';

async function runSmoketest() {
  console.log('🚀 Starting Post-UTME Security & Analytics Smoketest...');

  try {
    // 1. Check Health
    console.log('Checking server health...');
    const health = await axios.get(`${BASE_URL}/public/health`);
    console.log('✅ Server is up:', health.data.status);

    // 2. Verify Rankings Endpoint (Expect 401 if not logged in)
    console.log('Checking Admin Rankings endpoint access...');
    try {
      await axios.get(`${BASE_URL}/admin/post-utme/rankings`);
    } catch (err) {
      if (err.response?.status === 401) {
        console.log('✅ Rankings endpoint is protected (401 Unauthorized as expected).');
      } else {
        throw err;
      }
    }

    console.log('\n✨ Smoketest completed successfully (Connectivity verified).');
  } catch (error) {
    console.error('❌ Smoketest failed:', error.message);
    process.exit(1);
  }
}

runSmoketest();
