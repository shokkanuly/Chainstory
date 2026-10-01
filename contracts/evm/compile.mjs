// Compile the guardian with solc, resolving OpenZeppelin from node_modules.
//
//   node contracts/evm/compile.mjs     writes src/tripwire/guardian.artifact.ts
//
// The artifact is committed because the dashboard runs this exact bytecode in
// an in-browser EVM. The test suite recompiles in memory and fails if the
// committed artifact has drifted from the source, so the demo can never be
// running a different contract from the one that was tested.
import solc from 'solc';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
export const ARTIFACT_PATH = join(repo, 'src/tripwire/guardian.artifact.ts');

function findImport(path) {
  const hit = [join(here, 'src', path), join(repo, 'node_modules', path)].find(existsSync);
  return hit ? { contents: readFileSync(hit, 'utf8') } : { error: `not found: ${path}` };
}

export function compileGuardian() {
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
  const all = out.errors ?? [];
  const errors = all.filter((e) => e.severity === 'error');
  // Vendored OpenZeppelin warnings are not ours to fix and should not be read as ours.
  const ours = all.filter((e) => e.severity === 'warning' && !e.sourceLocation?.file?.startsWith('@openzeppelin/'));
  const vendored = all.filter((e) => e.severity === 'warning').length - ours.length;
  if (errors.length) return { errors, ours, vendored };
  const c = out.contracts['TripwireGuardian.sol'].TripwireGuardian;
  return {
    errors,
    ours,
    vendored,
    artifact: { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` },
    runtimeBytes: c.evm.deployedBytecode.object.length / 2,
  };
}

// --- the testnet stage: bridge ends, demo token, attacker contract ------------

export const DEMO_ARTIFACT_PATH = join(repo, 'scripts/tripwire/testnet/contracts.artifact.ts');
export const DEMO_CONTRACTS = {
  DemoUSDC: 'TripwireDemo.sol',
  MockSourceBridge: 'TripwireDemo.sol',
  ProtectedVault: 'TripwireDemo.sol',
  DrainReceiver: 'TripwireDemo.sol',
  TripwireQuorum: 'TripwireQuorum.sol',
  ERC1967Proxy: '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol',
};

/** The optimizer and EVM settings every contract here is compiled with. Etherscan verification must match them. */
export const SOLC_SETTINGS = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' };

/**
 * Solidity standard-JSON input for one entry file, with every import inlined
 * as a source: what Etherscan's verifier takes. Built by compiling once and
 * recording each file the import callback reads.
 */
export function standardJsonInput(entry) {
  const sources = { [entry]: { content: readFileSync(join(here, 'src', entry), 'utf8') } };
  const record = (path) => {
    const hit = findImport(path);
    if (hit.contents) sources[path] = { content: hit.contents };
    return hit;
  };
  solc.compile(
    JSON.stringify({ language: 'Solidity', sources, settings: { ...SOLC_SETTINGS, outputSelection: {} } }),
    { import: record }
  );
  return { language: 'Solidity', sources, settings: { ...SOLC_SETTINGS, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
}

/** The compiler version as Etherscan names it, e.g. v0.8.37+commit.f401782d. */
export function solcVersion() {
  return `v${solc.version().replace(/\.Emscripten.*$/, '')}`;
}

export function compileDemo() {
  const input = standardJsonInput('TripwireDemo.sol');
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) return { errors, artifacts: null };
  const artifacts = Object.fromEntries(
    Object.entries(DEMO_CONTRACTS).map(([name, file]) => {
      const c = out.contracts[file][name];
      return [name, { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }];
    })
  );
  return { errors, artifacts };
}

export const CCTP_ARTIFACT_PATH = join(repo, 'scripts/tripwire/testnet/cctpEscrow.artifact.ts');
export function compileCctpEscrow() {
  const input = standardJsonInput('CctpEscrow.sol');
  input.settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) return { errors, artifact: null };
  const c = out.contracts['CctpEscrow.sol'].CctpEscrow;
  return { errors, artifact: { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, runtimeBytes: c.evm.deployedBytecode.object.length / 2 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = compileGuardian();
  r.ours.forEach((w) => console.log('WARNING:', w.formattedMessage.trim()));
  r.errors.forEach((e) => console.error('ERROR:', e.formattedMessage.trim()));
  if (r.errors.length) process.exit(1);
  // A TS module rather than JSON: the app imports it with no bundler or
  // tsconfig changes, and the ABI stays a plain typed value.
  writeFileSync(
    ARTIFACT_PATH,
    '// Generated by contracts/evm/compile.mjs from contracts/evm/src/TripwireGuardian.sol.\n' +
      '// Do not edit. The test suite fails if this drifts from a fresh compile.\n' +
      "import type { GuardianArtifact } from './guardianVM';\n\n" +
      `const artifact: GuardianArtifact = ${JSON.stringify(r.artifact, null, 2)};\n\nexport default artifact;\n`
  );
  console.log(
    `compiled clean — solc ${solc.version().split('+')[0]}, ` +
      `${r.ours.length} warning(s) in our code, ${r.vendored} in vendored OpenZeppelin`
  );
  console.log(`runtime bytecode: ${r.runtimeBytes} bytes (EIP-170 limit 24576)`);
  console.log(`artifact: ${ARTIFACT_PATH.replace(repo + '/', '')}`);

  const demo = compileDemo();
  demo.errors.forEach((e) => console.error('ERROR:', e.formattedMessage.trim()));
  if (demo.errors.length) process.exit(1);
  writeFileSync(
    DEMO_ARTIFACT_PATH,
    '// Generated by contracts/evm/compile.mjs from contracts/evm/src/TripwireDemo.sol.\n' +
      '// Do not edit. The test suite fails if this drifts from a fresh compile.\n' +
      "import type { Abi, Hex } from 'viem';\n\n" +
      `const artifacts: Record<${Object.keys(DEMO_CONTRACTS).map((n) => `'${n}'`).join(' | ')}, { abi: Abi; bytecode: Hex }> = ` +
      `${JSON.stringify(demo.artifacts, null, 2)};\n\nexport default artifacts;\n`
  );
  console.log(`demo artifacts: ${DEMO_ARTIFACT_PATH.replace(repo + '/', '')}`);

  const cctp = compileCctpEscrow();
  cctp.errors.forEach((e) => console.error('ERROR:', e.formattedMessage.trim()));
  if (cctp.errors.length) process.exit(1);
  writeFileSync(CCTP_ARTIFACT_PATH,
    '// Generated by contracts/evm/compile.mjs from contracts/evm/src/CctpEscrow.sol.\n' +
    '// Do not edit. Test-only CctpHarness is never included.\n' +
    "import type { Abi, Hex } from 'viem';\n\n" +
    `const artifact: { abi: Abi; bytecode: Hex } = ${JSON.stringify(cctp.artifact, null, 2)};\n\nexport default artifact;\n`);
  console.log(`CCTP escrow runtime: ${cctp.runtimeBytes} bytes; artifact: ${CCTP_ARTIFACT_PATH.replace(repo + '/', '')}`);
}
