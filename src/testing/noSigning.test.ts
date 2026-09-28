// "Check before you sign" is advisory: no code path on it may sign or send
// (I1, and the Stage 5 "done when" in docs/plans/tripwire-hackathon.md).
//
// Rather than trust that, this walks every module the /check page can reach
// through its imports and fails if any of them contains a signing, sending or
// wallet-connection call. It is a source scan, so it also proves it can see:
// the same scan must flag the modules in the app that do sign or connect.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SRC = resolve(ROOT, 'src');
const ENTRY = resolve(SRC, 'pages/Check.tsx');

const FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
  ['a wallet RPC that sends or signs', /eth_send(Raw)?Transaction|eth_sign|personal_sign|eth_requestAccounts|wallet_\w+/],
  ['a signing or sending API', /\b(sendTransaction|sendRawTransaction|signTransaction|signMessage|signTypedData|writeContract)\b/],
  ['a key or wallet client', /\b(privateKeyToAccount|mnemonicToAccount|hdKeyToAccount|createWalletClient)\b/],
  ['an injected wallet', /window\.ethereum/],
  ['a wallet library', /from\s+['"](ethers|web3|wagmi|@wagmi\/[^'"]+|@walletconnect\/[^'"]+|@reown\/[^'"]+|viem\/accounts)['"]/],
];

/** Drop comments, keep string literals: a comment that mentions eth_sendTransaction does not send one. */
function code(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_m, literal: string | undefined) => literal ?? ''
  );
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // a package: covered by the wallet-library pattern
  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')];
  return candidates.find((c) => /\.tsx?$/.test(c) && existsSync(c)) ?? null;
}

function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of code(readFileSync(file, 'utf8')).matchAll(importRe)) {
      const next = resolveImport(file, m[1] ?? m[2] ?? '');
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

function violations(file: string): string[] {
  const src = code(readFileSync(file, 'utf8'));
  return FORBIDDEN.filter(([, re]) => re.test(src)).map(([label]) => `${relative(ROOT, file)}: ${label}`);
}

describe('/check cannot sign or send', () => {
  const files = reachable(ENTRY);

  it('walks the whole pipeline, not just the page', () => {
    const names = files.map((f) => relative(SRC, f));
    for (const expected of [
      'components/check/CheckBeforeSign.tsx',
      'services/preSignCheck.ts',
      'services/b2bSimulation.ts',
      'services/contractIntel.ts',
      'services/contractRiskExplainer.ts',
      'services/preventiveScamScanner.ts',
      'services/apiClient.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('no reachable module signs, sends or connects a wallet', () => {
    expect(files.flatMap(violations)).toEqual([]);
  });

  it('the scan does see signing where it exists', () => {
    // If these stop being flagged, the scan has gone blind, and the test above proves nothing.
    expect(violations(resolve(SRC, 'services/web3Wallet.ts')).length).toBeGreaterThan(0);
    expect(violations(resolve(SRC, 'tripwire/onChain.ts')).length).toBeGreaterThan(0);
  });
});
