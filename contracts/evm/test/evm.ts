// A minimal in-process EVM harness for the guardian.
//
// Foundry is the intended test runner (test/TripwireGuardian.t.sol). This
// exists because a contract that pauses bridges must not be committed on the
// strength of compiling, and this machine has no Foundry. It deploys the exact
// bytecode compile.mjs just produced, so a stale artifact cannot pass.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVM, runTx, type VM } from '@ethereumjs/vm';
import { createLegacyTx } from '@ethereumjs/tx';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createBlock } from '@ethereumjs/block';
import { Account, Address, bytesToHex, hexToBytes } from '@ethereumjs/util';
import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

const here = dirname(fileURLToPath(import.meta.url));

/** Compile once per process, then load the artifact that compile produced. */
let artifact: { abi: Abi; bytecode: Hex } | null = null;
export function loadArtifact() {
  if (!artifact) {
    execFileSync('node', [join(here, '..', 'compile.mjs')], { stdio: 'pipe' });
    artifact = JSON.parse(readFileSync(join(here, '..', 'out/TripwireGuardian.json'), 'utf8'));
  }
  return artifact!;
}

export const CHAIN_ID = 1; // Mainnet common; block.chainid inside the EVM.
export const T0 = 1_780_000_000n;

// viem accounts do not expose their private key, and the EVM needs it to sign
// raw transactions, so keep the key beside each account.
const KEYS = new Map<string, Hex>();
function account(byte: string) {
  const pk = `0x${byte.repeat(32)}` as Hex;
  const a = privateKeyToAccount(pk);
  KEYS.set(a.address, pk);
  return a;
}
export const owner = account('11');
export const oracle = account('22');
export const bridge = account('33');
export const stranger = account('44');
export const attacker = account('55');
const ACCOUNTS = [owner, oracle, bridge, stranger, attacker];

export interface TxResult {
  ok: boolean;
  /** Custom error name, when the call reverted with one. */
  error?: string;
  errorArgs?: readonly unknown[];
  gas: bigint;
}

export class Guardian {
  now = T0;
  private nonces = new Map<string, bigint>();
  private blockNumber = 1n;

  private constructor(
    private vm: VM,
    private common: Common,
    public address: Hex,
    public abi: Abi
  ) {}

  static async deploy(oracleAddress: Hex = oracle.address): Promise<Guardian> {
    const { abi, bytecode } = loadArtifact();
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    for (const a of ACCOUNTS) {
      await vm.stateManager.putAccount(new Address(hexToBytes(a.address)), new Account(0n, 10n ** 21n));
    }
    const g = new Guardian(vm, common, '0x', abi);
    const data = encodeDeployData({ abi, bytecode, args: [owner.address, oracleAddress] });
    const res = await g.raw(owner, data, undefined);
    if (!res.createdAddress) throw new Error(`deploy failed: ${res.execResult.exceptionError?.error}`);
    g.address = res.createdAddress.toString() as Hex;
    return g;
  }

  /** Deploy expecting a constructor revert; returns the decoded error. */
  static async deployExpectingRevert(oracleAddress: Hex): Promise<string | undefined> {
    const { abi, bytecode } = loadArtifact();
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    await vm.stateManager.putAccount(new Address(hexToBytes(owner.address)), new Account(0n, 10n ** 21n));
    const g = new Guardian(vm, common, '0x', abi);
    const res = await g.raw(owner, encodeDeployData({ abi, bytecode, args: [owner.address, oracleAddress] }), undefined);
    return g.decode(res.execResult.returnValue)?.name;
  }

  private block() {
    return createBlock(
      { header: { timestamp: this.now, number: this.blockNumber++, gasLimit: 30_000_000n, baseFeePerGas: 7n } },
      { common: this.common }
    );
  }

  private async raw(from: PrivateKeyAccount, data: Hex, to: Hex | undefined) {
    const nonce = this.nonces.get(from.address) ?? 0n;
    this.nonces.set(from.address, nonce + 1n);
    const tx = createLegacyTx(
      { nonce, gasPrice: 10n, gasLimit: 8_000_000n, data, to: to ? hexToBytes(to) : undefined },
      { common: this.common }
    ).sign(hexToBytes(KEYS.get(from.address)!));
    return runTx(this.vm, { tx, block: this.block(), skipBalance: true });
  }

  private decode(bytes: Uint8Array) {
    if (bytes.length < 4) return undefined;
    try {
      const d = decodeErrorResult({ abi: this.abi, data: bytesToHex(bytes) as Hex });
      return { name: d.errorName, args: d.args };
    } catch {
      return { name: `unknown(${bytesToHex(bytes.slice(0, 4))})`, args: [] as readonly unknown[] };
    }
  }

  async send(from: PrivateKeyAccount, functionName: string, args: readonly unknown[] = []): Promise<TxResult> {
    const data = encodeFunctionData({ abi: this.abi, functionName, args });
    const res = await this.raw(from, data, this.address);
    const failed = res.execResult.exceptionError !== undefined;
    const decoded = failed ? this.decode(res.execResult.returnValue) : undefined;
    return { ok: !failed, error: decoded?.name, errorArgs: decoded?.args, gas: res.totalGasSpent };
  }

  async read<T = unknown>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    const r = await this.vm.evm.runCall({
      to: new Address(hexToBytes(this.address)),
      caller: new Address(hexToBytes(owner.address)),
      data: hexToBytes(encodeFunctionData({ abi: this.abi, functionName, args })),
      block: this.block(),
    });
    return decodeFunctionResult({
      abi: this.abi,
      functionName,
      data: bytesToHex(r.execResult.returnValue) as Hex,
    }) as T;
  }

  warp(seconds: number | bigint) {
    this.now += BigInt(seconds);
  }
}

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'routeId', type: 'bytes32' },
    { name: 'riskScore', type: 'uint256' },
    { name: 'validUntil', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface Attestation {
  routeId: Hex;
  riskScore: bigint;
  validUntil: bigint;
  nonce: bigint;
}

/** Sign exactly as the production oracle will — viem EIP-712 typed data. */
export function signAttestation(
  signer: PrivateKeyAccount,
  verifyingContract: Hex,
  a: Attestation,
  chainId = CHAIN_ID
): Promise<Hex> {
  return signer.signTypedData({
    domain: { name: 'TripwireGuardian', version: '1', chainId, verifyingContract },
    types: ATTESTATION_TYPES,
    primaryType: 'Attestation',
    message: a,
  });
}
