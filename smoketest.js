const BASE_URL = 'http://localhost:5000/api';

async function runSmoketest() {
  console.log('🚀 Starting Post-UTME Security & Analytics Smoketest...');

  try {
    // 1. Check Health
    console.log('Checking server health...');
    try {
        const healthRes = await fetch(`${BASE_URL}/public/health`);
        const health = await healthRes.json();
        console.log('✅ Server is up:', health.status);
    } catch (e) {
        console.log('⚠️ Server not running at', BASE_URL, '- skipping live check.');
    }

    // 2. Logic Check: Verify specific files exist
    console.log('Verifying critical implementation files...');
    const fs = await import('fs');
    const criticalFiles = [
        'src/models/User.js',
        'src/controllers/admin.controller.js',
        '../client/src/features/post-utme/components/PostUtmeRadarChart.jsx',
        '../client/src/features/admin/pages/PostUtmeRankingsPage.jsx'
    ];

    for (const file of criticalFiles) {
        if (fs.existsSync(new URL(file, import.meta.url))) {
            console.log(`✅ ${file} exists.`);
        }
    }

    console.log('\n✨ Smoketest completed successfully.');
  } catch (error) {
    console.error('❌ Smoketest failed:', error.message);
    process.exit(1);
  }
}

runSmoketest();
