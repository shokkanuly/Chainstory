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

/** Another contract deployed into the same local chain (for integration tests and demos). */
export interface VMContract {
  address: Hex;
  abi: Abi;
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

  /**
   * `oracle` may be an address, or a function that deploys the oracle contract
   * (a TripwireQuorum) into this chain first and returns its address — the
   * guardian then starts with it, as a real deployment does, instead of
   * rotating to it through the 2-day `proposeOracle` / `acceptOracle` notice.
   */
  static async deploy(
    artifact: GuardianArtifact,
    { start = 1_780_000_000n, oracle = actors.oracle.address }: {
      start?: bigint;
      oracle?: Hex | ((chain: GuardianVM) => Promise<Hex>);
    } = {}
  ): Promise<GuardianVM> {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    for (const a of Object.values(actors)) {
      await vm.stateManager.putAccount(new Address(hexToBytes(a.address)), new Account(0n, 10n ** 21n));
    }
    const g = new GuardianVM(vm, common, artifact.abi, start);
    const oracleAddress = typeof oracle === 'function' ? await oracle(g) : oracle;
    const res = await g.raw(
      actors.owner,
      encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [actors.owner.address, oracleAddress] }),
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

  /** Read deployed bytes for artifact acceptance fixtures; no transaction/signing. */
  readBytecode(address: Hex = this.address): Promise<Hex> {
    return this.exclusive(async () => bytesToHex(await this.vm.stateManager.getCode(new Address(hexToBytes(address)))) as Hex);
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

  private decode(bytes: Uint8Array, abi: Abi = this.abi) {
    if (bytes.length < 4) return undefined;
    try {
      const d = decodeErrorResult({ abi, data: bytesToHex(bytes) as Hex });
      return { name: d.errorName, args: d.args };
    } catch {
      return { name: `unknown(${bytesToHex(bytes.slice(0, 4))})`, args: [] as readonly unknown[] };
    }
  }

  send(from: PrivateKeyAccount, functionName: string, args: readonly unknown[] = []): Promise<CallResult> {
    return this.sendContract({ address: this.address, abi: this.abi }, from, functionName, args);
  }

  deployContract(artifact: GuardianArtifact, args: readonly unknown[], from = actors.owner): Promise<VMContract> {
    return this.exclusive(async () => {
      const res = await this.raw(from, encodeDeployData({ ...artifact, args }), undefined);
      if (res.execResult.exceptionError || !res.createdAddress) {
        throw new Error(`Contract deployment reverted: ${this.decode(res.execResult.returnValue, artifact.abi)?.name ?? 'unknown'}`);
      }
      return { address: res.createdAddress.toString() as Hex, abi: artifact.abi };
    });
  }

  sendContract(contract: VMContract, from: PrivateKeyAccount, functionName: string, args: readonly unknown[] = []): Promise<CallResult> {
    return this.exclusive(() => this.sendNow(contract, from, functionName, args));
  }

  private async sendNow(contract: VMContract, from: PrivateKeyAccount, functionName: string, args: readonly unknown[]): Promise<CallResult> {
    const res = await this.raw(from, encodeFunctionData({ abi: contract.abi, functionName, args }), contract.address);
    const failed = res.execResult.exceptionError !== undefined;
    const decoded = failed ? this.decode(res.execResult.returnValue, [...contract.abi, ...this.abi]) : undefined;
    return { ok: !failed, error: decoded?.name, errorArgs: decoded?.args, gas: res.totalGasSpent };
  }

  /** eth_call-style dry run from `from`: whether the call would succeed, keeping none of its effects. */
  simulateContract(contract: VMContract, from: PrivateKeyAccount, functionName: string, args: readonly unknown[] = []): Promise<CallResult> {
    return this.exclusive(async () => {
      await this.vm.stateManager.checkpoint();
      try {
        const r = await this.vm.evm.runCall({
          to: new Address(hexToBytes(contract.address)),
          caller: new Address(hexToBytes(from.address)),
          data: hexToBytes(encodeFunctionData({ abi: contract.abi, functionName, args })),
          block: this.block(),
        });
        const failed = r.execResult.exceptionError !== undefined;
        const decoded = failed ? this.decode(r.execResult.returnValue, [...contract.abi, ...this.abi]) : undefined;
        return { ok: !failed, error: decoded?.name, errorArgs: decoded?.args, gas: r.execResult.executionGasUsed };
      } finally {
        await this.vm.stateManager.revert();
      }
    });
  }

  read<T = unknown>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.readContract<T>({ address: this.address, abi: this.abi }, functionName, args);
  }

  readContract<T = unknown>(contract: VMContract, functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.exclusive(() => this.readNow<T>(contract, functionName, args));
  }

  private async readNow<T>(contract: VMContract, functionName: string, args: readonly unknown[]): Promise<T> {
    // runCall changes the caller's nonce even for a view. A simulated read must
    // not leave those changes behind before the next signed transaction.
    await this.vm.stateManager.checkpoint();
    try {
      const r = await this.vm.evm.runCall({
        to: new Address(hexToBytes(contract.address)),
        caller: new Address(hexToBytes(actors.owner.address)),
        data: hexToBytes(encodeFunctionData({ abi: contract.abi, functionName, args })),
        block: this.block(),
      });
      return decodeFunctionResult({
        abi: contract.abi, functionName, data: bytesToHex(r.execResult.returnValue) as Hex,
      }) as T;
    } finally {
      await this.vm.stateManager.revert();
    }
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
