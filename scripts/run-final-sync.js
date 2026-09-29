const util = require('util');
const exec = util.promisify(require('child_process').exec);

async function waitAndActivate() {
  for (let i = 0; i < 15; i++) {
    console.log(`\n--- Harvest Pass ${i+1} ---`);
    try {
      const { stdout } = await exec('BRAND="Total Tiles" THEN_REWRITE=1 node scripts/shopify-harvest-brand-images.cjs');
      console.log(stdout);
      if (stdout.includes('still-processing 0') || !stdout.includes('still processing on Shopify')) {
        console.log('Harvest complete!');
        break;
      }
    } catch (e) {
      console.log('Harvest error:', e.stdout || e.message);
    }
    console.log(`Still processing. Waiting 60s...`);
    await new Promise(r => setTimeout(r, 60000));
  }
  
  console.log('\n--- Running Verification ---');
  try {
    const { stdout: verifyOut } = await exec('node scripts/verify-totaltiles-import.cjs');
    console.log(verifyOut);
    console.log('\n--- Verification Passed! Activating ---');
    const { stdout: activateOut } = await exec('BRAND="Total Tiles" node scripts/shopify-activate-brand.cjs');
    console.log(activateOut);
    console.log('\nALL DONE!');
  } catch (e) {
    console.error('\nFailed verification or activation:\n', e.stdout || e.message);
  }
}

waitAndActivate();
