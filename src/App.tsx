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
  const [simResult, setSimResult] = useState<B2BSimulationResult | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSimModal) {
        setShowSimModal(false);
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
      <section id="app-workspace" className="relative py-12 border-t border-border bg-card/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
          {/* Blockchair Multi-Chain Network Stats Grid */}
          <NetworkTicker
            selectedChain={selectedChain}
            onSelectChain={(id) => setSelectedChain(id as ChainId)}
          />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6 pt-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Multi-Chain <span className="text-gradient-chain">Block Explorer &amp; Tax Engine</span>
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                Enter EVM addresses or ENS domains to run local classification &amp; Form 8949 cost basis lot reports.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleTestB2BSimulate}
                className="inline-flex items-center gap-2 rounded-lg border border-signal-red/30 bg-signal-red/10 px-3.5 py-2 text-xs font-semibold text-signal-red hover:bg-signal-red/20 transition-colors"
              >
                🛡️ Test B2B Pre-Sign API
              </button>
            </div>
          </div>

          {/* Network Selector Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
              Select Chain:
            </span>
            <button
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                selectedChain === 'all'
                  ? 'border-chain bg-chain text-primary-foreground glow-chain'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setSelectedChain('all')}
            >
              🌐 All Networks
            </button>
            {Object.values(CHAIN_CONFIGS).map((chain) => (
              <button
                key={chain.id}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                  selectedChain === chain.id
                    ? 'border-chain bg-chain text-primary-foreground glow-chain'
                    : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSelectedChain(chain.id)}
              >
                <span>{chain.icon}</span> {chain.name}
              </button>
            ))}
          </div>

          {/* Wallet Address Input Component */}
          <WalletInput
            onSubmit={handleAnalyze}
            isLoading={isLoading}
            error={null}
            connectedWallet={connectedWallet}
            onWalletConnectStateChange={setConnectedWallet}
          />

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-signal-red/40 bg-signal-red/10 p-4 text-signal-red text-sm flex items-center justify-between">
              <span>⚠️ {error}</span>
              <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground font-bold">×</button>
            </div>
          )}

          {/* Progress Banner */}
          {appState === 'classifying' && (
            <div className="rounded-lg border border-chain/30 bg-chain/10 p-4 text-chain text-sm flex items-center gap-3 font-medium glow-chain">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-chain opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-chain" />
              </span>
              <span>Running ONNX Classifier &amp; AI: {classifiedCount} of {rawTransactions.length} transactions processed</span>
            </div>
          )}

          {appState === 'fetching' && (
            <div className="py-12 text-center text-muted-foreground space-y-3">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-chain border-t-transparent" />
              <p className="text-sm">Connecting to Multi-Chain Indexer &amp; DefiLlama Oracle...</p>
            </div>
          )}

          {/* Analysis Dashboard & Explorer Timeline */}
          {appState !== 'fetching' && appState !== 'error' && (
            <div className="space-y-8">
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

      {/* Security Simulation Modal */}
      {showSimModal && simResult && (
        <div className="modal-overlay" onClick={() => setShowSimModal(false)}>
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold flex items-center gap-2 text-foreground">
                🛡️ B2B Pre-Sign Security Narrative
              </h3>
              <button onClick={() => setShowSimModal(false)} className="text-muted-foreground hover:text-foreground font-bold">×</button>
            </div>

            <div className="space-y-3">
              <div className="inline-block text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border border-signal-red/30 bg-signal-red/10 text-signal-red">
                {simResult.severity.toUpperCase()} RISK DETECTED
              </div>
              <h4 className="font-semibold text-base text-foreground">{simResult.headline}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{simResult.plainEnglishDescription}</p>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-secondary/50 p-3 rounded-lg border border-border">
                <div>
                  <span className="text-muted-foreground block text-[10px]">Method</span>
                  <span className="text-foreground">{simResult.decodedMethod}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">Est. Gas</span>
                  <span className="text-foreground">${simResult.estimatedGasUsd.toFixed(2)}</span>
                </div>
              </div>

              {simResult.riskWarnings.length > 0 && (
                <div className="space-y-1 bg-signal-amber/10 border border-signal-amber/20 p-3 rounded-lg text-xs text-signal-amber">
                  <div className="font-semibold mb-1">Warnings:</div>
                  {simResult.riskWarnings.map((w, i) => (
                    <div key={i}>⚠️ {w}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setShowSimModal(false)}
                className="bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold px-4 py-2 rounded-lg border border-border transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
