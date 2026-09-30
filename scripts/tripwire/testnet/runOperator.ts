// `npm run tripwire:operator:sepolia -- [--watch]`
import { resolve } from 'node:path';
import { connect, loadConfig, readDeployment, ROOT } from './sepolia.js';
import { createRpcOperator } from './operator.js';

const cfg = loadConfig();
const clients = await connect(cfg);
const deployment = readDeployment(cfg);
const stateFile = process.env.TRIPWIRE_STATE_FILE ?? resolve(ROOT, '.tripwire', `sepolia-${deployment.contracts.ProtectedVault.address.toLowerCase()}.sqlite`);
// Source proof adapter + live baseline are deliberately not invented here.
// Unchecked releases stay gated; an existing ALLOW may be revoked to HOLD.
const operator = await createRpcOperator(cfg, clients, deployment, stateFile, { baseline: null });
console.log(`Tripwire operator · ${deployment.route} · durable state: ${stateFile}`);
console.log('No independent source adapter or baseline configured: unverified payouts remain held.');
let stop = false;
const abort = new AbortController();
const stopLoop = () => { stop = true; abort.abort(); };
process.once('SIGINT', stopLoop); process.once('SIGTERM', stopLoop);
try {
  do {
    console.log(JSON.stringify(await operator.tick()));
    if (!process.argv.includes('--watch') || stop) break;
    await new Promise<void>((done) => {
      const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); done(); };
      const timer = setTimeout(finish, 10_000);
      abort.signal.addEventListener('abort', finish, { once: true });
    });
  } while (!stop);
} finally { operator.close(); }
