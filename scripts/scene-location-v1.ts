import { LOCATION_VERSION, runLocation } from '../workbench/src/location/location';

const [command, path, ...extra] = Bun.argv.slice(2);
if (command === '--help' && !path) {
  console.log('bun scripts/scene-location-v1.ts <preflight|export> request.json');
} else {
  try {
    if ((command !== 'preflight' && command !== 'export') || !path || extra.length) {
      throw Error('Usage: bun scripts/scene-location-v1.ts <preflight|export> request.json');
    }
    const receipt = await runLocation(command, path);
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    console.log(JSON.stringify({version: LOCATION_VERSION, ready: false, error: error instanceof Error ? error.message : String(error)}, null, 2));
    process.exitCode = 1;
  }
}
