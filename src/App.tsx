// src/App.tsx
import { useState, useCallback, useMemo } from 'react';
import WalletInput from './components/WalletInput';
import TaxDashboard, { computeSummary } from './components/TaxDashboard';
import TransactionTimeline from './components/TransactionTimeline';
import type { ChainId, ClassifiedTransaction, RawTransaction, B2BSimulationResult } from './types';
import { fetchMultiWalletTransactions, weiToEth, formatAddress } from './services/etherscan';
import { classifyAll } from './services/classifier';
import { connectWeb3Wallet } from './services/web3Wallet';
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
    from: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // Lido
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
    from: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', // BAYC
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

  const filteredTransactions = useMemo(() => {
    if (selectedChain === 'all') return transactions;
    return transactions.filter(tx => tx.chainId === selectedChain || !tx.chainId);
  }, [transactions, selectedChain]);

  const classifiedCount = transactions.filter(
    tx => tx.status === 'classified' || tx.status === 'error'
  ).length;

  // Compute FIFO tax report & cost basis lots
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

  const handleReset = useCallback(() => {
    setAppState('done');
    setWalletAddresses(['vitalik.eth']);
    setTransactions(INITIAL_MOCK_TRANSACTIONS);
    setRawTransactions([]);
    setError(null);
    setIsCapped(false);
  }, []);

  const handleAnalyze = useCallback(async (addresses: string[]) => {
    setError(null);
    setTransactions([]);
    setRawTransactions([]);
    setWalletAddresses(addresses);
    setIsCapped(false);
    setAppState('fetching');

    try {
      // 1. Fetch multi-chain transactions
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

      // 2. Pre-populate timeline with raw mode preview
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

      // 3. Classify transactions
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

  const handleNavConnectClick = async () => {
    try {
      const addr = await connectWeb3Wallet();
      setConnectedWallet(addr);
      handleAnalyze([addr]);
    } catch (err: any) {
      setError(err.message || 'Could not connect wallet');
    }
  };

  const handleTestB2BSimulate = () => {
    const result = simulateTransactionPayload({
      from: primaryWallet,
      to: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Uniswap Universal Router
      value: '1000000000000000000', // 1 ETH
      data: '0x3593564c000000000000000000000000',
    });
    setSimResult(result);
    setShowSimModal(true);
  };

  const isLoading = appState === 'fetching' || appState === 'classifying';

  return (
    <div className="app">
      {/* Top Navbar */}
      <header className="app-nav">
        <div className="nav-logo" onClick={handleReset} role="button" tabIndex={0}>
          <div className="nav-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="nav-brand">
            <span className="nav-logo-text">ChainStory</span>
            <span className="nav-tagline">Multi-Chain Plain-English Tax &amp; Pre-Sign Security</span>
          </div>
        </div>

        <div className="nav-actions">
          <button className="nav-connect-btn b2b-sim-btn" onClick={handleTestB2BSimulate} title="Test B2B Pre-Sign Simulation API">
            🛡️ B2B Security API
          </button>

          {connectedWallet ? (
            <div className="nav-connected-badge" title={connectedWallet}>
              <span className="badge-dot" />
              <span>{formatAddress(connectedWallet)}</span>
            </div>
          ) : (
            <button className="nav-connect-btn" onClick={handleNavConnectClick}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              Connect Wallet
            </button>
          )}

          <div className="nav-badge">
            <span>Read-only lookup</span>
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Multi-Chain Network Filter Bar */}
        <div className="chain-selector-bar">
          <span className="chain-selector-label">Multi-Chain Network:</span>
          <button
            className={`chain-chip ${selectedChain === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedChain('all')}
          >
            🌐 All Networks
          </button>
          {Object.values(CHAIN_CONFIGS).map((chain) => (
            <button
              key={chain.id}
              className={`chain-chip ${selectedChain === chain.id ? 'active' : ''}`}
              onClick={() => setSelectedChain(chain.id)}
            >
              <span>{chain.icon}</span> {chain.name}
            </button>
          ))}
        </div>

        {/* Wallet Address Input section */}
        <WalletInput
          onSubmit={handleAnalyze}
          isLoading={isLoading}
          error={null}
          connectedWallet={connectedWallet}
          onWalletConnectStateChange={setConnectedWallet}
        />

        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="error-message-text">{error}</span>
            <button className="error-close-btn" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Classification Progress Banner */}
        {appState === 'classifying' && (
          <div className="status-banner">
            <span className="status-pulse-dot" />
            <span>ONNX / AI classification engine running: {classifiedCount} of {rawTransactions.length} transactions processed</span>
          </div>
        )}

        {/* Fetching Progress Spinner */}
        {appState === 'fetching' && (
          <div className="fetching-state">
            <div className="fetching-spinner" />
            <p>Connecting to Multi-Chain EVM Indexer &amp; DefiLlama Oracle for {walletAddresses.join(', ')}…</p>
          </div>
        )}

        {/* Dashboard and Timeline */}
        {appState !== 'fetching' && appState !== 'error' && (
          <>
            {appState === 'done' && filteredTransactions.length === 0 ? (
              <div className="empty-wallet-state">
                <div className="empty-wallet-icon">📭</div>
                <h3 className="empty-wallet-title">No transactions found</h3>
                <p className="empty-wallet-desc">
                  No transaction history was found for the specified wallet address(es) on the selected network.
                </p>
              </div>
            ) : (
              <div className="analysis-view">
                {/* Summary Dashboard Header */}
                <TaxDashboard summary={summary} />

                {/* Main Scrollable Timeline */}
                <TransactionTimeline
                  transactions={filteredTransactions}
                  walletAddress={walletAddresses.join(', ')}
                  isCapped={isCapped}
                />
              </div>
            )}
          </>
        )}

        {/* B2B Simulation Result Modal */}
        {showSimModal && simResult && (
          <div className="modal-overlay" onClick={() => setShowSimModal(false)}>
            <div className="sim-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="sim-modal-header">
                <div className="sim-header-title">
                  <span className="sim-shield-icon">🛡️</span>
                  <h3>B2B Pre-Sign Transaction Narrative &amp; Security Warning</h3>
                </div>
                <button className="error-close-btn" onClick={() => setShowSimModal(false)}>×</button>
              </div>

              <div className="sim-modal-body">
                <div className={`sim-severity-badge severity-${simResult.severity}`}>
                  {simResult.severity.toUpperCase()} RISK LEVEL
                </div>

                <h4 className="sim-headline">{simResult.headline}</h4>
                <p className="sim-desc">{simResult.plainEnglishDescription}</p>

                <div className="sim-details-grid">
                  <div className="sim-detail-item">
                    <span className="sim-label">Decoded ABI Method</span>
                    <span className="sim-val code-font">{simResult.decodedMethod}</span>
                  </div>
                  <div className="sim-detail-item">
                    <span className="sim-label">Estimated Gas Fee</span>
                    <span className="sim-val">${simResult.estimatedGasUsd.toFixed(2)} USD</span>
                  </div>
                  {simResult.simulatedOutput.targetProtocol && (
                    <div className="sim-detail-item">
                      <span className="sim-label">Target Protocol</span>
                      <span className="sim-val">{simResult.simulatedOutput.targetProtocol}</span>
                    </div>
                  )}
                </div>

                {simResult.riskWarnings.length > 0 && (
                  <div className="sim-warnings-box">
                    <h5>Security Warnings:</h5>
                    <ul>
                      {simResult.riskWarnings.map((w, idx) => (
                        <li key={idx}>⚠️ {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="sim-modal-footer">
                <button className="sim-close-action" onClick={() => setShowSimModal(false)}>
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          ChainStory · Multi-Chain Plain-English Tax &amp; Security Engine · Powered by DefiLlama Oracle, ONNX ML &amp; Gemini 1.5
        </p>
        <p className="footer-disclaimer">
          Not financial or tax advice. IRS Form 8949 / 1099-DA FIFO cost-basis calculations should be reviewed by a certified crypto CPA.
        </p>
      </footer>
    </div>
  );
}
