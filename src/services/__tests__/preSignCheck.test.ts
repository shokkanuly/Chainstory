import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, erc20Abi, toFunctionSelector } from 'viem';
import {
  APPROVE_SELECTOR,
  MAX_UINT256,
  TRANSFER_FROM_SELECTOR,
  TRANSFER_SELECTOR,
  decodeTokenTransfer,
} from '../abiDecoder';
import { simulateTransactionPayload } from '../b2bSimulation';
import type { ContractIntel } from '../contractIntel';
import { REASON_IDS, checkBeforeSign, type PreSignDeps, type PreSignResult } from '../preSignCheck';
import {
  DEMO_FRESH_SPENDER,
  DEMO_RECIPIENT,
  PRE_SIGN_SCENARIOS,
  scenarioIntel,
} from '../preSignScenarios';
import { approveCalldata } from './factories';
import { CHECK_REASON_PHRASES } from '../../../server/checkPhrasing';

const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SPENDER = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45';
const FLAGGED = '0x000000000000000000000000000000000000bad1';

const ids = (r: PreSignResult) => r.reasons.map((x) => x.id);
const levelOf = (r: PreSignResult, id: string) => r.reasons.find((x) => x.id === id)?.level;

function facts(address: string, over: Partial<ContractIntel> = {}): ContractIntel {
  return {
    address,
    status: 'ok',
    isContract: true,
    isVerified: true,
    contractName: 'Router',
    isProxy: false,
    implementationAddress: null,
    createdAt: new Date(Date.UTC(2021, 0, 1)),
    ageDays: 2000,
    adminCapabilities: { canUpgrade: false, canPause: false, canMint: false, hasOwner: false, evidence: [] },
    ...over,
  };
}

/** An explorer that knows exactly the addresses given. */
function explorer(known: Record<string, Partial<ContractIntel>>): NonNullable<PreSignDeps['fetchIntel']> {
  return vi.fn(async (address: string) => {
    const over = known[address.toLowerCase()];
    if (!over) throw new Error(`unexpected lookup: ${address}`);
    return facts(address, over);
  });
}

const transferData = (to: string, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as `0x${string}`, amount] });

describe('selectors (I11: taken from EIP-20, not typed from memory)', () => {
  it('match the keccak of the EIP-20 signatures', () => {
    expect(toFunctionSelector('transfer(address,uint256)')).toBe(TRANSFER_SELECTOR);
    expect(toFunctionSelector('transferFrom(address,address,uint256)')).toBe(TRANSFER_FROM_SELECTOR);
    expect(toFunctionSelector('approve(address,uint256)')).toBe(APPROVE_SELECTOR);
  });

  it('the demo scenarios encode exactly what viem encodes from the ERC-20 ABI', () => {
    const [transfer, approve] = PRE_SIGN_SCENARIOS;
    expect(transfer.input.data).toBe(transferData(DEMO_RECIPIENT, 250_000_000n));
    expect(approve.input.data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DEMO_FRESH_SPENDER, MAX_UINT256] })
    );
  });
});

describe('the AI wording vocabulary', () => {
  it('the server has a phrase for exactly the reason ids the check can produce', () => {
    expect(Object.keys(CHECK_REASON_PHRASES).sort()).toEqual([...REASON_IDS].sort());
  });
});

describe('the two demo fixtures', () => {
  it('a benign ERC-20 transfer reads green', async () => {
    const r = await checkBeforeSign(PRE_SIGN_SCENARIOS[0].input, { fetchIntel: scenarioIntel });
    expect(r.badge).toBe('green');
    expect(r.kind).toBe('token_transfer');
    expect(ids(r)).toEqual(['token_transfer']);
    expect(r.transfer).toEqual({ from: null, recipient: DEMO_RECIPIENT, amount: 250_000_000n });
    expect(r.story).toBe('Send 250,000,000 base units of the token at 0x1111…1111 to 0x2222…2222.');
    expect(r.headline).toBe('Send Tokens');
  });

  it('an unlimited approval to a fresh, unverified contract reads red, and says why', async () => {
    const r = await checkBeforeSign(PRE_SIGN_SCENARIOS[1].input, { fetchIntel: scenarioIntel });
    expect(r.badge).toBe('red');
    expect(ids(r)).toEqual(['unlimited_allowance', 'spender_unverified', 'spender_fresh']);
    expect(levelOf(r, 'unlimited_allowance')).toBe('critical');
    expect(r.reasons.find((x) => x.id === 'spender_fresh')?.detail).toContain('deployed 1 day(s) ago');
    // The spender is the calldata argument, not the token at `to`.
    expect(r.spender?.contractAddress).toBe(DEMO_FRESH_SPENDER);
    expect(r.story).toContain('0x3333…3333');
    expect(r.story).not.toContain('0x1111…1111 permission');
  });

  it('each scenario states the badge it produces', async () => {
    for (const s of PRE_SIGN_SCENARIOS) {
      expect((await checkBeforeSign(s.input, { fetchIntel: scenarioIntel })).badge).toBe(s.expectedBadge);
    }
  });
});

