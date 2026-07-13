// src/App.tsx
import { useState, useCallback } from 'react';
import WalletInput from './components/WalletInput';
import TaxDashboard, { computeSummary } from './components/TaxDashboard';
import TransactionTimeline from './components/TransactionTimeline';
import type { ClassifiedTransaction, RawTransaction } from './types';
import { fetchNormalTransactions, fetchTokenTransfers, resolveENS, isValidEthAddress } from './services/etherscan';
import { classifyAll } from './services/classifier';
import './App.css';

type AppState = 'idle' | 'fetching' | 'classifying' | 'done' | 'error';

const MOCK_TRANSACTIONS: ClassifiedTransaction[] = [
  {
    hash: '0xmockhash1',
    blockNumber: '12345678',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
    description: 'Swapped 2 ETH for 3,400 USDC',
    category: 'trade',
    confidence: 1.0,
    usdValue: 3400,
    ethValue: 2.0,
    status: 'classified',
    value: '2000000000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1772539200',
    date: new Date('2026-03-03T12:00:00Z'),
  },
  {
    hash: '0xmockhash2',
    blockNumber: '12345678',
    from: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // Lido
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    description: 'Received staking reward from Lido',
    category: 'income',
    confidence: 1.0,
    usdValue: 48,
    ethValue: 0.015,
    status: 'classified',
    value: '1500000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1772111400',
    date: new Date('2026-02-26T14:30:00Z'),
  },
  {
    hash: '0xmockhash3',
    blockNumber: '12345678',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
    description: 'Moved 1.5 ETH to your other wallet',
    category: 'transfer',
    confidence: 1.0,
    usdValue: 0,
    ethValue: 1.5,
    status: 'classified',
    value: '1500000000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1770196500',
    date: new Date('2026-02-04T09:15:00Z'),
  },
  {
    hash: '0xmockhash4',
    blockNumber: '12345678',
    from: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', // Bored Ape Yacht Club
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    description: 'Sold a Bored Ape NFT for 4.2 ETH',
    category: 'nft',
    confidence: 1.0,
    usdValue: 8190,
    ethValue: 4.2,
    status: 'classified',
    value: '4200000000000000000',
    gas: '21000',
    gasUsed: '21000',
    gasPrice: '20000000000',
    input: '0x',
    isError: '0',
    txreceipt_status: '1',
    timeStamp: '1769712300',
    date: new Date('2026-01-29T18:45:00Z'),
  },
];

