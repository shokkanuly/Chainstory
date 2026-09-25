// src/tripwire/guardianVM.ts
//
// The real TripwireGuardian bytecode, running in an in-process EVM.
//
// Used twice, deliberately: the test suite executes the contract through it,
// and the dashboard's incident replay runs it in the browser. The demo is
// therefore not an animation of what the contract would do — each outflow is
// a real call against the same bytecode the tests verified, and a blocked
// withdrawal is a real `RoutePaused` revert. It is a local chain, not mainnet,
// and the dashboard says so.
//
// Browser-safe: no Node imports. The artifact is passed in.

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

export interface GuardianArtifact {
  abi: Abi;
  bytecode: Hex;
}

/** block.chainid inside the local EVM (Mainnet rules, Cancun). */
export const LOCAL_CHAIN_ID = 1;

// Demo keys for a throwaway local chain. They hold nothing and sign nothing
// outside this in-process EVM. viem accounts do not expose their private key,
// and raw transactions need it, so each key is kept beside its account.
const KEYS = new Map<string, Hex>();
function demoAccount(byte: string): PrivateKeyAccount {
  const key = `0x${byte.repeat(32)}` as Hex;
  const account = privateKeyToAccount(key);
  KEYS.set(account.address, key);
  return account;
}

export const actors = {
  owner: demoAccount('11'),
  oracle: demoAccount('22'),
  /** The protected bridge contract's stand-in: the allow-listed outflow reporter. */
  bridge: demoAccount('33'),
  /** Anyone relaying a signed attestation. Submission is permissionless. */
  relayer: demoAccount('44'),
  attacker: demoAccount('55'),
} as const;

export interface CallResult {
  ok: boolean;
  /** Decoded custom error name, when the call reverted with one. */
  error?: string;
  errorArgs?: readonly unknown[];
  gas: bigint;
}

export class GuardianVM {
  /** Seconds since epoch, applied to every subsequent block. */
  now: bigint;
  address: Hex = '0x';
  private nonces = new Map<string, bigint>();
  private blockNumber = 1n;
  /**
   * Every VM operation runs through this. Even a read writes to the state
   * trie (runCall touches the caller's account), and ethereumjs's Merkle trie
   * corrupts itself under concurrent writes — two overlapping reads threw
   * "Stack underflow" from inside the trie. Serialising here means no caller,
   * including a React effect, can ever interleave them.
   */
  private lock: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private constructor(
    private vm: VM,
    private common: Common,
    readonly abi: Abi,
    start: bigint
  ) {
    this.now = start;
  }

  static async deploy(
    artifact: GuardianArtifact,
    { start = 1_780_000_000n, oracle = actors.oracle.address }: { start?: bigint; oracle?: Hex } = {}
  ): Promise<GuardianVM> {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    for (const a of Object.values(actors)) {
      await vm.stateManager.putAccount(new Address(hexToBytes(a.address)), new Account(0n, 10n ** 21n));
    }
    const g = new GuardianVM(vm, common, artifact.abi, start);
    const res = await g.raw(
      actors.owner,
      encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [actors.owner.address, oracle] }),
      undefined
    );
    // ethereumjs reports `createdAddress` even when the constructor reverts, so
    // the address alone cannot tell a deployment from an empty account.
    if (res.execResult.exceptionError || !res.createdAddress) {
      const reason = g.decode(res.execResult.returnValue)?.name ?? res.execResult.exceptionError?.error;
      throw new GuardianDeployError(reason ?? 'unknown');
    }
    g.address = res.createdAddress.toString() as Hex;
    return g;
  }

  private block() {
    return createBlock(
      { header: { timestamp: this.now, number: this.blockNumber++, gasLimit: 30_000_000n, baseFeePerGas: 7n } },
      { common: this.common }
    );
  }

  private raw(from: PrivateKeyAccount, data: Hex, to: Hex | undefined) {
    const nonce = this.nonces.get(from.address) ?? 0n;
    this.nonces.set(from.address, nonce + 1n);
    const key = KEYS.get(from.address);
    if (!key) throw new Error(`No key for ${from.address}; only demo actors can send`);
    const tx = createLegacyTx(
      { nonce, gasPrice: 10n, gasLimit: 8_000_000n, data, to: to ? hexToBytes(to) : undefined },
      { common: this.common }
    ).sign(hexToBytes(key));
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

  send(from: PrivateKeyAccount, functionName: string, args: readonly unknown[] = []): Promise<CallResult> {
    return this.exclusive(() => this.sendNow(from, functionName, args));
  }

  private async sendNow(from: PrivateKeyAccount, functionName: string, args: readonly unknown[]): Promise<CallResult> {
    const res = await this.raw(from, encodeFunctionData({ abi: this.abi, functionName, args }), this.address);
    const failed = res.execResult.exceptionError !== undefined;
    const decoded = failed ? this.decode(res.execResult.returnValue) : undefined;
    return { ok: !failed, error: decoded?.name, errorArgs: decoded?.args, gas: res.totalGasSpent };
  }

  read<T = unknown>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.exclusive(() => this.readNow<T>(functionName, args));
  }

  private async readNow<T>(functionName: string, args: readonly unknown[]): Promise<T> {
    const r = await this.vm.evm.runCall({
      to: new Address(hexToBytes(this.address)),
      caller: new Address(hexToBytes(actors.owner.address)),
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

export class GuardianDeployError extends Error {
  constructor(readonly reason: string) {
    super(`Guardian deployment reverted: ${reason}`);
  }
}