describe('approvals', () => {
  it('unlimited to a verified, long-lived spender is a warning, not red', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: approveCalldata(SPENDER, MAX_UINT256) },
      { fetchIntel: explorer({ [TOKEN]: {}, [SPENDER]: {} }) }
    );
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toEqual(['unlimited_allowance', 'spender_verified']);
  });

  it('a limited allowance to a fresh unverified spender is yellow: bounded exposure', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: approveCalldata(SPENDER, 1_000_000n) },
      { fetchIntel: explorer({ [TOKEN]: {}, [SPENDER]: { isVerified: false, ageDays: 2, adminCapabilities: null } }) }
    );
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toEqual(['spender_unverified', 'spender_fresh', 'allowance_limited']);
  });

  it('unlimited to a spender the explorer cannot reach is red, and says it was not checked', async () => {
    const fetchIntel = vi.fn(async () => {
      throw new Error('Explorer proxy HTTP 502');
    });
    const r = await checkBeforeSign({ to: TOKEN, data: approveCalldata(SPENDER, MAX_UINT256) }, { fetchIntel });
    expect(r.badge).toBe('red');
    expect(ids(r)).toEqual(['unlimited_allowance', 'spender_unchecked']);
    expect(r.reasons[1].detail).toContain('Explorer proxy HTTP 502');
  });

  it('unlimited to a plain wallet is red', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: approveCalldata(SPENDER, MAX_UINT256) },
      { fetchIntel: explorer({ [TOKEN]: {}, [SPENDER]: { isContract: false } }) }
    );
    expect(r.badge).toBe('red');
    expect(ids(r)).toContain('spender_eoa');
  });

  it('an upgradeable spender is named as context', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: approveCalldata(SPENDER, MAX_UINT256) },
      { fetchIntel: explorer({ [TOKEN]: {}, [SPENDER]: { isProxy: true } }) }
    );
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toContain('spender_upgradeable');
  });

  it('a revocation is green and costs no spender lookup', async () => {
    const fetchIntel = explorer({ [TOKEN]: {} });
    const r = await checkBeforeSign({ to: TOKEN, data: approveCalldata(SPENDER, 0n) }, { fetchIntel });
    expect(r.badge).toBe('green');
    expect(ids(r)).toEqual(['allowance_revocation']);
    expect(fetchIntel).toHaveBeenCalledTimes(1);
  });
});

describe('the counterparty check', () => {
  it('a recipient on the phishing list is red, with the list named (I9)', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: transferData(FLAGGED, 1n) },
      { fetchIntel: explorer({ [TOKEN]: {} }) }
    );
    expect(r.badge).toBe('red');
    const flag = r.reasons.find((x) => x.id === 'flagged_address');
    expect(flag?.evidence).toContain('list: Retold curated phishing list');
    expect(flag?.title).toBe('The recipient appears on a phishing list');
  });

  it('flags a listed spender even when its facts look clean', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: approveCalldata(FLAGGED, MAX_UINT256) },
      { fetchIntel: explorer({ [TOKEN]: {}, [FLAGGED]: {} }) }
    );
    expect(r.badge).toBe('red');
    expect(levelOf(r, 'unlimited_allowance')).toBe('critical');
  });
});

describe('transfers and other calls', () => {
  it('tokens sent to the token contract itself are a warning', async () => {
    const r = await checkBeforeSign({ to: TOKEN, data: transferData(TOKEN, 5n) }, { fetchIntel: explorer({ [TOKEN]: {} }) });
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toContain('recipient_is_token');
  });

  it('tokens sent to the zero address are a warning', async () => {
    const zero = '0x0000000000000000000000000000000000000000';
    const r = await checkBeforeSign({ to: TOKEN, data: transferData(zero, 5n) }, { fetchIntel: explorer({ [TOKEN]: {} }) });
    expect(ids(r)).toContain('recipient_zero');
  });

  it('a token call to an address with no code is a warning', async () => {
    const r = await checkBeforeSign(
      { to: TOKEN, data: transferData(SPENDER, 5n) },
      { fetchIntel: explorer({ [TOKEN]: { isContract: false } }) }
    );
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toContain('target_no_code');
  });

  it('an unrecognised function is yellow even on a verified contract', async () => {
    const r = await checkBeforeSign({ to: SPENDER, data: '0xdeadbeef' }, { fetchIntel: explorer({ [SPENDER]: {} }) });
    expect(r.badge).toBe('yellow');
    expect(ids(r)).toEqual(['unknown_function', 'target_verified']);
    // Not "DeFi Token Swap", though the target is a known DEX router.
    expect(r.headline).toBe('Unrecognised contract call');
  });

  it('a known call on a fresh, unverified contract is yellow', async () => {
    const r = await checkBeforeSign(
      { to: SPENDER, data: '0x7ff36ab5' },
      { fetchIntel: explorer({ [SPENDER]: { isVerified: false, ageDays: 3 } }) }
    );
    expect(ids(r)).toEqual(['target_unverified', 'target_fresh']);
  });

  it('a plain ETH transfer to a wallet is green, and states the amount exactly', async () => {
    const r = await checkBeforeSign(
      { to: SPENDER, data: '0x', value: 1_500_000_000_000_000_001n },
      { fetchIntel: explorer({ [SPENDER]: { isContract: false } }) }
    );
    expect(r.badge).toBe('green');
    expect(r.story).toBe('Send 1.500000000000000001 ETH to 0x68b3…fc45.');
  });

  it('a plain ETH transfer with the explorer down stays green but says it was not checked', async () => {
    const r = await checkBeforeSign(
      { to: SPENDER, data: '', value: 1n },
      { fetchIntel: async () => { throw new Error('offline'); } }
    );
    expect(r.badge).toBe('green');
    expect(levelOf(r, 'target_unchecked')).toBe('info');
  });

  it('ETH attached to a contract call is surfaced', async () => {
    const r = await checkBeforeSign(
      { to: SPENDER, data: '0x7ff36ab5', value: 10n ** 18n },
      { fetchIntel: explorer({ [SPENDER]: {} }) }
    );
    expect(ids(r)).toContain('native_value');
  });
});

