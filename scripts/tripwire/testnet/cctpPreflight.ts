// Public snapshots only: no environment key loader, wallet, signature or sender.
import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { evmCodeSchema } from '../../../src/chains/evm/runtime.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { blockHeaderSchema } from '../finality.js';
import { cctpDeploymentPlan, cctpPaymentDeploymentSchema } from './cctpDeployPlan.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from './artifactAcceptance.js';

const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
export const stringifyPublic = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2);
export interface PreflightReader {
  getChainId(): Promise<unknown>;
  getBlock(args: { blockTag: 'latest' } | { blockNumber: bigint }): Promise<unknown>;
  getBalance(address: Hex, blockNumber: bigint): Promise<unknown>;
  getCode(address: Hex, blockNumber: bigint): Promise<unknown>;
  tokenRead(token: Hex, name: 'balanceOf' | 'decimals', blockNumber: bigint, account?: Hex): Promise<unknown>;
  getPendingNonce(address: Hex): Promise<unknown>;
  getGasPrice(): Promise<unknown>;
  estimateCreation(from: Hex, data: Hex): Promise<unknown>;
}

export async function cctpPreflight(input: unknown, source: PreflightReader, destination: PreflightReader) {
  const config = cctpPaymentDeploymentSchema.parse(input), plan = cctpDeploymentPlan(input);
  const { authority, sourceSender, returnRecipient, recoveryDelay } = config.payment;
  const customer = { authority, sourceSender, returnRecipient, recoveryDelay };
  const blockers: string[] = [], checks: { chainId: number; contract: Hex; codeHash: Hex; bytes: number }[] = [];
  const chainId = z.number().int().positive();
  if (chainId.parse(await source.getChainId()) !== route.source.chainId || chainId.parse(await destination.getChainId()) !== route.destination.chainId) {
    throw new Error('Preflight RPC chain does not match the pinned testnet route.');
  }
  const src = blockHeaderSchema.parse(await source.getBlock({ blockTag: 'latest' }));
  const dst = blockHeaderSchema.parse(await destination.getBlock({ blockTag: 'latest' }));
  for (const [r, reader, block] of [[route.source, source, src.number], [route.destination, destination, dst.number]] as const) {
    for (const address of [r.usdc, r.messenger, r.transmitter]) {
      const code = evmCodeSchema.parse(await reader.getCode(address, block));
      if (code === '0x') throw new Error('A pinned Circle contract has no runtime at the checked block.');
      checks.push({ chainId: r.chainId, contract: address, codeHash: keccak256(code), bytes: (code.length - 2) / 2 });
    }
    if (z.number().int().parse(await reader.tokenRead(r.usdc, 'decimals', block)) !== route.decimals) {
      throw new Error('Pinned USDC decimal count does not match the supported route.');
    }
  }
  const pendingNonce = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(await destination.getPendingNonce(config.deployer));
  if (BigInt(pendingNonce) !== config.deployerNonce) blockers.push('DEPLOYER_NONCE_CHANGED: regenerate the entire unsigned package before deployment.');
  for (const address of Object.values(plan.contracts)) {
    if (evmCodeSchema.parse(await destination.getCode(address, dst.number)) !== '0x') blockers.push(`PREDICTED_ADDRESS_OCCUPIED:${address}`);
  }
  // Aggregate by chain/address: owner, customer and recovery can be the same account.
  const accounts = new Map<string, { chainId: number; address: Hex; roles: string[]; ethWei: bigint }>();
  for (const [chain, reader, block, address, role] of [
    [route.destination.chainId, destination, dst.number, config.deployer, 'deployer'],
    [route.destination.chainId, destination, dst.number, config.owner, 'guardian-owner'],
    [route.destination.chainId, destination, dst.number, config.oracle, 'operator'],
    [route.destination.chainId, destination, dst.number, config.payment.authority, 'customer-policy'],
    [route.destination.chainId, destination, dst.number, config.payment.returnRecipient, 'customer-return-request'],
    [route.source.chainId, source, src.number, config.payment.sourceSender, 'source-sender'],
  ] as const) {
    const key = `${chain}:${address}`, found = accounts.get(key);
    if (found) { found.roles.push(role); continue; }
    const ethWei = uint.parse(await reader.getBalance(address, block));
    accounts.set(key, { chainId: chain, address, roles: [role], ethWei });
    if (ethWei === 0n) blockers.push(`NO_GAS:${key}`);
  }
  const sourceUsdcBaseUnits = uint.parse(await source.tokenRead(route.source.usdc, 'balanceOf', src.number, config.payment.sourceSender));
  if (sourceUsdcBaseUnits === 0n) blockers.push('NO_SOURCE_USDC: obtain test USDC on Base Sepolia before preparing a burn.');
  let firstDeploymentQuote: { gas: bigint; gasPriceWei: bigint; estimatedCostWei: bigint } | null = null;
  // Only step 1 is independently estimable before its dependent contracts exist.
  // Fee quote is transient, not a transaction fee ceiling or a full pilot budget.
  if (BigInt(pendingNonce) === config.deployerNonce && !blockers.some((b) => b.startsWith('PREDICTED_ADDRESS_OCCUPIED'))) {
    try {
      const gas = uint.refine((n) => n > 0n).parse(await destination.estimateCreation(config.deployer, plan.transactions[0].data));
      const gasPriceWei = uint.refine((n) => n > 0n).parse(await destination.getGasPrice());
      firstDeploymentQuote = { gas, gasPriceWei, estimatedCostWei: gas * gasPriceWei };
      const deployer = accounts.get(`${route.destination.chainId}:${config.deployer}`);
      if (!deployer || deployer.ethWei < firstDeploymentQuote.estimatedCostWei) blockers.push('FIRST_DEPLOYMENT_GAS_SHORTFALL');
    } catch { blockers.push('FIRST_DEPLOYMENT_ESTIMATE_UNAVAILABLE'); }
  }
  for (const [reader, head] of [[source, src], [destination, dst]] as const) {
    const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: head.number }));
    if (checked.hash !== head.hash || checked.number !== head.number || checked.timestamp !== head.timestamp) throw new Error('Preflight snapshot block changed.');
  }
  return { version: 1, mode: 'keyless-predeployment', enforcement: false, submittedTransactions: 0,
    route: route.id, packageHash: keccak256(stringToHex(stringifyPublic(plan))),
    artifactHashes: plan.artifactHashes, predicted: plan.contracts,
    expectedRuntimeHashes: { guardian: keccak256(expectedGuardianRuntime(plan.contracts.guardian)),
      payment: keccak256(expectedPaymentRuntime(plan.contracts.vault, plan.contracts.guardian, customer)) },
    snapshots: { source: src, destination: dst }, expectedDeployerNonce: config.deployerNonce, pendingDeployerNonce: pendingNonce,
    accounts: [...accounts.values()], sourceUsdcBaseUnits, firstDeploymentQuote, circleCodeObservations: checks,
    fundingAndNonceChecks: blockers.length ? 'blocked' : 'passed', blockers,
    remainingGates: [
      'Unsigned preparation only: no deployed payment escrow has been accepted by this report.',
      'Recheck pending nonce, balances and fee estimates immediately before signing each transaction; nonzero ETH does not establish adequate gas.',
      'Dependent escrow/configuration transactions require their own simulation after guardian deployment; this is not a full deployment cost estimate.',
      'Validate exact deployed Tripwire runtimes, finalized bindings, customer policy/recipient list and source account control before any USDC burn.',
      'Circle code hashes are observations of trusted external contracts, including proxies; they are not an independent Circle audit or implementation attestation.',
      'Prepare live Standard fee, policy/operation hook and finality evidence; no synthetic baseline can authorize a public payout.',
      'Record actual burn/mint/payout/return receipts and recovery drills. External review and pilot partner acceptance remain open.',
    ],
  };
}
