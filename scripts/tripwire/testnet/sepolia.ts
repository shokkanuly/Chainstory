// scripts/tripwire/testnet/sepolia.ts
//
// Tripwire on a public testnet (Sepolia): deploy, verify, and run the same
// watch → attest → guardian loop as the local demo, with transactions a judge
// can open on the explorer. Operator-side code (ADR-012): it holds the
// throwaway deployer key, which never leaves .env.tripwire and is never
// printed. Both ends of the demo bridge live on Sepolia, so one faucet funds it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  toHex,
  type Abi,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';
import type { ContractRiskSummary, RouteBaseline } from '../../../src/tripwire/types.js';
import { FLAG_LIST_NAME, lookupFlaggedAddress } from '../../../src/services/preventiveScamScanner.js';
import { ATTACK_STEPS, DRAIN_CONTRACT, USDC } from '../attack.js';
import { Attestor, type AttestationOutcome, type GuardianPort } from '../attest.js';
import type { BurnEvent, LogFeed, ReleaseEvent } from '../events.js';
import { Watcher } from '../watch.js';
import demo from './contracts.artifact.js';

export const ROOT = resolve(import.meta.dirname, '../../..');
export const EXPLORER = 'https://sepolia.etherscan.io';
/** The throwaway deployer the faucets funded. The loaded key must derive to it. */
export const EXPECTED_DEPLOYER = '0xbe04Fd4De57E930901f97F568BD2a12c3145a36F';
export const ROUTE_NAME = 'sepolia:demo-bridge:tdUSDC';
export const ROUTE_ID = keccak256(toHex(ROUTE_NAME));
export const CAP = 2_000_000n * USDC;
export const WINDOW_SECONDS = 3600n;
const VAULT_FUNDING = 20_000_000n * USDC;

// --- configuration --------------------------------------------------------------

/** Parse a dotenv file without loading it into process.env. */
function readDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

export interface TestnetConfig {
  account: PrivateKeyAccount;
  rpcUrl: string;
  /** Explorer and verification key, from .env; null when absent. */
  etherscanKey: string | null;
  deploymentFile: string;
}

/**
 * The deployer key is whatever private-key-shaped value .env.tripwire holds,
 * whatever its variable name. It is used, never printed: only the address it
 * derives is shown.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): TestnetConfig {
  const keyFile = env.TRIPWIRE_ENV_FILE ?? resolve(ROOT, '.env.tripwire');
  const tripwire = readDotenv(keyFile);
  const keys = Object.values(tripwire).filter((v) => /^(0x)?[0-9a-fA-F]{64}$/.test(v));
  if (keys.length !== 1) {
    throw new Error(
      keys.length === 0
        ? `No private key found in ${keyFile}. It should hold one line like DEPLOYER_PRIVATE_KEY=0x… (64 hex digits).`
        : `${keyFile} holds ${keys.length} private keys; keep only the deployer's.`
    );
  }
  const raw = keys[0];
  const account = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex);
  const dotenv = readDotenv(resolve(ROOT, '.env'));
  const etherscanKey = env.ETHERSCAN_API_KEY ?? tripwire.ETHERSCAN_API_KEY ?? dotenv.ETHERSCAN_API_KEY ?? null;
  return {
    account,
    rpcUrl: env.SEPOLIA_RPC_URL ?? tripwire.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    etherscanKey: etherscanKey && !etherscanKey.includes('your_') ? etherscanKey : null,
    deploymentFile: env.TRIPWIRE_DEPLOYMENT_FILE ?? resolve(import.meta.dirname, 'deployment.sepolia.json'),
  };
}

export interface Clients {
  pub: PublicClient<Transport, Chain>;
  wallet: WalletClient<Transport, Chain, Account>;
  chainId: number;
}

export async function connect(cfg: TestnetConfig, chain: Chain = sepolia): Promise<Clients> {
  const transport = http(cfg.rpcUrl, { retryCount: 3, timeout: 30_000 });
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account: cfg.account });
  const chainId = await pub.getChainId();
  if (chainId !== chain.id) throw new Error(`RPC ${cfg.rpcUrl} is chain ${chainId}, expected ${chain.id}.`);
  return { pub, wallet, chainId };
}

export const txLink = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export const addressLink = (a: Hex) => `${EXPLORER}/address/${a}`;

// --- deployment -----------------------------------------------------------------

export interface Deployed {
  address: Hex;
  tx: Hex;
  /** ABI-encoded constructor arguments, for source verification. */
  constructorArgs: Hex;
}

