// scripts/tripwire/testnet/verify.ts — `npm run tripwire:verify`
//
// Publishes the source of the guardian, the vault, the bridge and the token on
// Etherscan, so a judge can read exactly what ran. The attacker's contract is
// deliberately left unverified: that is one of the facts the watcher scores.

import { solcVersion, standardJsonInput } from '../../../contracts/evm/compile.mjs';
import { EXPLORER, loadConfig, readDeployment, type Deployment } from './sepolia.js';

const API = 'https://api.etherscan.io/v2/api';
const cfg = loadConfig();
if (!cfg.etherscanKey) throw new Error('ETHERSCAN_API_KEY is missing from .env; verification needs it.');
const key = cfg.etherscanKey;
const d = readDeployment(cfg);

const TARGETS: Array<[keyof Deployment['contracts'], string, string]> = [
  ['TripwireGuardian', 'TripwireGuardian.sol', 'TripwireGuardian'],
  ['ProtectedVault', 'TripwireDemo.sol', 'ProtectedVault'],
  ['MockSourceBridge', 'TripwireDemo.sol', 'MockSourceBridge'],
  ['DemoUSDC', 'TripwireDemo.sol', 'DemoUSDC'],
];

async function call(params: Record<string, string>, post: boolean): Promise<{ status: string; result: string }> {
  const url = new URL(API);
  url.searchParams.set('chainid', String(d.chainId));
  if (!post) {
    for (const [k, v] of Object.entries({ ...params, apikey: key })) url.searchParams.set(k, v);
    return (await fetch(url)).json();
  }
  const body = new URLSearchParams({ ...params, apikey: key });
  return (await fetch(url, { method: 'POST', body })).json();
}

console.log(`\nVerifying on ${EXPLORER} with solc ${solcVersion()}\n`);
for (const [id, file, name] of TARGETS) {
  const c = d.contracts[id];
  const submit = await call(
    {
      module: 'contract',
      action: 'verifysourcecode',
      contractaddress: c.address,
      sourceCode: JSON.stringify(standardJsonInput(file)),
      codeformat: 'solidity-standard-json-input',
      contractname: `${file}:${name}`,
      compilerversion: solcVersion(),
      // Etherscan's own spelling.
      constructorArguements: c.constructorArgs.replace(/^0x/, ''),
    },
    true
  );
  if (submit.status !== '1') {
    const already = /already verified/i.test(submit.result);
    console.log(`  ${already ? '✓' : '✗'} ${name.padEnd(17)} ${already ? 'already verified' : submit.result}`);
    continue;
  }
  let verdict = 'Pending in queue';
  for (let i = 0; i < 20 && /pending|queue/i.test(verdict); i++) {
    await new Promise((r) => setTimeout(r, 5000));
    verdict = (await call({ module: 'contract', action: 'checkverifystatus', guid: submit.result }, false)).result;
  }
  const ok = /pass|verified/i.test(verdict);
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(17)} ${verdict}  ${EXPLORER}/address/${c.address}#code`);
}
console.log();
