// scripts/tripwire/testnet/deploy.ts — `npm run tripwire:deploy`
//
// Deploys the guardian, the demo bridge's two ends, a demo token and the
// attacker's receiving contract to Sepolia, and writes the addresses to
// deployment.sepolia.json. Needs separate role keys and an owner Safe
// (ADR-026); the relayer pays for the deployment.

import { encodeFunctionData } from 'viem';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { addressLink, connect, deploy, loadConfig, preflight } from './sepolia.js';

const log = (s: string) => console.log(s);
const cfg = loadConfig();
const c = await connect(cfg);
log('\nTripwire — deploy to Sepolia\n');
await preflight(cfg, c, log);
const d = await deploy(cfg, c, log);
log(`\nGuardian: ${addressLink(d.contracts.TripwireGuardian.address)} (policy v${d.policy?.guardian}, vault policy v${d.policy?.release})`);
log(`Saved ${cfg.deploymentFile}`);
log(`\nNext: the Safe ${d.owner} accepts guardian ownership. In the Safe app, a transaction to`);
log(`  ${d.contracts.TripwireGuardian.address}  data ${encodeFunctionData({ abi: guardianArtifact.abi, functionName: 'acceptOwnership' })}  (acceptOwnership())`);
log('Then: npm run tripwire:verify          (publishes the source on Etherscan)');
log('      npm run tripwire:demo:sepolia     (the first run needs no owner action)');
log('      npm run tripwire:operator:sepolia -- --watch\n');