export interface Deployment {
  chainId: number;
  deployer: Hex;
  oracle: Hex;
  route: string;
  routeId: Hex;
  cap: string;
  startBlock: string;
  contracts: Record<'DemoUSDC' | 'MockSourceBridge' | 'TripwireGuardian' | 'ProtectedVault' | 'DrainReceiver' | 'DrainProxy', Deployed>;
}

/** Rough gas for the whole deploy plus one demo run, for the pre-flight balance check. */
const GAS_BUDGET = 6_500_000n;

export async function preflight(cfg: TestnetConfig, c: Clients, log: (s: string) => void) {
  const balance = await c.pub.getBalance({ address: cfg.account.address });
  const gasPrice = await c.pub.getGasPrice();
  const need = GAS_BUDGET * gasPrice;
  log(`Deployer  ${cfg.account.address}`);
  log(`Balance   ${formatEther(balance)} ETH · gas price ${Number(gasPrice) / 1e9} gwei · deploy + demo ≈ ${formatEther(need)} ETH`);
  if (cfg.account.address.toLowerCase() !== EXPECTED_DEPLOYER.toLowerCase()) {
    log(`Note: this key is not the funded deployer ${EXPECTED_DEPLOYER}.`);
  }
  if (balance < need) {
    throw new Error(`Not enough Sepolia ETH: have ${formatEther(balance)}, need about ${formatEther(need)}. Top up from a faucet and rerun.`);
  }
}

async function send(c: Clients, tx: Promise<Hex>): Promise<{ hash: Hex; ok: boolean; gas: bigint; block: bigint }> {
  const hash = await tx;
  const r = await c.pub.waitForTransactionReceipt({ hash });
  return { hash, ok: r.status === 'success', gas: r.gasUsed, block: r.blockNumber };
}

async function deployOne(c: Clients, abi: Abi, bytecode: Hex, args: readonly unknown[], log: (s: string) => void, name: string): Promise<Deployed> {
  const hash = await c.wallet.deployContract({ abi, bytecode, args });
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`${name} deployment failed: ${txLink(hash)}`);
  // The creation input is bytecode ‖ constructor args; the explorer's verifier wants the args alone.
  const input = (await c.pub.getTransaction({ hash })).input;
  const constructorArgs = `0x${input.slice(bytecode.length)}` as Hex;
  log(`  ✓ ${name.padEnd(17)} ${r.contractAddress}  ${txLink(hash)}`);
  return { address: r.contractAddress, tx: hash, constructorArgs };
}

