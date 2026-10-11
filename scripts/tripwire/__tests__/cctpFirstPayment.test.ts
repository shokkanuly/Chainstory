// Synthetic RPC fixtures. These tests establish no public burn/mint or audit.
import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { cctpAddressWord, cctpPaymentHook } from '../../../src/chains/evm/cctp.js';
import { boundedUsdcApprovalData, standardPaymentBurnData } from '../../../src/chains/evm/cctpBurn.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpMessengerBurnAbi, cctpTokenReadAbi } from '../../../src/chains/evm/registry/cctp.js';
import { prepareFirstPayment, firstPaymentRequestSchema, type FirstPaymentSource } from '../testnet/cctpFirstPayment.js';
import { createFirstPaymentIntent, parseFirstPaymentArgs } from '../testnet/planFirstCctpPayment.js';
import { input, hash, fixture as deploymentFixture } from './fixtures/cctpDeployment.js';

const request = { version: 1, grossBurnBaseUnits: '1000000', maxFeeBaseUnits: '1000', recipient: actors.bridge.address,
  operationId: hash(777), reservedBurnNonce: '1' };
function fixture(configInput = input) {
  const deployment = deploymentFixture(configInput);
  const state = { balance: 20_000_000n, allowance: 0n, eth: 1_000_000_000_000_000n, minimumFee: 100n, nonce: 0, pendingNonce: 0 };
  const source = {
    getChainId: vi.fn(async () => route.source.chainId as number),
    getBlock: vi.fn(async (args: Parameters<FirstPaymentSource['getBlock']>[0]): Promise<unknown> => deployment.header('blockNumber' in args ? args.blockNumber : 1000n)),
    getBalance: vi.fn(async (_address: Hex, _block: bigint): Promise<unknown> => state.eth),
    getCode: vi.fn(async (address: Hex, _block: bigint): Promise<unknown> => address === input.payment.sourceSender.toLowerCase() ? '0x' : '0x6000'),
    readToken: vi.fn(async (name: 'decimals' | 'balanceOf' | 'allowance', _block: bigint, _args?: readonly Hex[]): Promise<unknown> =>
      name === 'decimals' ? 6 : name === 'balanceOf' ? state.balance : state.allowance),
    readMessenger: vi.fn(async (name: 'getMinFeeAmount' | 'remoteTokenMessengers' | 'localMessageTransmitter', _block: bigint, _args?: readonly (number | bigint)[]): Promise<unknown> =>
      name === 'getMinFeeAmount' ? state.minimumFee : name === 'remoteTokenMessengers' ? cctpAddressWord(route.destination.messenger) : route.source.transmitter),
    getNonce: vi.fn(async (_address: Hex, block: bigint | 'pending'): Promise<unknown> => block === 'pending' ? state.pendingNonce : state.nonce),
    simulate: vi.fn(async (_from: Hex, to: Hex, _data: Hex, _block: bigint): Promise<unknown> => to === route.source.messenger ? '0x' : hash(1)),
    estimate: vi.fn(async (_from: Hex, _to: Hex, _data: Hex, _block: bigint): Promise<unknown> => 50_000n),
  } satisfies FirstPaymentSource;
  const destination = { ...deployment.reader, getLatestBlock: vi.fn(async (): Promise<unknown> => deployment.header(201n)),
    getBalance: vi.fn(async (_address: Hex, _block: bigint): Promise<unknown> => 1_000_000_000_000_000n) };
  return { ...deployment, state, source, destination,
    run: (intent: unknown = request, config: unknown = configInput) => prepareFirstPayment(config, deployment.bundle, intent, source, destination) };
}
function requireTransaction(report: Awaited<ReturnType<typeof prepareFirstPayment>>) {
  if (!report.nextTransaction) throw new Error('Fixture did not prepare a transaction'); return report.nextTransaction;
}

