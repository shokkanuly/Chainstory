// src/components/WalletInput.tsx
import { useState } from 'react';
import { isValidEthAddressOrEns } from '../services/etherscan';

interface Props {
  onSubmit: (addresses: string[]) => void;
  isLoading: boolean;
  error?: string | null;
  connectedWallet?: string | null;
  onWalletConnectStateChange?: (address: string | null) => void;
}

const DEMO_WALLETS = [
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'Uniswap LP wallet', address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' },
];

export default function WalletInput({ onSubmit, isLoading, error }: Props) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = (addr?: string) => {
    const raw = addr ?? value.trim();
    if (!raw) {
      setValidationError('Please enter a wallet address.');
      return;
    }

    const addresses = raw.split(/[\s,]+/).filter(Boolean);
    const invalid = addresses.find(a => !isValidEthAddressOrEns(a));
    if (invalid) {
      setValidationError(`"${invalid}" doesn't look like a valid address or ENS name`);
      return;
    }

    setValidationError('');
    onSubmit(addresses);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const displayError = validationError || error;

  return (
    <div className="wallet-input-section bg-card/60 border border-border/80 rounded-xl p-5 shadow-lg backdrop-blur-md">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            id="wallet-address-input"
            type="text"
            className={`w-full bg-secondary/80 border text-foreground placeholder:text-muted-foreground px-4 py-3 rounded-lg font-mono text-sm outline-none transition-all ${
              displayError ? 'border-signal-red ring-1 ring-signal-red/50' : 'border-border focus:border-chain focus:ring-1 focus:ring-chain/50'
            }`}
            placeholder="0x4a3f...e29b or vitalik.eth"
            value={value}
            onChange={e => { setValue(e.target.value); setValidationError(''); }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <button
          id="analyze-btn"
          className={`bg-chain hover:bg-chain-dim text-primary-foreground font-semibold px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-all glow-chain shrink-0 ${
            isLoading ? 'opacity-70 cursor-not-allowed' : ''
          }`}
          onClick={() => handleSubmit()}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              Analyzing…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Analyze
            </>
          )}
        </button>
      </div>

      {displayError && (
        <div className="mt-3 text-xs text-signal-red flex items-center gap-1.5 font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {displayError}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span className="font-medium">Try Presets:</span>
        {DEMO_WALLETS.map((w) => (
          <button
            key={w.address}
            className="px-2.5 py-1 rounded-md bg-secondary/60 hover:bg-secondary hover:text-chain border border-border/50 transition-colors"
            onClick={() => { setValue(w.label); handleSubmit(w.address); }}
            disabled={isLoading}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
