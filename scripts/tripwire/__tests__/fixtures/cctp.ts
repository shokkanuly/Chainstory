// Synthetic protocol vectors, not a recorded public transfer. Layout/ABI source:
// circlefin/evm-cctp-contracts@a92a2b4e7e6ef99bf0b05dca71780f5ec190e729.
import { concatHex, encodeAbiParameters, encodeEventTopics, padHex, toHex, zeroAddress, type Abi, type Hex } from 'viem';
import { vi } from 'vitest';
import { actors } from '../../../../src/tripwire/guardianVM.js';
import { cctpBeneficiaryHook, cctpReleaseId } from '../../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpMessengerAbi, cctpTransmitterAbi } from '../../../../src/chains/evm/registry/cctp.js';
import { cctpVerifierScope, type CctpProofLocator, type CctpRpc } from '../../cctp.js';
import type { ReleaseEvent } from '../../events.js';
import type { OperatorScope } from '../../store.js';

export const vault = actors.bridge.address.toLowerCase() as Hex;
export const beneficiary = actors.relayer.address.toLowerCase() as Hex;
export const sender = actors.owner.address.toLowerCase() as Hex;
export const sourceTx = `0x${'aa'.repeat(32)}` as Hex;
export const destinationTx = `0x${'bb'.repeat(32)}` as Hex;
export const nonce = `0x${'cc'.repeat(32)}` as Hex;
export const scope: OperatorScope = { route: route.id, sourceChainId: route.source.chainId, chainId: route.destination.chainId,
  source: route.source.transmitter, vault, guardian: actors.oracle.address, token: route.destination.usdc, sender,
  decimals: 6, finalityMode: 'finalized', sourceVerifier: cctpVerifierScope(vault, 'legacy-post-mint') };

const word = (v: Hex) => padHex(v, { size: 32 });
const u32 = (v: number) => toHex(v, { size: 4 });
const u256 = (v: bigint) => toHex(v, { size: 32 });
export function bytesReplace(raw: Hex, offset: number, replacement: Hex): Hex {
  return `0x${raw.slice(2, 2 + offset * 2)}${replacement.slice(2)}${raw.slice(2 + offset * 2 + replacement.length - 2)}`;
}
export const addressWord = word;
export function fixture(amount = 1_000_001n, fee = 100n) {
  const maxFee = 1000n;
  const hook = cctpBeneficiaryHook(beneficiary);
  const body = concatHex([u32(1), word(route.source.usdc), word(vault), u256(amount), word(sender), u256(maxFee), u256(0n), u256(0n), hook]);
  const receivedBody = bytesReplace(body, 164, u256(fee));
  const message = concatHex([u32(1), u32(6), u32(0), u256(0n), word(route.source.messenger), word(route.destination.messenger),
    word(zeroAddress), u32(2000), u32(0), body]);
  const sourceBlock = `0x${'11'.repeat(32)}` as Hex; const destinationBlock = `0x${'22'.repeat(32)}` as Hex;
  const log = (abi: Abi, name: string, args: Record<string, unknown>, index: number, address: Hex, source: boolean) => {
    const event = abi.find((item) => item.type === 'event' && item.name === name);
    if (!event || event.type !== 'event') throw new Error('Fixture event is missing.');
    const params = event.inputs.filter((input) => !input.indexed);
    return { address, logIndex: index, blockNumber: source ? 100n : 200n, blockHash: source ? sourceBlock : destinationBlock,
      transactionHash: source ? sourceTx : destinationTx, removed: false,
      topics: encodeEventTopics({ abi, eventName: name, args }), data: encodeAbiParameters(params, params.map((param) => args[param.name ?? ''])) };
  };
  const sentArgs = { message };
  const depositArgs = { burnToken: route.source.usdc, amount, depositor: sender, mintRecipient: word(vault), destinationDomain: 0,
    destinationTokenMessenger: word(route.destination.messenger), destinationCaller: word(zeroAddress), maxFee, minFinalityThreshold: 2000, hookData: hook };
  const receiveArgs = { caller: sender, sourceDomain: 6, nonce, sender: word(route.source.messenger), finalityThresholdExecuted: 2000, messageBody: receivedBody };
  const mintArgs = { mintRecipient: vault, amount: amount - fee, mintToken: route.destination.usdc as Hex, feeCollected: fee };
  const sourceReceipt = { status: 'success', transactionHash: sourceTx, blockNumber: 100n, blockHash: sourceBlock,
    logs: [log(cctpTransmitterAbi, 'MessageSent', sentArgs, 3, route.source.transmitter, true),
      log(cctpMessengerAbi, 'DepositForBurn', depositArgs, 4, route.source.messenger, true)] };
  const destinationReceipt = { status: 'success', transactionHash: destinationTx, blockNumber: 200n, blockHash: destinationBlock,
    logs: [log(cctpMessengerAbi, 'MintAndWithdraw', mintArgs, 5, route.destination.messenger, false),
      log(cctpTransmitterAbi, 'MessageReceived', receiveArgs, 6, route.destination.transmitter, false)] };
  const rpc = (source: boolean) => {
    const chainId = source ? route.source.chainId : route.destination.chainId;
    const receipt = source ? sourceReceipt : destinationReceipt;
    let finalized = receipt.blockNumber;
    let canonicalHash = receipt.blockHash;
    const port: CctpRpc = { getChainId: vi.fn(async () => chainId),
      getTransactionReceipt: vi.fn(async () => receipt),
      getBlock: vi.fn(async (args) => ({ number: 'blockNumber' in args ? args.blockNumber : finalized,
        hash: canonicalHash, parentHash: `0x${'00'.repeat(32)}`, timestamp: 1_780_000_000n })) };
    return { port, setFinalized: (n: bigint) => { finalized = n; }, setHash: (h: Hex) => { canonicalHash = h; } };
  };
  const release: ReleaseEvent = { messageId: cctpReleaseId(route.source.chainId, route.source.transmitter, sourceTx, 3),
    recipient: beneficiary, amount: amount - fee, timestamp: 1_780_000_000 };
  return { message, body, receivedBody, release, sourceReceipt, destinationReceipt, log, source: rpc(true), destination: rpc(false),
    locator: { sourceTransactionHash: sourceTx, sourceLogIndex: 3, destinationTransactionHash: destinationTx } as CctpProofLocator,
    replaceMessage: (raw: Hex) => { sourceReceipt.logs[0] = log(cctpTransmitterAbi, 'MessageSent', { message: raw }, 3, route.source.transmitter, true); },
    replaceDeposit: (args: Partial<typeof depositArgs>) => { sourceReceipt.logs[1] = log(cctpMessengerAbi, 'DepositForBurn', { ...depositArgs, ...args }, 4, route.source.messenger, true); },
    replaceReceive: (args: Partial<typeof receiveArgs>) => { destinationReceipt.logs[1] = log(cctpTransmitterAbi, 'MessageReceived', { ...receiveArgs, ...args }, 6, route.destination.transmitter, false); },
    replaceMint: (args: Partial<typeof mintArgs>) => { destinationReceipt.logs[0] = log(cctpMessengerAbi, 'MintAndWithdraw', { ...mintArgs, ...args }, 5, route.destination.messenger, false); } };
}
