import { describe, expect, it } from 'vitest';
import { decodeApproval, MAX_UINT256 } from '../abiDecoder';
import { extractApprovalsFromTransactions } from '../tokenApprovals';
import { approveCalldata, classifiedTx } from './factories';

const WALLET = '0xd8da6bf26964af9ded7ede3308c4157ed3714123';
const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC
const SPENDER = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'; // Uniswap router
const OTHER_SPENDER = '0x1111111254fb6c44bac0bed2854e76f90643097d';

describe('decodeApproval', () => {
  it('extracts the spender from calldata, not from tx.to', () => {
    const decoded = decodeApproval(approveCalldata(SPENDER, 1000n));
    expect(decoded?.spender).toBe(SPENDER);
  });

  it('recognises MaxUint256 as unlimited', () => {
    const decoded = decodeApproval(approveCalldata(SPENDER, MAX_UINT256));
    expect(decoded?.isUnlimited).toBe(true);
  });

  it('does not flag an ordinary allowance as unlimited', () => {
    const decoded = decodeApproval(approveCalldata(SPENDER, 1_000_000n));
    expect(decoded?.isUnlimited).toBe(false);
  });

  it('recognises a zero allowance as a revocation', () => {
    const decoded = decodeApproval(approveCalldata(SPENDER, 0n));
    expect(decoded?.isRevocation).toBe(true);
  });

  it('returns null for non-approve or truncated calldata', () => {
    expect(decodeApproval('0xa9059cbb')).toBeNull();
    expect(decodeApproval('0x095ea7b3dead')).toBeNull();
    expect(decodeApproval('0x')).toBeNull();
    expect(decodeApproval(undefined)).toBeNull();
  });
});

describe('extractApprovalsFromTransactions', () => {
  it('reports the spender and the token contract as distinct addresses', () => {
    const tx = classifiedTx({
      from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, MAX_UINT256),
      tokenSymbol: 'USDC', tokenDecimal: '6',
    });

    const [approval] = extractApprovalsFromTransactions([tx], WALLET);
    expect(approval.spender).toBe(SPENDER);
    expect(approval.tokenContract).toBe(TOKEN);
    expect(approval.isUnlimited).toBe(true);
  });

  it('omits an allowance that was later revoked', () => {
    const granted = classifiedTx({
      from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, MAX_UINT256),
      timeStamp: '1690000000',
    });
    const revoked = classifiedTx({
      from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, 0n),
      timeStamp: '1690100000',
    });

    expect(extractApprovalsFromTransactions([granted, revoked], WALLET)).toHaveLength(0);
  });

  it('keeps only the latest allowance per (token, spender) pair', () => {
    const unlimited = classifiedTx({
      from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, MAX_UINT256),
      timeStamp: '1690000000',
    });
    const reduced = classifiedTx({
      from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, 500n),
      timeStamp: '1690100000', tokenDecimal: '0', tokenSymbol: 'USDC',
    });

    const approvals = extractApprovalsFromTransactions([unlimited, reduced], WALLET);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].isUnlimited).toBe(false);
  });

  it('tracks different spenders on the same token separately', () => {
    const a = classifiedTx({ from: WALLET, to: TOKEN, input: approveCalldata(SPENDER, 100n) });
    const b = classifiedTx({ from: WALLET, to: TOKEN, input: approveCalldata(OTHER_SPENDER, 100n) });

    expect(extractApprovalsFromTransactions([a, b], WALLET)).toHaveLength(2);
  });

  it('ignores approvals granted by somebody else', () => {
    const notOurs = classifiedTx({
      from: OTHER_SPENDER, to: TOKEN, input: approveCalldata(SPENDER, MAX_UINT256),
    });
    expect(extractApprovalsFromTransactions([notOurs], WALLET)).toHaveLength(0);
  });

  it('does not treat a plain transfer as an approval', () => {
    const transfer = classifiedTx({ from: WALLET, to: TOKEN, input: '0xa9059cbb' });
    expect(extractApprovalsFromTransactions([transfer], WALLET)).toHaveLength(0);
  });
});
