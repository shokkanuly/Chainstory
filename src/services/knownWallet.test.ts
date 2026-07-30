// src/services/knownWallet.test.ts
// Run via tsx / node to validate story narrative + FIFO CSV output for known wallet

import { runKnownWalletValidation } from './knownWalletValidation';

console.log('--- Running Known Wallet Validation Test ---');
const res = runKnownWalletValidation();

console.log(`Wallet Address: ${res.walletAddress}`);
console.log(`Validation Status: ${res.success ? 'PASSED ✅' : 'FAILED ❌'}`);
console.log('Summary:', JSON.stringify(res.summary, null, 2));

if (!res.success) {
  console.error('Validation Errors:', res.errors);
  throw new Error(`Known wallet validation failed with ${res.errors.length} error(s): ${res.errors.join('; ')}`);
} else {
  console.log('Known public wallet story narrative and CSV export verified successfully!');
}
