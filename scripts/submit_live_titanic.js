const k = require('../dist-electron/tools/kaggle');
const path = require('path');

async function main() {
  const csvPath = path.join(__dirname, '..', 'data', 'titanic', 'submission_competitive.csv');
  console.log('Submitting competitive prediction to Titanic...');
  const sub = await k.submitPrediction(
    'titanic',
    csvPath,
    'Nova IDE Competitive Pipeline - WCG Group Survival LOO 0.852'
  );
  console.log('Submit response:', JSON.stringify(sub, null, 2));

  if (!sub.ok) {
    console.error('Submission failed:', sub.error);
    process.exit(1);
  }

  console.log('\nPolling for live submission score...');
  for (let attempt = 1; attempt <= 15; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    const list = await k.listSubmissions('titanic');
    if (list.ok && list.submissions && list.submissions.length) {
      const latest = list.submissions[0];
      console.log(`[Attempt ${attempt}] Status: ${latest.status}, Public Score: ${latest.publicScore}`);
      if (latest.status === 'complete' && latest.publicScore != null) {
        console.log('\n=======================================');
        console.log('SUCCESS! Real Leaderboard Score Readback:');
        console.log('Public Score:', latest.publicScore);
        console.log('Status:', latest.status);
        console.log('File:', latest.fileName);
        console.log('Description:', latest.description);
        console.log('=======================================\n');
        return;
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
