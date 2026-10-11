// Synthetic protocol/own-contract logs on linked headers. No public transfer.
import { decodeEventLog, toHex, type Abi, type Hex } from 'viem';
import { vi } from 'vitest';
import { z } from 'zod';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpTransmitterAbi } from '../../../../src/chains/evm/registry/cctp.js';
import { cctpPaymentAbi } from '../../../../src/chains/evm/registry/cctp.js';
import { paymentFixture, paymentBindings } from './cctpPayment.js';
import { sender, vault } from './cctp.js';
import { LOCAL_PROFILE, SCREENING_ISSUER } from '../../screenedLocal.js';

/** `version` 2: the screened escrow's v2 hook, discovered under manifest 4 (ADR-049). */
export function discoveryFixture(version: 1 | 2 = 1) {
  const f = paymentFixture(version);
  const decode = (log: typeof f.sourceReceipt.logs[number], abi: Abi, eventName: string) => ({ ...log,
    args: z.record(z.string(), z.unknown()).parse(decodeEventLog({ abi, eventName, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true }).args) });
  const sourceEvents = [decode(f.sourceReceipt.logs[0], cctpTransmitterAbi, 'MessageSent')];
  const destinationEvents = [decode(f.destinationReceipt.logs[2], cctpPaymentAbi, 'PaymentCreditBound')];
  const make = (source: boolean) => {
    const receipt = source ? f.sourceReceipt : f.destinationReceipt, events = source ? sourceEvents : destinationEvents;
    const chainId = source ? route.source.chainId : route.destination.chainId;
    let head = receipt.blockNumber + 1n;
    const hash = (n: bigint): Hex => n === receipt.blockNumber ? receipt.blockHash : toHex(n + 1000n, { size: 32 });
    const block = (n: bigint) => ({ number: n, hash: hash(n), parentHash: hash(n - 1n), timestamp: 1_780_000_000n + n });
    const getBlock = vi.fn(async (args: { blockTag?: 'finalized' | 'safe'; blockNumber?: bigint }) => block(args.blockTag === 'finalized' ? head : args.blockNumber ?? head));
    const getContractEvents = vi.fn(async (args: { fromBlock: bigint; toBlock: bigint }) => events.filter((e) => e.blockNumber >= args.fromBlock && e.blockNumber <= args.toBlock));
    return { client: { chainId, pub: { getChainId: vi.fn(async (): Promise<number> => chainId), getBlock, getContractEvents, getBlockNumber: async () => head } },
      getBlock, getContractEvents, block, setHead: (n: bigint) => { head = n; } };
  };
  const source = make(true), destination = make(false);
  const manifest = version === 2 ? { version: 4, vault, guardian: sender, operator: sender, payment: paymentBindings, requests: [],
    screening: { version: 1, providerIdHash: LOCAL_PROFILE.providerIdHash, listIdHash: LOCAL_PROFILE.listIdHash, issuer: SCREENING_ISSUER.address,
      subject: 'payout-recipient', maxObservationAgeSeconds: '300', maxSnapshotAgeSeconds: '3600' } }
    : { version: 3, vault, guardian: sender, operator: sender, payment: paymentBindings, requests: [] };
  return { f, manifest, sourceEvents, destinationEvents, source, destination,
    clients: { source: source.client, destination: destination.client }, starts: { source: 100n, destination: 200n } };
}