describe('unknown input never throws (I8)', () => {
  const junk: Array<[string, string]> = [
    ['', ''],
    ['not an address', '0x'],
    [TOKEN, 'zz'],
    [TOKEN, '0x123'],
    [TOKEN, '0x095ea7b3dead'],
    [TOKEN, '0xa9059cbb'],
    [TOKEN, `0xa9059cbb${'f'.repeat(128)}`], // dirty high bits in the address word
    [TOKEN, 'a9059cbb'],
  ];

  it.each(junk)('to=%j data=%j', async (to, data) => {
    const r = await checkBeforeSign({ to, data }, { fetchIntel: async () => { throw new Error('offline'); } });
    expect(['green', 'yellow', 'red']).toContain(r.badge);
    expect(r.story.length).toBeGreaterThan(0);
  });

  it('reads malformed calldata as a warning, never as a clean result', async () => {
    for (const data of ['zz', '0x123', '0x095ea7b3dead']) {
      const r = await checkBeforeSign({ to: TOKEN, data }, { fetchIntel: explorer({ [TOKEN]: {} }) });
      expect(r.badge).toBe('yellow');
      expect(ids(r)).toContain('malformed_calldata');
    }
  });

  it('an invalid target is a warning, and nothing is looked up', async () => {
    const fetchIntel = vi.fn();
    const r = await checkBeforeSign({ to: '0x123', data: '0x' }, { fetchIntel });
    expect(ids(r)).toEqual(['invalid_target']);
    expect(fetchIntel).not.toHaveBeenCalled();
  });
});

describe('decodeTokenTransfer', () => {
  it('reads transfer and transferFrom arguments', () => {
    expect(decodeTokenTransfer(transferData(SPENDER, 7n))).toEqual({ from: null, recipient: SPENDER, amount: 7n });
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [TOKEN, SPENDER, 9n] });
    expect(decodeTokenTransfer(data)).toEqual({ from: TOKEN, recipient: SPENDER, amount: 9n });
  });

  it('returns null for other or truncated calldata', () => {
    expect(decodeTokenTransfer(approveCalldata(SPENDER, 1n))).toBeNull();
    expect(decodeTokenTransfer(transferData(SPENDER, 7n).slice(0, 74))).toBeNull();
    expect(decodeTokenTransfer(undefined)).toBeNull();
  });
});

describe('simulateTransactionPayload regressions', () => {
  it('names the spender, not the token, as the party gaining permission', () => {
    const sim = simulateTransactionPayload({ from: '', to: TOKEN, value: '0', data: approveCalldata(SPENDER, 1n) });
    expect(sim.plainEnglishDescription).toBe('Allow 0x68b3...fc45 to spend your tokens held at 0xa0b8...eb48');
  });

  it('detects unlimited from the amount argument, not from a run of f’s anywhere', () => {
    const sim = (data: string) => simulateTransactionPayload({ from: '', to: TOKEN, value: '0', data }).severity;
    // Missed before: an effectively unlimited amount that is not exactly 2^256 - 1.
    expect(sim(approveCalldata(SPENDER, MAX_UINT256 - 1n))).toBe('danger');
    // Flagged before: a limited amount followed by trailing bytes that happen to be all f's.
    expect(sim(`${approveCalldata(SPENDER, 1n)}${'f'.repeat(64)}`)).toBe('caution');
  });

  it('an unreadable value does not throw', () => {
    const sim = simulateTransactionPayload({ from: '', to: TOKEN, value: '1.5', data: '0x' });
    expect(sim.riskWarnings).toContain('Transaction value could not be read');
  });
});
