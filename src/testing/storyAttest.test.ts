import { describe, it, expect } from 'vitest';
import {
  computeCanonicalSnapshotHash,
  decodeStoryReceipt,
  verifyReceiptCommitment,
  getStoryReceiptForWallet,
} from '../chains/solana/decoders/receiptDecoder';

describe('Story-Attest ZK-Compressed Receipts (Phase 5)', () => {
  const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const TX_COUNT = 45;
  const NET_GAIN_LOSS = 3450.75;

  it('computes a deterministic canonical snapshot commitment hash', async () => {
    const hash1 = await computeCanonicalSnapshotHash(WALLET, TX_COUNT, NET_GAIN_LOSS);
    const hash2 = await computeCanonicalSnapshotHash(WALLET, TX_COUNT, NET_GAIN_LOSS);

    expect(hash1).toHaveLength(64); // 32-byte hex
    expect(hash1).toBe(hash2); // Deterministic
  });

  it('produces distinct commitments for different wallet snapshots', async () => {
    const hashA = await computeCanonicalSnapshotHash(WALLET, 10, 500);
    const hashB = await computeCanonicalSnapshotHash(WALLET, 11, 500);

    expect(hashA).not.toBe(hashB);
  });

  it('decodes compressed PDA receipt payload into a verified StoryReceipt', async () => {
    const expectedCommitment = await computeCanonicalSnapshotHash(WALLET, TX_COUNT, NET_GAIN_LOSS);

    const rawPayload = {
      schemaVersion: 1,
      wallet: WALLET,
      snapshotHash: expectedCommitment,
      tier: 4,
      issuedSlot: 280050123,
    };

    const receipt = decodeStoryReceipt(rawPayload);

    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.wallet).toBe(WALLET);
    expect(receipt.isCompressed).toBe(true);
    expect(receipt.tierLabel).toBe('Veteran DeFi Native');
    expect(receipt.issuedSlot).toBe(280050123);

    // Verify commitment authenticity
    const isValid = verifyReceiptCommitment(receipt, expectedCommitment);
    expect(isValid).toBe(true);

    // Detect tampering
    const isTamperedValid = verifyReceiptCommitment(receipt, 'invalid_hash_000000000000000000000000000000000000000000000000000000000');
    expect(isTamperedValid).toBe(false);
  });

  it('resolves on-chain receipt for Solana base58 wallet', async () => {
    const receipt = await getStoryReceiptForWallet(WALLET, 5, 270.0);
    expect(receipt).not.toBeNull();
    expect(receipt?.wallet).toBe(WALLET);
    expect(receipt?.isCompressed).toBe(true);

    // EVM address should return null
    const evmReceipt = await getStoryReceiptForWallet('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    expect(evmReceipt).toBeNull();
  });
});