export default function App() {
  const [appState, setAppState] = useState<AppState>('idle');
  const [walletAddress, setWalletAddress] = useState('');
  const [transactions, setTransactions] = useState<ClassifiedTransaction[]>(MOCK_TRANSACTIONS);
  const [rawTransactions, setRawTransactions] = useState<RawTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCapped, setIsCapped] = useState(false);

  const classifiedCount = transactions.filter(
    tx => tx.status === 'classified' || tx.status === 'error'
  ).length;

  const summary = computeSummary(transactions);

  const handleReset = useCallback(() => {
    setAppState('idle');
    setWalletAddress('');
    setTransactions(MOCK_TRANSACTIONS);
    setRawTransactions([]);
    setError(null);
    setIsCapped(false);
  }, []);

  const handleAnalyze = useCallback(async (address: string) => {
    setError(null);
    setTransactions([]);
    setRawTransactions([]);
    setWalletAddress(address);
    setIsCapped(false);
    setAppState('fetching');

    try {
      let targetAddress = address;

      // 1. Resolve ENS if it's not a hex address
      if (!isValidEthAddress(address)) {
        const resolved = await resolveENS(address);
        if (!resolved) {
          setError("Couldn't resolve that ENS name");
          setAppState('error');
          return;
        }
        targetAddress = resolved;
      }

      // 2. Fetch transactions from Etherscan
      const [normalTxs, tokenTxs] = await Promise.all([
        fetchNormalTransactions(targetAddress),
        fetchTokenTransfers(targetAddress).catch(() => [] as RawTransaction[]),
      ]);

      // Merge and deduplicate by hash, normal txs take priority
      const txMap = new Map<string, RawTransaction>();
      for (const tx of normalTxs) txMap.set(tx.hash, tx);
      // For token transfers with new hashes, add them
      for (const tx of tokenTxs) {
        if (!txMap.has(tx.hash)) txMap.set(tx.hash, tx);
      }

      const totalCount = txMap.size;
      const allTxs = Array.from(txMap.values())
        .sort((a, b) => parseInt(b.timeStamp) - parseInt(a.timeStamp))
        .slice(0, 100); // Cap at 100 transactions

      setIsCapped(totalCount > 100);

      // Handle empty wallet state
      if (allTxs.length === 0) {
        setAppState('done');
        setTransactions([]);
        setRawTransactions([]);
        return;
      }

      setRawTransactions(allTxs);
      setAppState('classifying');

      // 3. Pre-populate with pending states
      const pendingTxs: ClassifiedTransaction[] = allTxs.map(tx => ({
        ...tx,
        description: 'Classifying…',
        category: 'unknown',
        confidence: 0,
        usdValue: null,
        ethValue: parseFloat(tx.value) / 1e18,
        status: 'pending',
        date: new Date(parseInt(tx.timeStamp) * 1000),
      }));
      setTransactions(pendingTxs);

      // 4. Classify all
      await classifyAll(allTxs, targetAddress, (classified) => {
        setTransactions(prev =>
          prev.map(tx => tx.hash === classified.hash ? classified : tx)
        );
      });

      setAppState('done');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
      setAppState('error');
    }
  }, []);

  const isLoading = appState === 'fetching' || appState === 'classifying';

  return (
    <div className="app">
      {/* Slim Header */}
      <header className="app-nav">
        <div className="nav-logo" onClick={handleReset} role="button" tabIndex={0}>
          {/* Flat chart logo */}
          <svg className="nav-logo-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span className="nav-logo-text">ChainStory</span>
        </div>
        <div className="nav-badge-text">
          Read-only · no wallet connection needed
        </div>
      </header>

      <main className="app-main">
        {/* Wallet Address Input section (Always on top) */}
        <WalletInput
          onSubmit={handleAnalyze}
          isLoading={isLoading}
          error={null} // Validation errors are shown inline inside WalletInput
        />

        {/* Dismissible top-level critical error banner */}
        {error && (
          <div className="error-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="error-message-text">{error}</span>
            <button className="error-close-btn" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Classifying status banner if active */}
        {appState === 'classifying' && (
          <div className="status-banner">
            <span className="status-pulse-dot" />
            <span>AI classifying {classifiedCount} of {rawTransactions.length} transactions...</span>
          </div>
        )}

        {appState === 'fetching' && (
          <div className="fetching-state">
            <div className="fetching-spinner" />
            <p>Fetching transaction history for {walletAddress}…</p>
          </div>
        )}

        {/* Prevent rendering broken/partial layouts during loading or error states */}
        {appState !== 'fetching' && appState !== 'error' && (
          <>
            {appState === 'done' && transactions.length === 0 ? (
              /* Friendly Empty State Panel */
              <div className="empty-wallet-state">
                <div className="empty-wallet-icon">📭</div>
                <h3 className="empty-wallet-title">No transactions found for this address</h3>
                <p className="empty-wallet-desc">This wallet has no transaction history on Ethereum Mainnet.</p>
              </div>
            ) : (
              <div className="analysis-view">
                {/* Dashboard metrics (4 across) */}
                <TaxDashboard summary={summary} />

                {/* Timeline header and list */}
                <TransactionTimeline
                  transactions={transactions}
                  walletAddress={walletAddress || 'demo-wallet'}
                  isCapped={isCapped}
                />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          ChainStory · Data from Etherscan &amp; CoinGecko · AI by Google Gemini
        </p>
        <p className="footer-disclaimer">
          Not financial or tax advice. Verify all classifications with a qualified accountant.
        </p>
      </footer>
    </div>
  );
}
