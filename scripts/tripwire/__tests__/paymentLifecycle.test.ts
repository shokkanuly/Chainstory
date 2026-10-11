// Synthetic own-contract event receipts, not a recorded testnet lifecycle.
import { describe, expect, it, vi } from 'vitest';
import { toHex, type Abi } from 'viem';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { readPaymentLifecycle, PAYMENT_HISTORY_BLOCK_LIMIT, type PaymentHistoryReader } from '../testnet/paymentLifecycle.js';
import { sourceProofSchema } from '../sourceProof.js';
import { FinalityConflictError } from '../finality.js';
import paymentArtifact from '../testnet/cctpPaymentEscrow.artifact.js';
import { paymentFixture } from './fixtures/cctpPayment.js';
import { vault, sender } from './fixtures/cctp.js';

const hex = (n: number) => toHex(n, { size: 32 });
function scenario(kind: 'held' | 'requested' | 'paid' | 'returned' = 'paid') {
  const f = paymentFixture(), epoch = 1_780_000_000n;
  const head = { number: 500n, hash: hex(500), parentHash: hex(499), timestamp: epoch + 5000n };
  const proof = sourceProofSchema.parse({ messageId: f.release.messageId, recipient: f.release.recipient, amount: f.release.amount,
    nonce: hex(1), source: { chainId: route.source.chainId, ...f.sourceReceipt.logs[0] },
    destination: { chainId: route.destination.chainId, ...f.destinationReceipt.logs[1] },
    sourceMessageHash: hex(2), destinationBodyHash: hex(3), payment: f.intent });
  const makeLog = (name: string, args: Record<string, unknown>, block: number) => ({
    ...f.log(paymentArtifact.abi as Abi, name, { messageId: proof.messageId, ...args }, block, vault, false),
    blockNumber: BigInt(block), blockHash: hex(block), transactionHash: hex(1000 + block) });
  const logs = [
    ...(['requested', 'returned'].includes(kind) ? [makeLog('ReturnRequested', { recipient: sender, readyAt: epoch + 3800n }, 300)] : []),
    ...(kind === 'paid' ? [makeLog('ReleaseExecuted', { to: proof.recipient, amount: proof.amount }, 450)] : []),
    ...(kind === 'returned' ? [makeLog('CreditReturned', { recipient: sender, amount: proof.amount }, 450)] : []),
  ];
  const receipts = logs.map((log) => ({ transactionHash: log.transactionHash, blockNumber: log.blockNumber, blockHash: log.blockHash,
    status: 'success', logs: [{ ...log, topics: [...log.topics] }] }));
  const times: Record<string, bigint> = { '200': epoch + 100n, '300': epoch + 200n, '450': epoch + 4000n, '500': epoch + 5000n };
  const destination: PaymentHistoryReader = { getChainId: async () => route.destination.chainId,
    getBlock: vi.fn(async (args) => {
      const number = 'blockTag' in args ? head.number : args.blockNumber;
      return { number, hash: number === 200n ? proof.destination.blockHash : hex(Number(number)), parentHash: hex(0), timestamp: times[String(number)] ?? head.timestamp };
    }), getTransactionReceipt: vi.fn(async ({ hash }) => receipts.find((receipt) => receipt.transactionHash === hash) ?? null),
    readPaymentEvents: vi.fn(async () => logs) };
  const input = { proof, source: f.source.port, destination, vault, head,
    state: kind === 'paid' ? 'EXECUTED' : kind === 'returned' ? 'RETURNED' : 'HELD',
    returnAt: ['requested', 'returned'].includes(kind) ? epoch + 3800n : 0n, recoveryDelay: 3600n };
  return { f, input, logs, receipts, times };
}
describe('receipt-backed customer payment lifecycle', () => {
  it.each(['held', 'requested', 'paid', 'returned'] as const)('records %s using canonical block times and separate terminal receipts', async (kind) => {
    const s = scenario(kind), report = await readPaymentLifecycle(s.input);
    expect(report.status).toBe('verified');
    if (report.status !== 'verified') throw new Error('Fixture must verify.');
    expect(report.mint.timestamp - report.burn.timestamp).toBe(100n);
    expect(report.outcome?.kind).toBe(kind === 'paid' || kind === 'returned' ? kind : undefined);
    expect(Boolean(report.returnRequest)).toBe(['requested', 'returned'].includes(kind));
    if (kind === 'held') expect(s.input.destination.readPaymentEvents).not.toHaveBeenCalled();
    else expect(s.input.destination.readPaymentEvents).toHaveBeenCalledWith(s.input.proof.messageId, 200n, 500n);
  });
  it('does not invent settlement duration when independent source/destination clocks differ', async () => {
    const s = scenario('held'); s.input.source.getBlock = async () => ({ number: 100n, hash: s.input.proof.source.blockHash, parentHash: hex(0), timestamp: s.input.head.timestamp + 1n });
    const report = await readPaymentLifecycle(s.input); expect(report.status).toBe('verified');
    if (report.status === 'verified') expect(report.burn.timestamp).toBeGreaterThan(report.mint.timestamp);
  });
  it.each(['missingReceipt', 'reverted', 'wrongTx', 'wrongReceiptHash', 'wrongReceiptBlock', 'missingIncludedLog', 'removedLog', 'removedReceiptLog',
    'duplicateLog', 'duplicateReceiptLog', 'wrongAmount', 'wrongRecipient', 'wrongMessage', 'wrongVault', 'eventAhead', 'eventBeforeMint',
    'noncanonical', 'futureClock', 'clockBeforeMint', 'omittedEvents', 'contradictoryState', 'rpcFailure', 'readerAbsent', 'scanLimit'] as const)
  ('suppresses terminal evidence when %s', async (failure) => {
    const s = scenario(), d = s.input.destination, log = s.logs[0], receipt = s.receipts[0];
    if (failure === 'missingReceipt') d.getTransactionReceipt = async () => null;
    if (failure === 'reverted') receipt.status = 'reverted';
    if (failure === 'wrongTx') receipt.transactionHash = hex(999);
    if (failure === 'wrongReceiptHash') receipt.blockHash = hex(999);
    if (failure === 'wrongReceiptBlock') receipt.blockNumber = 999n;
    if (failure === 'missingIncludedLog') receipt.logs = [];
    if (failure === 'removedLog') log.removed = true;
    if (failure === 'removedReceiptLog') receipt.logs[0].removed = true;
    if (failure === 'duplicateLog') s.logs.push(log);
    if (failure === 'duplicateReceiptLog') receipt.logs.push(receipt.logs[0]);
    if (failure === 'wrongAmount' || failure === 'wrongRecipient' || failure === 'wrongMessage') {
      const replacement = s.f.log(paymentArtifact.abi as Abi, 'ReleaseExecuted', {
        messageId: failure === 'wrongMessage' ? hex(99) : s.input.proof.messageId,
        to: failure === 'wrongRecipient' ? vault : s.input.proof.recipient,
        amount: failure === 'wrongAmount' ? s.input.proof.amount + 1n : s.input.proof.amount }, log.logIndex, vault, false);
      log.data = replacement.data; log.topics = replacement.topics; receipt.logs[0].data = log.data; receipt.logs[0].topics = [...log.topics];
    }
    if (failure === 'wrongVault') log.address = sender;
    if (failure === 'eventAhead') log.blockNumber = 501n;
    if (failure === 'eventBeforeMint') log.blockNumber = 199n;
    if (failure === 'noncanonical') { log.blockHash = hex(999); receipt.blockHash = hex(999); receipt.logs[0].blockHash = hex(999); }
    if (failure === 'futureClock') s.times['450'] = s.input.head.timestamp + 1n;
    if (failure === 'clockBeforeMint') s.times['450'] = s.times['200'] - 1n;
    if (failure === 'omittedEvents') s.logs.length = 0;
    if (failure === 'contradictoryState') s.input.state = 'RETURNED';
    if (failure === 'rpcFailure') d.readPaymentEvents = async () => { throw new Error('RPC token=secret'); };
    if (failure === 'readerAbsent') delete d.readPaymentEvents;
    if (failure === 'scanLimit') s.input.head.number = 200n + PAYMENT_HISTORY_BLOCK_LIMIT;
    const report = await readPaymentLifecycle(s.input);
    expect(report).toMatchObject({ version: 1, status: 'unavailable' }); expect(JSON.stringify(report)).not.toContain('secret');
    expect('outcome' in report).toBe(false);
  });
  it.each(['recipient', 'readyAt', 'immature', 'missingRequest', 'duplicateRequest'] as const)('rejects invalid return history: %s', async (failure) => {
    const s = scenario('returned');
    if (failure === 'recipient') s.input.proof.payment!.returnRecipient = vault;
    if (failure === 'readyAt') s.input.returnAt += 1n;
    if (failure === 'immature') s.times['450'] = s.input.returnAt - 1n;
    if (failure === 'missingRequest') s.logs.shift();
    if (failure === 'duplicateRequest') s.logs.push(s.logs[0]);
    expect((await readPaymentLifecycle(s.input)).status).toBe('unavailable');
  });
  it('does not reuse a successful lifecycle when the current terminal receipt disappears', async () => {
    const s = scenario(); expect((await readPaymentLifecycle(s.input)).status).toBe('verified');
    s.receipts.length = 0; expect((await readPaymentLifecycle(s.input)).status).toBe('unavailable');
  });
  it('propagates an authenticated backing reorg instead of silently exporting partial history', async () => {
    const s = scenario('held'); s.f.source.setHash(hex(999));
    await expect(readPaymentLifecycle(s.input)).rejects.toBeInstanceOf(FinalityConflictError);
  });
  it('rechecks terminal anchors after receipts, suppressing a block switch during observation', async () => {
    const s = scenario(), original = s.input.destination.getBlock;
    let reads = 0;
    s.input.destination.getBlock = async (args) => {
      const block = await original(args);
      return 'blockNumber' in args && args.blockNumber === 450n && ++reads > 1 ? { ...(block as object), hash: hex(999) } : block;
    };
    expect((await readPaymentLifecycle(s.input)).status).toBe('unavailable');
  });
});
