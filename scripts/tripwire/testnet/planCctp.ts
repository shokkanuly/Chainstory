import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cctpDeploymentPlan } from './cctpDeployPlan.js';

async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: npm run tripwire:cctp:plan -- config.json [new-plan.json]'); return; }
  if (!process.argv[2] || process.argv.length > 4) throw new Error('Invalid plan arguments.');
  const plan = cctpDeploymentPlan(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8')));
  const serialized = JSON.stringify(plan, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2);
  if (process.argv[3]) {
    const path = resolve(process.argv[3]);
    writeFileSync(path, `${serialized}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Unsigned CCTP pilot plan saved to ${path}. No transaction was sent.`);
  } else console.log(serialized);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('CCTP planning failed. Check public role addresses, nonce, limits and output path. Existing plans are never overwritten.'); process.exitCode = 1; });
}
