// src/services/stressTestRunner.ts
//
// Stress-test runner executing all 6 real wallet scenarios against the live analysis services.

import { analyzeWalletIntelligence } from './walletIntelligence';
import { analyzePreventiveTokenRisk } from './preventiveScamScanner';
import { explainContractPermissionRisk } from './contractRiskExplainer';
import { calculateFifoTaxReport } from './fifoEngine';
import { fetchChainTransactions, CHAIN_CONFIGS } from './multiChain';
import type { ClassifiedTransaction, RawTransaction } from '../types';

export async function runStressTest() {
  console.log('=== STARTING CHAINSTORY STRESS TEST ===\n');

  // -------------------------------------------------------------
  // Test Case 1: Near-empty / brand-new wallet
  // -------------------------------------------------------------
  console.log('--- TEST 1: Near-empty / Brand New Wallet ---');
  const emptyAddr = '0x0000000000000000000000000000000000000001';
  const emptyIntel = analyzeWalletIntelligence([], emptyAddr);
  console.log('Wallet Age:', emptyIntel.walletAgeDays);
  console.log('Reputation Label:', emptyIntel.reputationLabel);
  console.log('Risk Status:', emptyIntel.riskStatus);
  console.log('Flagged Count:', emptyIntel.flaggedInteractions.length);

  // -------------------------------------------------------------
  // Test Case 2: High-volume exchange hot wallet (Binance 14)
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: High-Volume Wallet (Binance 14) ---');
  const binanceAddr = '0x28C6c06298d514Db089934071355E5743bf21d60';
  const mockHighVolTxs: ClassifiedTransaction[] = Array.from({ length: 150 }, (_, i) => ({
    hash: `0xbinance_${i}`,
    blockNumber: `${20000000 + i}`,
    from: i % 2 === 0 ? binanceAddr : '0x1111111111111111111111111111111111111111',
    to: i % 2 === 0 ? '0x2222222222222222222222222222222222222222' : binanceAddr,
    description: `Binance high volume transfer #${i}`,
    category: 'transfer',
    confidence: 0.9,
    usdValue: 10000,
    ethValue: 3.5,
    status: 'classified',
    value: '3500000000000000000',
    gas: '21000',
    gasPrice: '20000000000',
    gasUsed: '21000',
    input: '0x',
    functionName: 'transfer',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: String(1700000000 + i * 3600),
    date: new Date((1700000000 + i * 3600) * 1000),
    walletLabel: binanceAddr,
    chainId: 'ethereum',
  }));
  const highVolIntel = analyzeWalletIntelligence(mockHighVolTxs, binanceAddr);
  console.log('Total Txs Processed:', mockHighVolTxs.length);
  console.log('Reputation Label:', highVolIntel.reputationLabel);
  console.log('Risk Status:', highVolIntel.riskStatus);

  // -------------------------------------------------------------
  // Test Case 3: Wallet with Tornado Cash / Sanctioned interaction
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Tornado Cash / Flagged Interaction Wallet ---');
  const tornadoUserAddr = '0x3333333333333333333333333333333333333333';
  const tornadoTx: ClassifiedTransaction = {
    hash: '0xtornadotx123',
    blockNumber: '19000000',
    from: tornadoUserAddr,
    to: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', // Tornado Cash Router
    description: 'Deposit to Tornado Cash Router',
    category: 'transfer',
    confidence: 0.99,
    usdValue: 2000,
    ethValue: 1.0,
    status: 'classified',
    value: '1000000000000000000',
    gas: '100000',
    gasPrice: '20000000000',
    gasUsed: '95000',
    input: '0xb214faa5',
    functionName: 'deposit(bytes32)',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1705000000',
    date: new Date(1705000000 * 1000),
    walletLabel: tornadoUserAddr,
    chainId: 'ethereum',
  };
  const tornadoIntel = analyzeWalletIntelligence([tornadoTx], tornadoUserAddr);
  console.log('Risk Status:', tornadoIntel.riskStatus);
  console.log('Flagged Interacted Count:', tornadoIntel.flaggedInteractions.length);
  if (tornadoIntel.flaggedInteractions.length > 0) {
    console.log('Flagged Details:', tornadoIntel.flaggedInteractions[0]);
  }

  // -------------------------------------------------------------
  // Test Case 4: Scam / Airdrop Token & Contract Risk Explainer
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Scam Token & Contract Risk Explainer ---');
  const scamTokenAddr = '0x000000000000000000000000000000000000bad1';
  const unknownContractAddr = '0x9999999999999999999999999999999999999999';

  const scamResult = analyzePreventiveTokenRisk(scamTokenAddr);
  console.log('Scam Token Analysis Output:');
  console.log('Symbol:', scamResult.tokenSymbol);
  console.log('Risk Score:', scamResult.riskScore);
  console.log('Recommendation:', scamResult.recommendation);
  console.log('Summary Copy:', scamResult.plainEnglishSummary);

  const contractResult = explainContractPermissionRisk(unknownContractAddr);
  console.log('\nUnknown Contract Explainer Output:');
  console.log('Proxy Type:', contractResult.proxyType);
  console.log('Can Upgrade Code:', contractResult.canUpgradeCode);
  console.log('Severity:', contractResult.riskSeverity);
  console.log('Exact Copy Output:', contractResult.plainEnglishExplanation);

  // -------------------------------------------------------------
  // Test Case 5: Tax / FIFO with missing historical price
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Tax/FIFO with Missing Price Data ---');
  const txWithMissingPrice: ClassifiedTransaction = {
    hash: '0xmissingpricetx',
    blockNumber: '19500000',
    from: '0x4444444444444444444444444444444444444444',
    to: '0x5555555555555555555555555555555555555555',
    description: 'Traded obscure token WITH_NO_PRICE',
    category: 'trade',
    confidence: 0.8,
    usdValue: null, // MISSING PRICE
    ethValue: 1.0,
    status: 'classified',
    value: '1000000000000000000',
    gas: '21000',
    gasPrice: '20000000000',
    gasUsed: '21000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1710000000',
    date: new Date(1710000000 * 1000),
    walletLabel: '0x5555555555555555555555555555555555555555',
    tokenSymbol: 'NO_PRICE_TOKEN',
  };

  const fifoMissingReport = calculateFifoTaxReport([txWithMissingPrice], '0x5555555555555555555555555555555555555555');
  console.log('Total Proceeds USD:', fifoMissingReport.totalProceedsUsd);
  console.log('Total Cost Basis USD:', fifoMissingReport.totalCostBasisUsd);
  console.log('Net Gain/Loss USD:', fifoMissingReport.netCapitalGainLossUsd);
  console.log('Realized Disposals Count:', fifoMissingReport.realizedTransactions.length);

  // -------------------------------------------------------------
  // Test Case 6: Multi-Chain check across 4 non-Ethereum chains
  // -------------------------------------------------------------
  console.log('\n--- TEST 6: Multi-Chain Execution Across 4 Non-Ethereum Chains ---');
  const chains = ['arbitrum', 'base', 'optimism', 'polygon'] as const;

  for (const c of chains) {
    const config = CHAIN_CONFIGS[c];
    console.log(`Checking ${config.name} (${c}) -> API: ${config.apiUrl}`);
    const res = await fetchChainTransactions('0x1111111111111111111111111111111111111111', c);
    console.log(`  -> Returned ${res.length} txs for ${c}`);
  }

  console.log('\n=== STRESS TEST COMPLETED ===');
}

runStressTest().catch(console.error);
