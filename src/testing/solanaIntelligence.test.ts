import { describe, it, expect } from 'vitest';
import { isJitoTipAccount } from '../chains/solana/jito';
import { auditSplDelegates, assessProgramUpgradeRisk } from '../chains/solana/risk';
import { normalizeSolanaTx, type SolanaRpcTransaction } from '../chains/solana/normalize/balanceDiff';
import { WELL_KNOWN_CHAINS } from '../domain';

describe('Solana Intelligence & MEV Signals (Phase 3)', () => {
  const SUBJECT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const JITO_TIP_ACCOUNT = '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5';

  it('identifies official Jito MEV tip accounts', () => {
    expect(isJitoTipAccount(JITO_TIP_ACCOUNT)).toBe(true);
    expect(isJitoTipAccount('11111111111111111111111111111111')).toBe(false);
  });

  it('detects Jito tip in a Solana transaction and tags jito_tip with fee breakdown', () => {
    const rawTx: SolanaRpcTransaction = {
      slot: 280010000,
      blockTime: 1772550000,
      transaction: {
        signatures: ['jitoTx123456789...'],
        message: {
          accountKeys: [
            SUBJECT, // fee payer
            JITO_TIP_ACCOUNT,
            '11111111111111111111111111111111',
          ],
          instructions: [
            {
              programId: '11111111111111111111111111111111',
              accounts: [0, 1], // transfer to Jito tip account
            },
          ],
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 0, 1],
        postBalances: [999985000, 10000, 1],
      },
    };

    const normalized = normalizeSolanaTx(rawTx, SUBJECT, WELL_KNOWN_CHAINS.SOLANA_MAINNET);

    expect(normalized.tags).toContain('jito_tip');
    expect(normalized.fee.parts?.tip).toBe(10000n);
    expect(normalized.fee.amount).toBe(15000n);
  });

  it('audits SPL token delegates and flags dangerous unlimited allowances', () => {
    const findings = auditSplDelegates([
      {
        pubkey: 'tokenAccount1',
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        owner: SUBJECT,
        amount: 1000000000n,
        delegate: 'SpenderDrainer12345678901234567890123456',
        delegatedAmount: 1000000000n, // Full balance delegated
      },
      {
        pubkey: 'tokenAccount2',
        mint: 'So11111111111111111111111111111111111111112', // wSOL
        owner: SUBJECT,
        amount: 5000000000n,
        delegate: 'SafeDEXContract12345678901234567890123456',
        delegatedAmount: 1000000n, // Capped delegation
      },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0].isUnlimited).toBe(true);
    expect(findings[0].severity).toBe('high');
    expect(findings[1].isUnlimited).toBe(false);
    expect(findings[1].severity).toBe('medium');
  });

  it('assesses program upgrade authority for mutable vs immutable smart contracts', () => {
    const mutableReport = assessProgramUpgradeRisk({
      programId: 'MutableDexProgram11111111111111111111111',
      upgradeAuthority: 'AdminKey123456789012345678901234567890',
    });
    expect(mutableReport.riskLevel).toBe('medium');
    expect(mutableReport.flags).toContain('upgradeable_program');

    const immutableReport = assessProgramUpgradeRisk({
      programId: 'ImmutableProgram111111111111111111111111',
      upgradeAuthority: null, // Renounced
    });
    expect(immutableReport.riskLevel).toBe('low');
    expect(immutableReport.flags).toHaveLength(0);
  });
});