export async function deploy(cfg: TestnetConfig, c: Clients, log: (s: string) => void): Promise<Deployment> {
  const me = cfg.account.address;
  const startBlock = await c.pub.getBlockNumber();
  log('Deploying:');
  const token = await deployOne(c, demo.DemoUSDC.abi, demo.DemoUSDC.bytecode, [me], log, 'DemoUSDC');
  const bridge = await deployOne(c, demo.MockSourceBridge.abi, demo.MockSourceBridge.bytecode, [], log, 'MockSourceBridge');
  // The deployer is also the oracle: one throwaway key for the demo. The
  // guardian lets the owner rotate it (setOracle) to a separate signer.
  const guardian = await deployOne(c, guardianArtifact.abi, guardianArtifact.bytecode, [me, me], log, 'TripwireGuardian');
  const vault = await deployOne(
    c,
    demo.ProtectedVault.abi,
    demo.ProtectedVault.bytecode,
    [me, token.address, guardian.address, ROUTE_ID],
    log,
    'ProtectedVault'
  );
  const drainImpl = await deployOne(c, demo.DrainReceiver.abi, demo.DrainReceiver.bytecode, [], log, 'DrainReceiver');
  const init = encodeFunctionData({ abi: demo.DrainReceiver.abi, functionName: 'initialize' });
  const drainProxy = await deployOne(c, demo.ERC1967Proxy.abi, demo.ERC1967Proxy.bytecode, [drainImpl.address, init], log, 'DrainProxy');

  log('Configuring:');
  const run = async (label: string, tx: () => Promise<Hex>) => {
    const r = await send(c, tx());
    if (!r.ok) throw new Error(`${label} failed: ${txLink(r.hash)}`);
    log(`  ✓ ${label.padEnd(40)} ${txLink(r.hash)}`);
  };
  await run(`guardian.configureRoute (cap ${CAP / USDC} per hour)`, () =>
    c.wallet.writeContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'configureRoute', args: [ROUTE_ID, CAP, WINDOW_SECONDS] })
  );
  await run('guardian.setProtected(vault)', () =>
    c.wallet.writeContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'setProtected', args: [vault.address, true] })
  );
  await run(`token.mint(vault, ${VAULT_FUNDING / USDC})`, () =>
    c.wallet.writeContract({ address: token.address, abi: demo.DemoUSDC.abi, functionName: 'mint', args: [vault.address, VAULT_FUNDING] })
  );

  const deployment: Deployment = {
    chainId: c.chainId,
    deployer: me,
    oracle: me,
    route: ROUTE_NAME,
    routeId: ROUTE_ID,
    cap: CAP.toString(),
    startBlock: startBlock.toString(),
    contracts: {
      DemoUSDC: token,
      MockSourceBridge: bridge,
      TripwireGuardian: guardian,
      ProtectedVault: vault,
      DrainReceiver: drainImpl,
      DrainProxy: drainProxy,
    },
  };
  writeFileSync(cfg.deploymentFile, JSON.stringify(deployment, null, 2) + '\n');
  return deployment;
}

export function readDeployment(cfg: TestnetConfig): Deployment {
  if (!existsSync(cfg.deploymentFile)) {
    throw new Error(`No deployment at ${cfg.deploymentFile}. Run \`npm run tripwire:deploy\` first.`);
  }
  return JSON.parse(readFileSync(cfg.deploymentFile, 'utf8')) as Deployment;
}

// --- the demo -------------------------------------------------------------------

/** eth_getLogs with a block cursor: the testnet counterpart of MemoryFeed. */
class ContractEventFeed<E> implements LogFeed<E> {
  private cursor: bigint;
  private times = new Map<bigint, number>();

  constructor(
    private c: Clients,
    private address: Hex,
    private abi: Abi,
    private eventName: string,
    from: bigint,
    private map: (args: Record<string, unknown>, timestamp: number) => E
  ) {
    this.cursor = from;
  }

  async poll(): Promise<E[]> {
    // Uncached: viem otherwise serves a block number up to 4 s old, and the
    // logs of the transactions just confirmed would fall outside the range.
    const latest = await this.c.pub.getBlockNumber({ cacheTime: 0 });
    if (latest < this.cursor) return [];
    const logs = await this.c.pub.getContractEvents({
      address: this.address,
      abi: this.abi,
      eventName: this.eventName,
      fromBlock: this.cursor,
      toBlock: latest,
    });
    this.cursor = latest + 1n;
    const out: E[] = [];
    for (const l of logs) {
      const bn = l.blockNumber ?? latest;
      if (!this.times.has(bn)) this.times.set(bn, Number((await this.c.pub.getBlock({ blockNumber: bn })).timestamp));
      out.push(this.map((l as unknown as { args: Record<string, unknown> }).args, this.times.get(bn) ?? 0));
    }
    return out;
  }
}

/** A recipient address nobody holds a key for: the tail of a hash. */
const nobody = (name: string) => `0x${keccak256(toHex(`tripwire-demo-${name}`)).slice(-40)}` as Hex;

/** The same four steps as the local loop, with recipients that exist on Sepolia. */
function testnetPayouts(drain: Hex) {
  const names = new Map<string, Hex>();
  const map = (a: Hex) => {
    if (a.toLowerCase() === DRAIN_CONTRACT) return drain;
    if (!names.has(a)) names.set(a, nobody(`recipient-${names.size}`));
    return names.get(a) as Hex;
  };
  return ATTACK_STEPS.map((s) => ({ ...s, payouts: s.payouts.map((p) => ({ ...p, recipient: map(p.recipient) })) }));
}

