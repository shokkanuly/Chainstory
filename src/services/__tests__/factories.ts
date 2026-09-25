// Shared fixture builders for the service tests.

import type { ClassifiedTransaction, RawTransaction, TaxCategory } from '../../types';

let counter = 0;

export function rawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
  counter += 1;
  return {
    hash: `0x${String(counter).padStart(64, '0')}`,
    blockNumber: String(18_000_000 + counter),
    timeStamp: String(1_690_000_000 + counter * 86_400),
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '0',
    gas: '21000',
    gasPrice: '20000000000',
    gasUsed: '21000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    ...overrides,
  };
}

export function classifiedTx(
  overrides: Partial<ClassifiedTransaction> = {}
): ClassifiedTransaction {
  const base = rawTx(overrides as Partial<RawTransaction>);
  const ethValue = parseFloat(base.value) / 1e18;
  return {
    ...base,
    description: 'test transaction',
    category: 'transfer' as TaxCategory,
    confidence: 0.9,
    usdValue: null,
    ethValue,
    assetSymbol: 'ETH',
    assetAmount: ethValue,
    ethPriceUsd: 2000,
    status: 'classified',
    date: new Date(parseInt(base.timeStamp, 10) * 1000),
    ...overrides,
  };
}

/** Encode an ERC-20 approve(spender, amount) calldata payload. */
export function approveCalldata(spender: string, amount: bigint): string {
  const spenderWord = spender.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amountWord = amount.toString(16).padStart(64, '0');
  return `0x095ea7b3${spenderWord}${amountWord}`;
}
