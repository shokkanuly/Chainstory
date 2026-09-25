// Compile the guardian with solc, resolving OpenZeppelin from node_modules.
//
// Foundry is the intended toolchain — see README.md — but this machine has
// none, and a contract that pauses bridges does not get committed on the
// strength of "it probably builds". Emits the artifact the EVM test harness
// deploys, so the harness always runs the bytecode that was just compiled.
import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

function findImport(path) {
  const candidates = [join(here, 'src', path), join(repo, 'node_modules', path)];
  const hit = candidates.find(existsSync);
  return hit ? { contents: readFileSync(hit, 'utf8') } : { error: `not found: ${path}` };
}

const input = {
  language: 'Solidity',
  sources: {
    'TripwireGuardian.sol': { content: readFileSync(join(here, 'src/TripwireGuardian.sol'), 'utf8') },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
const warnings = (out.errors ?? []).filter((e) => e.severity === 'warning');
// Separate our code from vendored OpenZeppelin, whose warnings we cannot fix
// and should not be read as ours.
const isVendored = (e) => e.sourceLocation?.file?.startsWith('@openzeppelin/');
const ours = warnings.filter((w) => !isVendored(w));
for (const w of ours) console.log('WARNING:', w.formattedMessage.trim());
for (const e of errors) console.error('ERROR:', e.formattedMessage.trim());
if (errors.length) process.exit(1);

const c = out.contracts['TripwireGuardian.sol'].TripwireGuardian;
mkdirSync(join(here, 'out'), { recursive: true });
writeFileSync(
  join(here, 'out/TripwireGuardian.json'),
  JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2)
);

const runtime = c.evm.deployedBytecode.object.length / 2;
console.log(
  `compiled clean — solc ${solc.version().split('+')[0]}, ` +
    `${ours.length} warning(s) in our code, ${warnings.length - ours.length} in vendored OpenZeppelin`
);
console.log(`runtime bytecode: ${runtime} bytes (EIP-170 limit 24576)`);
