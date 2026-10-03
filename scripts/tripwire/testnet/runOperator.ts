// `npm run tripwire:operator:sepolia -- [--watch]`
import { resolve } from 'node:path';
import { z } from 'zod';
import { connect, loadConfig, readDeployment, ROOT } from './sepolia.js';
import { attestationStateFile, createRpcOperator } from './operator.js';

const cfg = loadConfig();
const clients = await connect(cfg);
const deployment = readDeployment(cfg);
const stateFile = process.env.TRIPWIRE_STATE_FILE ?? resolve(ROOT, '.tripwire', `sepolia-${deployment.contracts.ProtectedVault.address.toLowerCase()}.sqlite`);
const baselineHours = z.coerce.number().int().min(1).max(168).parse(process.env.TRIPWIRE_BASELINE_HOURS ?? 24);
// The baseline is computed from finalized source burns (HIGH-2). No source-proof
// adapter is invented for the mock bridge: its burns are not proofs, so payouts stay held.
const operator = await createRpcOperator(cfg, clients, deployment, stateFile, { baseline: 'rolling', baselineHours });
console.log(`Tripwire operator · ${deployment.route}`);
console.log(`  journals   ${stateFile} (reviews, payouts) · ${attestationStateFile(stateFile)} (attestations)`);
console.log(`  oracle     ${cfg.oracle.address} (signs only)`);
console.log(`  relayers   ${cfg.relayer.address} (reviews, payouts) · ${cfg.attestationRelayer.address} (attestations)`);
console.log(`  baseline   rolling ${baselineHours} h of finalized source burns; held until it has enough samples`);
console.log('No independent source adapter for the mock bridge: unverified payouts remain held.');

/** Consecutive failed ticks back off from 10 s to 5 minutes; one good tick resets it. */
const POLL_MS = 10_000, MAX_BACKOFF_MS = 300_000;
let stop = false;
let failures = 0;
const abort = new AbortController();
const stopLoop = () => { stop = true; abort.abort(); };
process.once('SIGINT', stopLoop); process.once('SIGTERM', stopLoop);
try {
  do {
    try {
      const results = await operator.tick();
      failures = 0;
      console.log(JSON.stringify({ at: new Date().toISOString(), results, quarantine: operator.watcher.quarantineReason }));
    } catch (error) {
      if (!process.argv.includes('--watch') || operator.watcher.quarantineReason) throw error;
      failures++;
      console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), failures }));
    }
    if (operator.watcher.quarantineReason) throw new Error('Finality quarantine persisted. Stop and reconcile the route; restarting cannot clear it.');
    if (!process.argv.includes('--watch') || stop) break;
    const delay = failures ? Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures) : POLL_MS;
    await new Promise<void>((done) => {
      const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); done(); };
      const timer = setTimeout(finish, delay);
      abort.signal.addEventListener('abort', finish, { once: true });
    });
  } while (!stop);
} finally { operator.close(); }