describe('keyless first Standard customer payment', () => {
  it('does not query source or emit calldata when deployment receipts are missing', async () => {
    const f = fixture(); f.bundle.transactions = [null, null, null, null];
    const report = await f.run(); expect(report.status).toBe('blocked'); expect(report.blockers).toHaveLength(4);
    expect(report.nextTransaction).toBeNull(); expect(f.source.getChainId).not.toHaveBeenCalled(); expect(f.destination.getLatestBlock).not.toHaveBeenCalled();
  });
  it('prepares only an exact one-USDC approval from actual zero allowance', async () => {
    const f = fixture(), report = await f.run(), tx = requireTransaction(report);
    expect(report.status).toBe('approval-required'); expect(report.enforcement).toBe(false); expect(report.submittedTransactions).toBe(0);
    expect(tx).toMatchObject({ purpose: 'approve-exact-amount', nonce: 0, chainId: 84532, from: input.payment.sourceSender.toLowerCase(), to: route.source.usdc, value: '0', gasEstimate: 50_000n });
    const decoded = decodeFunctionData({ abi: cctpTokenReadAbi, data: tx.data }); expect(decoded.functionName).toBe('approve');
    expect(decoded.args).toEqual([expect.stringMatching(/^0x/i), 1_000_000n]); expect(String(decoded.args?.[0]).toLowerCase()).toBe(route.source.messenger);
    expect(f.source.simulate).toHaveBeenCalledExactlyOnceWith(input.payment.sourceSender.toLowerCase(), route.source.usdc, tx.data, 1000n);
    expect(f.destination.readVault.mock.calls.some(([, block]) => block === 201n)).toBe(true);
    if (!('fee' in report)) throw new Error('Missing fee');
    expect(report.fee.netRange).toEqual({ minimumBaseUnits: 999_000n, maximumAtQuotedMinimum: 999_900n });
    expect(report.intent).toMatchObject({ policyHash: f.facts.policyHash, returnRecipient: input.payment.returnRecipient.toLowerCase(), operationId: request.operationId });
  });
  it('prepares the real burn only after exact allowance exists, binding domain, caller, return and live policy', async () => {
    const f = fixture(); f.state.nonce = f.state.pendingNonce = 1; f.state.allowance = 1_000_000n;
    const report = await f.run(), tx = requireTransaction(report); expect(report.status).toBe('burn-prepared'); expect(tx.nonce).toBe(1);
    const decoded = decodeFunctionData({ abi: cctpMessengerBurnAbi, data: tx.data }); expect(decoded.functionName).toBe('depositForBurnWithHook');
    expect(decoded.args).toEqual([1_000_000n, 0, cctpAddressWord(f.plan.contracts.vault), expect.any(String), cctpAddressWord(f.plan.contracts.vault), 1000n, 2000,
      cctpPaymentHook({ recipient: request.recipient, returnRecipient: input.payment.returnRecipient, operationId: request.operationId, policyHash: f.facts.policyHash })]);
    expect(String(decoded.args?.[3]).toLowerCase()).toBe(route.source.usdc);
    expect(f.source.simulate).toHaveBeenCalledExactlyOnceWith(input.payment.sourceSender.toLowerCase(), route.source.messenger, tx.data, 1000n);
  });
  it.each([1n, 2_000_000n, (1n << 256n) - 1n])('resets non-exact existing allowance %s before one bounded approval and burn', async (allowance) => {
    const f = fixture(), intent = { ...request, reservedBurnNonce: '2' }; f.state.allowance = allowance;
    const reset = requireTransaction(await f.run(intent)); expect(reset.purpose).toBe('reset-allowance');
    expect(decodeFunctionData({ abi: cctpTokenReadAbi, data: reset.data }).args?.[1]).toBe(0n);
    f.state.allowance = 0n; f.state.nonce = f.state.pendingNonce = 1;
    expect(requireTransaction(await f.run(intent)).purpose).toBe('approve-exact-amount');
    f.state.allowance = 1_000_000n; f.state.nonce = f.state.pendingNonce = 2;
    expect(requireTransaction(await f.run(intent)).purpose).toBe('standard-burn');
    // Burn consumes its EOA nonce even before a destination mint becomes visible.
    f.state.allowance = 0n; f.state.nonce = f.state.pendingNonce = 3;
    const again = await f.run(intent); expect(again.nextTransaction).toBeNull(); expect(again.blockers.some((b) => b.startsWith('RESERVED_BURN_NONCE_CHANGED'))).toBe(true);
  });
  it.each(['pending', 'nonce', 'usdc', 'sourceGas', 'destinationGas', 'recipient', 'fee'] as const)('blocks %s without simulating or emitting any action', async (failure) => {
    const f = fixture(); let intent = request;
    if (failure === 'pending') f.state.pendingNonce = 1;
    if (failure === 'nonce') f.state.nonce = f.state.pendingNonce = 4;
    if (failure === 'usdc') f.state.balance = 999_999n;
    if (failure === 'sourceGas') f.state.eth = 0n;
    if (failure === 'destinationGas') f.destination.getBalance.mockResolvedValue(0n);
    if (failure === 'recipient') intent = { ...request, recipient: actors.oracle.address };
    if (failure === 'fee') f.state.minimumFee = 1001n;
    const report = await f.run(intent); expect(report.status).toBe('blocked'); expect(report.nextTransaction).toBeNull(); expect(report.blockers.length).toBeGreaterThan(0);
    expect(f.source.simulate).not.toHaveBeenCalled(); expect(f.source.estimate).not.toHaveBeenCalled();
    if (failure === 'fee') { if (!('fee' in report)) throw new Error('Missing fee'); expect(report.fee.capCoversMinimum).toBe(false); expect(report.fee.netRange).toBeNull(); }
  });
  it('accepts an explicit zero Standard fee but never defaults unavailable fees to zero', async () => {
    const f = fixture(); f.state.minimumFee = 0n; expect((await f.run()).status).toBe('approval-required');
    f.source.readMessenger.mockImplementation(async () => { throw new Error('RPC outage'); }); await expect(f.run()).rejects.toThrow();
    expect(f.source.simulate).toHaveBeenCalledTimes(1);
  });
  it.each(['manual', 'maximum', 'routeCap'] as const)('honors a tighter configured %s limit before preparing a source action', async (limit) => {
    const custom = { ...input, payment: { ...input.payment, policy: { ...input.payment.policy } } };
    if (limit === 'manual') custom.payment.policy.manualApprovalAbove = '500000';
    if (limit === 'maximum') custom.payment.policy = { maxPayment: '500000', manualApprovalAbove: '500000', delayAbove: '500000', delaySeconds: '1800' };
    if (limit === 'routeCap') custom.capBaseUnits = '500000';
    const f = fixture(custom), report = await f.run(); expect(report.status).toBe('blocked'); expect(report.nextTransaction).toBeNull();
    expect(report.blockers.some((b) => b.startsWith(limit === 'manual' ? 'FIRST_PAYMENT_REQUIRES_CUSTOMER_APPROVAL' : 'AMOUNT_EXCEEDS_INITIAL_POLICY_OR_ROUTE_CAP'))).toBe(true);
    expect(f.source.simulate).not.toHaveBeenCalled();
  });
  it.each([1_000_000n, -1n, '100', undefined])('refuses incompatible minimum fee %s', async (fee) => {
    const f = fixture(), original = f.source.readMessenger.getMockImplementation();
    f.source.readMessenger.mockImplementation(async (name, block, args) => name === 'getMinFeeAmount' ? fee : original?.(name, block, args));
    await expect(f.run()).rejects.toThrow(); expect(f.source.simulate).not.toHaveBeenCalled();
  });
  it.each(['chain', 'decimals', 'code', 'smartSender', 'localTransmitter', 'remoteMessenger'] as const)('refuses incompatible source %s', async (failure) => {
    const f = fixture();
    if (failure === 'chain') f.source.getChainId.mockResolvedValue(1);
    if (failure === 'decimals') f.source.readToken.mockResolvedValue(18);
    if (failure === 'code') f.source.getCode.mockResolvedValue('0x');
    if (failure === 'smartSender') f.source.getCode.mockResolvedValue('0xef0100');
    if (failure === 'localTransmitter') f.source.readMessenger.mockResolvedValue(actors.oracle.address);
    if (failure === 'remoteMessenger') f.source.readMessenger.mockImplementation(async (name) => name === 'localMessageTransmitter' ? route.source.transmitter : hash(999));
    await expect(f.run()).rejects.toThrow(); expect(f.source.simulate).not.toHaveBeenCalled();
  });
  it.each(['policyVersion', 'totalCredited', 'paymentsPaused', 'usedOperations'] as const)('rechecks changed live destination %s after valid finalized acceptance', async (field) => {
    const f = fixture(), original = f.destination.readVault.getMockImplementation();
    f.destination.readVault.mockImplementation(async (name, block, args) => block === 201n && name === field
      ? field === 'paymentsPaused' || field === 'usedOperations' ? true : 2n : original?.(name, block, args));
    await expect(f.run()).rejects.toThrow(); expect(f.source.simulate).not.toHaveBeenCalled();
  });
  it('refuses a destination latest block behind the accepted deployment snapshot', async () => {
    const f = fixture(); f.destination.getLatestBlock.mockResolvedValue(f.header(199n)); await expect(f.run()).rejects.toThrow('behind');
  });
  it.each(['revert', 'false', 'malformed', 'gasZero', 'gasString', 'burnResult'] as const)('refuses incompatible source simulation/estimate: %s', async (failure) => {
    const f = fixture();
    if (failure === 'revert') f.source.simulate.mockRejectedValue(new Error('USDC paused'));
    if (failure === 'false') f.source.simulate.mockResolvedValue(hash(0));
    if (failure === 'malformed') f.source.simulate.mockResolvedValue('0x01');
    if (failure === 'gasZero') f.source.estimate.mockResolvedValue(0n);
    if (failure === 'gasString') f.source.estimate.mockResolvedValue('50000');
    if (failure === 'burnResult') { f.state.allowance = 1_000_000n; f.state.nonce = f.state.pendingNonce = 1; f.source.simulate.mockResolvedValue(hash(1)); }
    await expect(f.run()).rejects.toThrow(); expect(f.source.simulate).toHaveBeenCalledTimes(1);
  });
  it.each(['source', 'destination', 'receipt', 'pendingNonce'] as const)('detects %s changes while preparing the step', async (failure) => {
    const f = fixture();
    f.source.simulate.mockImplementation(async () => {
      if (failure === 'source') f.source.getBlock.mockResolvedValue({ ...f.header(1000n), hash: hash(9999) });
      if (failure === 'destination') f.destination.getBlock.mockImplementation(async (args) => ({ ...f.header('blockNumber' in args ? args.blockNumber : 200n), hash: hash(9999) }));
      if (failure === 'receipt') f.destination.getBlock.mockImplementation(async (args) => { const number = 'blockNumber' in args ? args.blockNumber : 200n;
        return { ...f.header(number), hash: number === 100n ? hash(9999) : hash(number) }; });
      if (failure === 'pendingNonce') f.state.pendingNonce = 1;
      return hash(1);
    });
    await expect(f.run()).rejects.toThrow(); expect(f.source.simulate).toHaveBeenCalledTimes(1);
  });
  it.each([{ grossBurnBaseUnits: 1 }, { grossBurnBaseUnits: '1.1' }, { grossBurnBaseUnits: '01' }, { grossBurnBaseUnits: '-1' },
    { grossBurnBaseUnits: '1' }, { grossBurnBaseUnits: '1000001' }, { maxFeeBaseUnits: '1000000' }, { maxFeeBaseUnits: '-1' },
    { operationId: hash(0) }, { recipient: `0x${'0'.repeat(40)}` }, { reservedBurnNonce: '9007199254740991' },
    { policyHash: hash(999) }, { returnRecipient: actors.oracle.address }])('rejects unsafe intent %j before RPC', async (patch) => {
    const f = fixture(); await expect(f.run({ ...request, ...patch })).rejects.toThrow(); expect(f.destination.getChainId).not.toHaveBeenCalled();
  });
});

