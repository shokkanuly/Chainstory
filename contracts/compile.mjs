// Compile the guardian and report errors. Foundry is the intended toolchain
// (see contracts/README.md); this exists so the contract is never committed
// without at least proving it builds, on a machine that has only Node.
import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = ['ITripwireGuardian.sol', 'TripwireGuardian.sol'];

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(
    sources.map((f) => [f, { content: readFileSync(join(here, 'src', f), 'utf8') }])
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
const warnings = (out.errors ?? []).filter((e) => e.severity === 'warning');

for (const w of warnings) console.log('WARNING:', w.formattedMessage.trim());
for (const e of errors) console.error('ERROR:', e.formattedMessage.trim());
if (errors.length) process.exit(1);

const artifact = out.contracts['TripwireGuardian.sol'].TripwireGuardian;
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(
  join(here, 'out', 'TripwireGuardian.json'),
  JSON.stringify({ abi: artifact.abi, bytecode: artifact.evm.bytecode.object }, null, 2)
);

const size = artifact.evm.bytecode.object.length / 2;
console.log(`compiled clean — ${warnings.length} warning(s)`);
console.log(`deployed bytecode: ${size} bytes (EIP-170 limit 24576)`);
console.log(`abi: ${artifact.abi.filter((x) => x.type === 'function').length} functions`);