const BASELINE_TEMPLATE: Omit<RouteBaseline, 'computedAt'> = {
  route: ROUTE_NAME,
  windowHours: 24,
  sampleSize: 450,
  medianTransferUsd: 15_000,
  p95TransferUsd: 85_000,
  rollingTvlUsd: 25_000_000,
};

export interface TestnetPayout {
  recipient: Hex;
  amount: bigint;
  burned: bigint;
  score: number | null;
  verdict: string;
  reasons: string[];
  attestation: AttestationOutcome;
  txs: { burn?: Hex; request: Hex; attest?: Hex; execute: Hex };
  executed: boolean;
  blockedBy?: string;
}

export interface TestnetStep {
  title: string;
  payouts: TestnetPayout[];
  tierAfter: ResponseTier;
}

export async function runTestnetDemo(
  cfg: TestnetConfig,
  c: Clients,
  d: Deployment,
  opts: {
    contractFacts: (address: Hex) => Promise<ContractRiskSummary | null>;
    onStep?: (s: TestnetStep, index: number) => void;
    log?: (s: string) => void;
  }
): Promise<TestnetStep[]> {
  const { TripwireGuardian: guardian, ProtectedVault: vault, MockSourceBridge: bridge, DrainProxy: drain } = d.contracts;
  const log = opts.log ?? (() => undefined);

  // Every run starts from a clean route. A tier set by an earlier run lasts
  // 24 hours, and the hour's outflow total carries over; the owner's resume
  // and a fresh configureRoute clear both.
  for (const [label, functionName, args] of [
    ['guardian.resume', 'resume', [ROUTE_ID]],
    ['guardian.configureRoute', 'configureRoute', [ROUTE_ID, CAP, WINDOW_SECONDS]],
  ] as const) {
    const r = await send(c, c.wallet.writeContract({ address: guardian.address, abi: guardianArtifact.abi, functionName, args }));
    if (!r.ok) throw new Error(`${label} failed: ${txLink(r.hash)}`);
    log(`  reset: ${label.padEnd(24)} ${txLink(r.hash)}`);
  }

  const from = (await c.pub.getBlockNumber({ cacheTime: 0 })) + 1n;
  let clock = Number((await c.pub.getBlock()).timestamp);

  const port: GuardianPort = {
    address: guardian.address,
    chainId: c.chainId,
    currentTier: async (routeId) =>
      Number(await c.pub.readContract({ address: guardian.address, abi: guardianArtifact.abi, functionName: 'currentTier', args: [routeId] })) as ResponseTier,
    submitAttestation: async (a, signature) => {
      const r = await send(
        c,
        c.wallet.writeContract({
          address: guardian.address,
          abi: guardianArtifact.abi,
          functionName: 'submitAttestation',
          args: [a.routeId, a.riskScore, a.validUntil, a.nonce, signature],
        })
      );
      return { ok: r.ok, gas: r.gas, txHash: r.hash };
    },
  };

  const watcher = new Watcher({
    route: ROUTE_NAME,
    chain: 'ethereum',
    token: 'tdUSDC',
    decimals: 6,
    bridge: vault.address,
    ingress: new ContractEventFeed<BurnEvent>(c, bridge.address, demo.MockSourceBridge.abi, 'Burned', from, (a, t) => ({
      messageId: a.messageId as Hex,
      amount: a.amount as bigint,
      timestamp: t,
    })),
    egress: new ContractEventFeed<ReleaseEvent>(c, vault.address, demo.ProtectedVault.abi, 'ReleaseRequested', from, (a, t) => ({
      messageId: a.messageId as Hex,
      recipient: a.to as Hex,
      amount: a.amount as bigint,
      timestamp: t,
    })),
    baseline: { ...BASELINE_TEMPLATE, computedAt: clock - 300 },
    screening: {
      isFlagged: (a) => lookupFlaggedAddress(a) !== null,
      describe: (a) => (lookupFlaggedAddress(a) ? `${FLAG_LIST_NAME}: ${lookupFlaggedAddress(a)?.name}` : undefined),
    },
    contractFacts: opts.contractFacts,
    now: () => clock,
  });
  const attestor = new Attestor(cfg.account, port, { now: () => clock });

  const results: TestnetStep[] = [];
  const runId = Date.now();
  let seq = 0;
  for (const [index, step] of testnetPayouts(drain.address).entries()) {
    // 1. The bridge's two ends emit what a real bridge would.
    const txs = new Map<Hex, { burn?: Hex; request: Hex }>();
    for (const p of step.payouts) {
      const messageId = keccak256(toHex(`tripwire-sepolia-${runId}-${++seq}`));
      let burn: Hex | undefined;
      if (p.burned > 0n) {
        burn = (await send(c, c.wallet.writeContract({ address: bridge.address, abi: demo.MockSourceBridge.abi, functionName: 'burn', args: [messageId, p.burned] }))).hash;
      }
      const request = await send(
        c,
        c.wallet.writeContract({ address: vault.address, abi: demo.ProtectedVault.abi, functionName: 'requestRelease', args: [messageId, p.recipient, p.amount] })
      );
      if (!request.ok) throw new Error(`requestRelease failed: ${txLink(request.hash)}`);
      txs.set(messageId, { burn, request: request.hash });
    }

    // 2. The watcher sees them, scores each before it executes; the attestor acts.
    // A load-balanced RPC can answer from a node a block behind the receipt,
    // so keep polling, up to 30 s, until the watcher has seen every release.
    const observations: Awaited<ReturnType<Watcher['tick']>> = [];
    for (let attempt = 0; observations.length < step.payouts.length && attempt < 10; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
      clock = Number((await c.pub.getBlock()).timestamp);
      observations.push(...(await watcher.tick()));
    }
    if (observations.length !== step.payouts.length) {
      throw new Error(`The watcher saw ${observations.length} of ${step.payouts.length} releases after 30 s; the RPC is lagging. Rerun the demo.`);
    }

    const payouts: TestnetPayout[] = [];
    for (const o of observations) {
      clock = Number((await c.pub.getBlock()).timestamp);
      const attestation = await attestor.handle(ROUTE_ID, o.assessment);

      // 3. The vault pays out, through the guardian. A blocked payout is sent
      //    anyway, with a fixed gas limit, so the revert is on-chain for anyone to open.
      let blockedBy: string | undefined;
      try {
        // The revert comes from the guardian, so decode with its errors too.
        const abi = [...demo.ProtectedVault.abi, ...guardianArtifact.abi.filter((x) => x.type === 'error')];
        await c.pub.simulateContract({ account: cfg.account, address: vault.address, abi, functionName: 'executeRelease', args: [o.release.messageId] });
      } catch (err) {
        const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
        blockedBy = revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.shortMessage) : 'reverted';
      }
      const exec = await send(
        c,
        c.wallet.writeContract({
          address: vault.address,
          abi: demo.ProtectedVault.abi,
          functionName: 'executeRelease',
          args: [o.release.messageId],
          ...(blockedBy ? { gas: 300_000n } : {}),
        })
      );

      const t = txs.get(o.release.messageId);
      payouts.push({
        recipient: o.release.recipient,
        amount: o.release.amount,
        burned: o.burned,
        score: o.assessment.score,
        verdict: o.assessment.verdict,
        reasons: o.assessment.signals.filter((s) => s.score >= 0.9).map((s) => s.reason),
        attestation,
        txs: {
          burn: t?.burn,
          request: t?.request ?? ('0x' as Hex),
          attest: attestation.action !== 'skipped' ? attestation.result.txHash : undefined,
          execute: exec.hash,
        },
        executed: exec.ok,
        blockedBy: exec.ok ? undefined : (blockedBy ?? 'reverted'),
      });
    }

    const result: TestnetStep = { title: step.title, payouts, tierAfter: await port.currentTier(ROUTE_ID) };
    results.push(result);
    opts.onStep?.(result, index);
  }
  return results;
}
