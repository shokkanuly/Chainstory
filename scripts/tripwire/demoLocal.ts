// scripts/tripwire/demoLocal.ts — `npm run tripwire:demo:local`

import { ResponseTier } from '../../src/tripwire/onChain.js';
import { CAP, ROUTE_NAME, describeStep, runLocalLoop } from './localLoop.js';

console.log('\nTripwire — local loop: watch → score → attest → review → payout');
console.log('The real guardian and review-gated vault bytecode in an in-process EVM, with demo keys. No real chain is touched.');
console.log(`Route ${ROUTE_NAME}, cap ${(CAP / 10n ** 6n).toLocaleString('en-US')} USDC per hour.\n`);

let i = 0;
const steps = await runLocalLoop((step) => {
  console.log(describeStep(step, i++).join('\n') + '\n');
});
console.log(`Tiers: NONE → ${steps.map((s) => ResponseTier[s.tierAfter]).slice(1).join(' → ')}\n`);
