// src/components/WalletInput.tsx — Premium Blockchair-style Search Input
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
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', icon: '👤' },
  { label: 'Uniswap LP', address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC', icon: '🦄' },
];

export default function WalletInput({ onSubmit, isLoading, error }: Props) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState('');
  const [isFocused, setIsFocused] = useState(false);

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
    <div className={`relative rounded-2xl border p-1.5 transition-all duration-300 ${
      isFocused
        ? 'border-chain/40 shadow-[0_0_0_4px_rgba(59,130,246,0.08)] bg-card'
        : displayError
          ? 'border-signal-red/40 bg-card/60'
          : 'border-border/80 bg-card/60'
    }`}>
      <div className="flex items-center gap-2">
        {/* Search icon */}
        <div className="pl-4 flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-colors ${isFocused ? 'text-chain' : 'text-muted-foreground'}`}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Input */}
        <input
          id="wallet-address-input"
          type="text"
          className="flex-1 bg-transparent border-none text-foreground placeholder:text-muted-foreground px-2 py-3.5 font-mono text-sm outline-none"
          placeholder="Enter wallet address or ENS name (e.g. vitalik.eth)"
          value={value}
          onChange={e => { setValue(e.target.value); setValidationError(''); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Analyze button */}
        <button
          id="analyze-btn"
          className={`flex items-center justify-center gap-2 bg-chain hover:bg-chain-dim text-primary-foreground font-semibold px-6 py-3 rounded-xl transition-all duration-200 shrink-0 text-sm ${
            isLoading ? 'opacity-70 cursor-not-allowed' : 'glow-chain hover:glow-chain-strong'
          }`}
          onClick={() => handleSubmit()}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              <span>Analyzing…</span>
            </>
          ) : (
            <>
              <ArrowIcon />
              <span>Analyze</span>
            </>
          )}
        </button>
      </div>

      {/* Error message */}
      {displayError && (
        <div className="px-5 pb-3 pt-1 text-xs text-signal-red flex items-center gap-1.5 font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {displayError}
        </div>
      )}

      {/* Demo wallet presets */}
      <div className="px-5 pb-3 pt-1 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-muted-foreground">Try:</span>
        {DEMO_WALLETS.map((w) => (
          <button
            key={w.address}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary text-[12px] text-muted-foreground hover:text-chain border border-transparent hover:border-chain/20 transition-all duration-150 font-medium"
            onClick={() => { setValue(w.label); handleSubmit(w.address); }}
            disabled={isLoading}
          >
            <span>{w.icon}</span>
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
