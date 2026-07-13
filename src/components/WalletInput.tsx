// src/components/WalletInput.tsx
import { useState } from 'react';
import { isValidEthAddressOrEns } from '../services/etherscan';

interface Props {
  onSubmit: (address: string) => void;
  isLoading: boolean;
  error?: string | null;
}

const DEMO_WALLETS = [
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'Uniswap LP wallet', address: '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' },
];

export default function WalletInput({ onSubmit, isLoading, error }: Props) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = (addr?: string) => {
    const address = addr ?? value.trim();
    if (!address) {
      setValidationError('Please enter a wallet address.');
      return;
    }

    if (!isValidEthAddressOrEns(address)) {
      setValidationError("That doesn't look like a valid address or ENS name");
      return;
    }

    setValidationError('');
    onSubmit(address);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const displayError = validationError || error;

  return (
    <div className="wallet-input-section">
      <div className="input-group">
        <input
          id="wallet-address-input"
          type="text"
          className={`wallet-address-input ${displayError ? 'input-error' : ''}`}
          placeholder="0x4a3f...e29b or vitalik.eth"
          value={value}
          onChange={e => { setValue(e.target.value); setValidationError(''); }}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          id="analyze-btn"
          className={`analyze-btn ${isLoading ? 'loading' : ''}`}
          onClick={() => handleSubmit()}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="btn-spinner" />
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
        <div className="input-error-msg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {displayError}
        </div>
      )}

      <div className="demo-wallets">
        <span className="demo-label">Try:</span>
        {DEMO_WALLETS.map((w, index) => (
          <span key={w.address} className="demo-link-wrapper">
            <button
              className="demo-link"
              onClick={() => { setValue(w.label); handleSubmit(w.address); }}
              disabled={isLoading}
            >
              {w.label}
            </button>
            {index < DEMO_WALLETS.length - 1 && <span className="demo-separator"> </span>}
          </span>
        ))}
      </div>
    </div>
  );
}