describe('public first-payment intent and pure codecs', () => {
  it.each([0n, 1_000_000n, 7n, (1n << 256n) - 1n])('reserves a burn nonce from actual allowance %s', async (allowance) => {
    const f = fixture(); f.state.allowance = allowance;
    const intent = await createFirstPaymentIntent(input, request.operationId, f.source);
    expect(intent.reservedBurnNonce).toBe(allowance === 1_000_000n ? 0n : allowance === 0n ? 1n : 2n);
    expect(intent.grossBurnBaseUnits).toBe(1_000_000n); expect(f.source.simulate).not.toHaveBeenCalled();
  });
  it('does not create another intent across a pending nonce or changed source snapshot', async () => {
    const f = fixture(); f.state.pendingNonce = 1; await expect(createFirstPaymentIntent(input, request.operationId, f.source)).rejects.toThrow('pending');
    const s = fixture(); s.source.getBlock.mockResolvedValueOnce(s.header(1000n)).mockResolvedValueOnce({ ...s.header(1000n), hash: hash(999) });
    await expect(createFirstPaymentIntent(input, request.operationId, s.source)).rejects.toThrow('snapshot');
  });
  it('encodes bigint values exactly, and refuses zero vaults, negative approvals and non-positive credit', () => {
    const f = fixture(), intent = { recipient: request.recipient, returnRecipient: input.payment.returnRecipient, operationId: request.operationId, policyHash: f.facts.policyHash };
    const amount = (1n << 200n) + 7n, data = standardPaymentBurnData(f.plan.contracts.vault, amount, 1000n, intent);
    expect(decodeFunctionData({ abi: cctpMessengerBurnAbi, data }).args?.[0]).toBe(amount);
    expect(() => standardPaymentBurnData(`0x${'0'.repeat(40)}`, 100n, 1n, intent)).toThrow();
    expect(() => standardPaymentBurnData(f.plan.contracts.vault, 100n, 100n, intent)).toThrow();
    expect(() => boundedUsdcApprovalData(-1n)).toThrow();
    expect(firstPaymentRequestSchema.parse(request).grossBurnBaseUnits).toBe(1_000_000n);
    expect(parseFirstPaymentArgs(['--intent', 'config.json', 'new.json']).mode).toBe('intent');
    expect(parseFirstPaymentArgs(['config.json', 'receipts.json', 'intent.json', 'new.json']).mode).toBe('prepare');
    expect(() => parseFirstPaymentArgs(['config.json', 'intent.json', 'new.json'])).toThrow();
    expect(() => parseFirstPaymentArgs(['--send', 'a', 'b', 'c'])).toThrow();
  });
});
