// Fixed-route Standard burn and bounded ERC-20 authorization codecs.
import { encodeFunctionData, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, cctpAddressWord, cctpPaymentHook } from './cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, CCTP_STANDARD_FINALITY, cctpMessengerBurnAbi, cctpTokenReadAbi } from './registry/cctp.js';
const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
export function standardPaymentBurnData(vault: Hex, amount: bigint, maxFee: bigint, intent: unknown): Hex {
  const target = cctpAddressSchema.refine((a) => !/^0x0{40}$/.test(a)).parse(vault);
  uint.positive().parse(amount); uint.parse(maxFee);
  if (maxFee >= amount) throw new Error('Maximum fee must leave a positive funded credit.');
  return encodeFunctionData({ abi: cctpMessengerBurnAbi, functionName: 'depositForBurnWithHook', args: [amount, route.destination.domain,
    cctpAddressWord(target), route.source.usdc, cctpAddressWord(target), maxFee, CCTP_STANDARD_FINALITY, cctpPaymentHook(intent)] });
}
export function boundedUsdcApprovalData(amount: bigint): Hex {
  uint.parse(amount);
  return encodeFunctionData({ abi: cctpTokenReadAbi, functionName: 'approve', args: [route.source.messenger, amount] });
}
