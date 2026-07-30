// src/App.tsx — Blockchair Explorer UI & Multi-Chain AI Tax Engine
import { useState, useCallback, useMemo, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import NetworkTicker from '@/components/NetworkTicker';
import Features from '@/components/Features';
import Architecture from '@/components/Architecture';
import HowItWorks from '@/components/HowItWorks';
import Security from '@/components/Security';
import CTA from '@/components/CTA';
import Footer from '@/components/Footer';

import WalletInput from './components/WalletInput';
import TaxDashboard, { computeSummary } from './components/TaxDashboard';
import TransactionTimeline from './components/TransactionTimeline';
import WalletIntelligenceCard from './components/WalletIntelligenceCard';
import TokenApprovalsPanel from './components/TokenApprovalsPanel';
import ContractRiskModal from './components/ContractRiskModal';
import type { ChainId, ClassifiedTransaction, RawTransaction, B2BSimulationResult } from './types';
import { fetchMultiWalletTransactions, weiToEth, formatAddress } from './services/etherscan';
import { classifyAll } from './services/classifier';
import { calculateFifoTaxReport } from './services/fifoEngine';
import { simulateTransactionPayload } from './services/b2bSimulation';
import { CHAIN_CONFIGS } from './services/multiChain';
import './App.css';

type AppState = 'idle' | 'fetching' | 'classifying' | 'done' | 'error';

const INITIAL_MOCK_TRANSACTIONS: ClassifiedTransaction[] = [
  {
    hash: '0xmockhash1',
    blockNumber: '19480112',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
    description: 'Swapped 2 ETH for 3,400 USDC on Uniswap V3',
    category: 'trade',
    confidence: 0.98,
    usdValue: 3400,
    ethValue: 2.0,
    status: 'classified',
    value: '2000000000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x5ae401dc',
    functionName: 'multicall(bytes[] data)',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1772539200',
    date: new Date('2026-03-03T12:00:00Z'),
    walletLabel: 'vitalik.eth',
    chainId: 'ethereum',
  },
  {
    hash: '0xmockhash2',
    blockNumber: '19472019',
    from: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    description: 'Received 0.045 ETH staking reward from Lido Protocol',
    category: 'income',
    confidence: 0.95,
    usdValue: 121.5,
    ethValue: 0.045,
    status: 'classified',
    value: '45000000000000000',
    gas: '54000',
    gasUsed: '51200',
    gasPrice: '18000000000',
    input: '0x4e71d92d',
    functionName: 'claimRewards()',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1772111400',
    date: new Date('2026-02-26T14:30:00Z'),
    walletLabel: 'vitalik.eth',
    chainId: 'ethereum',
  },
  {
    hash: '0xmockhash3',
    blockNumber: '19451002',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
    description: 'Moved 1.5 ETH to secondary cold wallet (non-taxable transfer)',
    category: 'transfer',
    confidence: 0.99,
    usdValue: 0,
    ethValue: 1.5,
    status: 'classified',
    value: '1500000000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x',
    functionName: 'transfer(address to, uint256 amount)',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1770196500',
    date: new Date('2026-02-04T09:15:00Z'),
    walletLabel: 'vitalik.eth',
    chainId: 'ethereum',
  },
  {
    hash: '0xmockhash4',
    blockNumber: '19430882',
    from: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    description: 'Purchased Bored Ape NFT #42069 for 4.2 ETH',
    category: 'nft',
    confidence: 0.96,
    usdValue: 11340,
    ethValue: 4.2,
    status: 'classified',
    value: '4200000000000000000',
    gas: '120000',
    gasUsed: '115000',
    gasPrice: '21000000000',
    input: '0xa0712d68',
    functionName: 'mint(uint256 quantity)',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1769712300',
    date: new Date('2026-01-29T18:45:00Z'),
    walletLabel: 'vitalik.eth',
    chainId: 'ethereum',
  },
];

export default function App() {
  const [appState, setAppState] = useState<AppState>('done');
  const [walletAddresses, setWalletAddresses] = useState<string[]>(['vitalik.eth']);
  const [selectedChain, setSelectedChain] = useState<ChainId | 'all'>('all');
  const [transactions, setTransactions] = useState<ClassifiedTransaction[]>(INITIAL_MOCK_TRANSACTIONS);
  const [rawTransactions, setRawTransactions] = useState<RawTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCapped, setIsCapped] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [showSimModal, setShowSimModal] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [simResult, setSimResult] = useState<B2BSimulationResult | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSimModal) setShowSimModal(false);
        if (showRiskModal) setShowRiskModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSimModal]);

  const filteredTransactions = useMemo(() => {
    if (selectedChain === 'all') return transactions;
    return transactions.filter(tx => tx.chainId === selectedChain || !tx.chainId);
  }, [transactions, selectedChain]);

  const classifiedCount = transactions.filter(
    tx => tx.status === 'classified' || tx.status === 'error'
  ).length;

  const primaryWallet = walletAddresses[0] || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
  const fifoReport = useMemo(() => {
    return calculateFifoTaxReport(filteredTransactions, primaryWallet);
  }, [filteredTransactions, primaryWallet]);

  const summary = useMemo(() => {
    const base = computeSummary(filteredTransactions);
    return {
      ...base,
      realizedGainTotal: fifoReport.totalRealizedGainUsd,
      realizedLossTotal: fifoReport.totalRealizedLossUsd,
      totalCostBasis: fifoReport.totalCostBasisUsd,
    };
  }, [filteredTransactions, fifoReport]);

  const handleAnalyze = useCallback(async (addresses: string[]) => {
    setError(null);
    setTransactions([]);
    setRawTransactions([]);
    setWalletAddresses(addresses);
    setIsCapped(false);
    setAppState('fetching');

    try {
      const allFetchedTxs = await fetchMultiWalletTransactions(addresses);
      const totalCount = allFetchedTxs.length;
      const cappedTxs = allFetchedTxs.slice(0, 100);
      setIsCapped(totalCount > 100);

      if (cappedTxs.length === 0) {
        setAppState('done');
        setTransactions([]);
        setRawTransactions([]);
        return;
      }

      setRawTransactions(cappedTxs);

      const initialTxs: ClassifiedTransaction[] = cappedTxs.map(tx => {
        const ethVal = weiToEth(tx.value);
        return {
          ...tx,
          description: tx.functionName
            ? `Call method: ${tx.functionName}`
            : ethVal > 0
            ? `Transfer of ${ethVal.toFixed(4)} ETH`
            : `Contract Interaction (${tx.input.slice(0, 10)})`,
          category: 'unknown',
          confidence: 0,
          usdValue: null,
          ethValue: ethVal,
          status: 'pending',
          date: new Date(parseInt(tx.timeStamp) * 1000),
          chainId: tx.chainId || 'ethereum',
        };
      });

      setTransactions(initialTxs);
      setAppState('classifying');

      const primaryTargetAddr = addresses[0] || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      await classifyAll(cappedTxs, primaryTargetAddr, (classified) => {
        setTransactions(prev =>
          prev.map(tx => tx.hash === classified.hash ? classified : tx)
        );
      });

      setAppState('done');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred while fetching wallet data.';
      setError(message);
      setAppState('error');
    }
  }, []);

  const handleTestB2BSimulate = () => {
    const result = simulateTransactionPayload({
      from: primaryWallet,
      to: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
      value: '1000000000000000000',
      data: '0x3593564c000000000000000000000000',
    });
    setSimResult(result);
    setShowSimModal(true);
  };

  const isLoading = appState === 'fetching' || appState === 'classifying';

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-chain/30 selection:text-chain">
      {/* Top Navbar */}
      <Navbar />

      {/* Blockchair Hero */}
      <Hero onAnalyze={handleAnalyze} />

      {/* Main Block Explorer & Tax Workspace */}
      <section id="app-workspace" className="relative py-16 border-t border-border/50">
        {/* Subtle background wash */}
        <div className="absolute inset-0 bg-gradient-to-b from-card/30 via-transparent to-transparent pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3.5 py-1 text-[11px] font-semibold text-muted-foreground mb-4 uppercase tracking-wider">
                Block Explorer
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-[-0.03em] leading-tight">
                Multi-Chain <span className="text-gradient-chain">Tax Engine</span>
              </h2>
              <p className="text-muted-foreground text-sm mt-1.5 max-w-lg">
                Enter EVM addresses or ENS domains for local AI classification &amp; Form 8949 cost basis reports.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRiskModal(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 transition-all duration-200 shrink-0"
              >
                🔍 Pre-Scan Risk &amp; Permissions
              </button>

              <button
                onClick={handleTestB2BSimulate}
                className="inline-flex items-center gap-2 rounded-xl border border-signal-red/25 bg-signal-red/8 px-4 py-2.5 text-xs font-semibold text-signal-red hover:bg-signal-red/15 transition-all duration-200 shrink-0"
              >
                🛡️ Test B2B Pre-Sign API
              </button>
            </div>
          </div>

          {/* Network Stats Ticker */}
          <NetworkTicker
            selectedChain={selectedChain}
            onSelectChain={(id) => setSelectedChain(id as ChainId)}
          />

          {/* Wallet Search Input */}
          <WalletInput
            onSubmit={handleAnalyze}
            isLoading={isLoading}
            error={null}
            connectedWallet={connectedWallet}
            onWalletConnectStateChange={setConnectedWallet}
          />

          {/* Error Banner */}
          {error && (
            <div className="rounded-xl border border-signal-red/30 bg-signal-red/8 p-4 text-signal-red text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">⚠️ {error}</span>
              <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
            </div>
          )}

          {/* Progress Banner */}
          {appState === 'classifying' && (
            <div className="rounded-xl border border-chain/25 bg-chain/8 p-4 text-chain text-sm flex items-center justify-between font-medium animate-pulse">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chain opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-chain" />
                </span>
                <span>Classifying on-chain transactions: {classifiedCount} / {rawTransactions.length}</span>
              </div>
              <div className="text-xs bg-chain/15 px-3 py-1 rounded-full font-mono">
                {Math.round((classifiedCount / (rawTransactions.length || 1)) * 100)}%
              </div>
            </div>
          )}

          {/* Skeleton Loading State */}
          {appState === 'fetching' && (
            <div className="space-y-6 animate-pulse">
              {/* Wallet Intelligence Skeleton */}
              <div className="h-32 bg-slate-800/40 border border-slate-800 rounded-2xl p-6" />
              {/* Metrics Skeleton */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-24 bg-slate-800/40 border border-slate-800 rounded-xl" />
                ))}
              </div>
              {/* Timeline Skeleton */}
              <div className="h-64 bg-slate-800/40 border border-slate-800 rounded-2xl" />
            </div>
          )}

          {/* Dashboard & Timeline */}
          {appState !== 'fetching' && appState !== 'error' && (
            <div className="space-y-6">
              <WalletIntelligenceCard
                transactions={filteredTransactions}
                walletAddress={primaryWallet}
              />
              <TokenApprovalsPanel
                transactions={filteredTransactions}
                walletAddress={primaryWallet}
              />
              <TaxDashboard summary={summary} />
              <TransactionTimeline
                transactions={filteredTransactions}
                walletAddress={walletAddresses.join(', ')}
                isCapped={isCapped}
              />
            </div>
          )}
        </div>
      </section>

      {/* Website Sections */}
      <Features />
      <Architecture />
      <HowItWorks />
      <Security />
      <CTA />
      <Footer />

      {/* Phase 2 Contract Risk Scanner Modal */}
      <ContractRiskModal
        isOpen={showRiskModal}
        onClose={() => setShowRiskModal(false)}
      />

      {/* Security Simulation Modal */}
      {showSimModal && simResult && (
        <div className="modal-overlay" onClick={() => setShowSimModal(false)}>
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-7 space-y-5 shadow-2xl shadow-black/40" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[15px] flex items-center gap-2.5 text-foreground">
                🛡️ Pre-Sign Security Report
              </h3>
              <button onClick={() => setShowSimModal(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none p-1 rounded-lg hover:bg-secondary transition-colors">×</button>
            </div>

            <div className="space-y-4">
              <div className="inline-block text-[10px] font-bold uppercase tracking-[0.1em] px-3 py-1 rounded-md border border-signal-red/25 bg-signal-red/8 text-signal-red">
                {simResult.severity.toUpperCase()} RISK
              </div>
              <h4 className="font-semibold text-base text-foreground leading-snug">{simResult.headline}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{simResult.plainEnglishDescription}</p>

              <div className="grid grid-cols-2 gap-4 text-xs font-mono bg-secondary/40 p-4 rounded-xl border border-border">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider mb-1">Method</span>
                  <span className="text-foreground font-medium">{simResult.decodedMethod}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase tracking-wider mb-1">Est. Gas</span>
                  <span className="text-foreground font-medium">${simResult.estimatedGasUsd.toFixed(2)}</span>
                </div>
              </div>

              {simResult.riskWarnings.length > 0 && (
                <div className="space-y-1.5 bg-signal-amber/8 border border-signal-amber/15 p-4 rounded-xl text-xs text-signal-amber">
                  <div className="font-semibold mb-1">⚠️ Warnings</div>
                  {simResult.riskWarnings.map((w, i) => (
                    <div key={i} className="pl-5">{w}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-1 flex justify-end">
              <button
                onClick={() => setShowSimModal(false)}
                className="bg-secondary hover:bg-secondary/70 text-foreground text-[13px] font-semibold px-5 py-2.5 rounded-xl border border-border transition-all duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
