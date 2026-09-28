// scripts/tripwire/testnet/deploy.ts — `npm run tripwire:deploy`
//
// Deploys the guardian, the demo bridge's two ends, a demo token and the
// attacker's receiving contract to Sepolia, and writes the addresses to
// deployment.sepolia.json. Spends Sepolia ETH from the throwaway deployer.

import { addressLink, connect, deploy, loadConfig, preflight } from './sepolia.js';

const log = (s: string) => console.log(s);
const cfg = loadConfig();
const c = await connect(cfg);
log('\nTripwire — deploy to Sepolia\n');
await preflight(cfg, c, log);
const d = await deploy(cfg, c, log);
log(`\nGuardian: ${addressLink(d.contracts.TripwireGuardian.address)}`);
log(`Saved ${cfg.deploymentFile}`);
log('\nNext: npm run tripwire:verify   (publishes the source on Etherscan)');
log('Then: npm run tripwire:demo:sepolia\n');
