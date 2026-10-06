import { describe, expect, it, vi } from 'vitest';
import { toHex, zeroAddress } from 'viem';
import { readPaymentState } from '../testnet/paymentState.js';
import { paymentFixture } from './fixtures/cctpPayment.js';
import { beneficiary, nonce, sender } from './fixtures/cctp.js';

function setup() {
  const f = paymentFixture();
  const head = { number: 200n, timestamp: 1000n, hash: toHex(44, { size: 32 }), parentHash: toHex(43, { size: 32 }) };
  const facts: Record<string, unknown> = { releases: [beneficiary, f.release.amount, 0, 0n, zeroAddress, 0n, 0],
    credits: [sender, f.intent.operationId, f.intent.policyHash, 0n, false], paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n],
    policyVersion: 1n, policyHash: f.intent.policyHash, approvedPolicyVersion: 0n, reviewedPolicyVersion: 0n,
    paymentsPaused: false, permittedRecipients: true, paymentDelayUntil: 0n, releaseDelayUntil: 0n };
  const proof = { messageId: f.release.messageId, recipient: beneficiary, amount: f.release.amount, nonce,
    source: { ...f.release.origin!, blockNumber: 100n }, destination: f.release.origin!,
    sourceMessageHash: nonce, destinationBodyHash: nonce, payment: f.intent };
  const reader = { getBlock: vi.fn(async () => head), minimumBlock: () => 0n,
    read: vi.fn(async (name: string, _block: bigint) => facts[name]) };
  return { facts, head, reader, proof, read: () => readPaymentState(reader, f.release.messageId, proof) };
}
describe('coherent customer policy snapshots', () => {
  it('reads every permission at one block and combines sticky delays', async () => {
    const f = setup(); f.facts.paymentDelayUntil = 1500n; f.facts.releaseDelayUntil = 1600n;
    expect(await f.read()).toMatchObject({ delay: { now: 1000n, until: 1600n }, payment: { version: 1n, blockers: [] } });
    expect(f.reader.read.mock.calls.every(([, block]) => block === 200n)).toBe(true);
  });
  it.each(['paused', 'recipient', 'amount', 'approval'])('reports the customer %s gate', async (gate) => {
    const f = setup();
    if (gate === 'paused') f.facts.paymentsPaused = true;
    if (gate === 'recipient') f.facts.permittedRecipients = false;
    if (gate === 'amount') f.facts.paymentPolicy = [1n, 1n, 1n, 0n];
    if (gate === 'approval') f.facts.policyHash = nonce;
    expect((await f.read()).payment?.blockers).toContain(gate);
  });
  it('requires current customer approval for old source intent but never overrides recipient permission', async () => {
    const f = setup(); f.facts.policyHash = nonce; f.facts.policyVersion = 2n; f.facts.approvedPolicyVersion = 1n;
    expect((await f.read()).payment?.blockers).toContain('approval');
    f.facts.approvedPolicyVersion = 2n; f.facts.permittedRecipients = false;
    expect((await f.read()).payment?.blockers).toEqual(['recipient']);
  });
  it.each(['credits', 'releases', 'policyVersion', 'paymentsPaused', 'paymentPolicy', 'paymentDelayUntil'])('refuses malformed/mismatched %s', async (name) => {
    const f = setup(); f.facts[name] = name === 'credits' ? [beneficiary, nonce, nonce, 0n, false] : name === 'releases' ? [sender, 1n, 0, 0n, zeroAddress, 0n, 0] : undefined;
    await expect(f.read()).rejects.toThrow();
  });
  it('refuses an RPC behind authenticated settlement or a known write', async () => {
    const f = setup(); f.head.number = 199n; await expect(f.read()).rejects.toThrow('behind');
    f.head.number = 200n; f.reader.minimumBlock = () => 201n; await expect(f.read()).rejects.toThrow('behind');
  });
  it('refuses a block hash change during policy reads', async () => {
    const f = setup(); f.reader.getBlock.mockResolvedValueOnce(f.head).mockResolvedValue({ ...f.head, hash: nonce });
    await expect(f.read()).rejects.toThrow('block changed');
  });
  it('disambiguates a returned credit from a funded rejection and rejects contradictory terminal state', async () => {
    const f = setup(); f.facts.credits = [sender, f.proof.payment.operationId, f.proof.payment.policyHash, 900n, true];
    await expect(f.read()).rejects.toThrow('terminal');
    f.facts.releases = [beneficiary, f.proof.amount, 3, 0n, zeroAddress, 1n, 0];
    expect((await f.read()).payment).toMatchObject({ returned: true, returnAt: 900n });
  });
});
