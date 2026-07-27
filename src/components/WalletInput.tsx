// src/components/WalletInput.tsx
import { useState, useMemo, useEffect } from 'react';
import { parseMultipleAddresses, isValidEthAddressOrEns, formatAddress } from '../services/etherscan';
import {
  connectWeb3Wallet,
  getCurrentConnectedAccount,
  setupWalletAccountListener
} from '../services/web3Wallet';

interface Props {
  onSubmit: (addresses: string[]) => void;
  isLoading: boolean;
  error?: string | null;
  connectedWallet?: string | null;
  onWalletConnectStateChange?: (address: string | null) => void;
}

const DEMO_PRESETS = [
  {
    label: 'vitalik.eth',
    description: 'Ethereum Co-Founder wallet',
    addresses: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'],
  },
  {
    label: 'Multi-Wallet (2 Wallets)',
    description: 'DeFi + Staking Portfolio',
    addresses: [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
    ],
  },
  {
    label: 'Uniswap Power User',
    description: 'Frequent trader & LP',
    addresses: ['0x1a9C8182C09F50C8318d769245beA52c32BE35BC'],
  },
];

export default function WalletInput({
  onSubmit,
  isLoading,
  error,
  connectedWallet: externalConnectedWallet,
  onWalletConnectStateChange,
}: Props) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState('');
  const [connectedWallet, setConnectedWallet] = useState<string | null>(externalConnectedWallet || null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  // Check if wallet is already connected on mount
  useEffect(() => {
    getCurrentConnectedAccount().then(acc => {
      if (acc) {
        setConnectedWallet(acc);
        if (onWalletConnectStateChange) onWalletConnectStateChange(acc);
      }
    });

    const cleanup = setupWalletAccountListener(acc => {
      setConnectedWallet(acc);
      if (onWalletConnectStateChange) onWalletConnectStateChange(acc);
      if (acc) {
        setValue(acc);
        onSubmit([acc]);
      }
    });

    return cleanup;
  }, [onSubmit, onWalletConnectStateChange]);

  const parsedAddresses = useMemo(() => parseMultipleAddresses(value), [value]);

  const handleConnectWalletClick = async () => {
    setValidationError('');
    setIsConnectingWallet(true);

    try {
      const address = await connectWeb3Wallet();
      setConnectedWallet(address);
      setValue(address);
      if (onWalletConnectStateChange) onWalletConnectStateChange(address);
      onSubmit([address]);
    } catch (err: any) {
      setValidationError(err.message || 'Failed to connect wallet.');
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleDisconnectWallet = () => {
    setConnectedWallet(null);
    if (onWalletConnectStateChange) onWalletConnectStateChange(null);
  };

  const handleSubmit = (overrideAddresses?: string[]) => {
    const targets = overrideAddresses ?? parsedAddresses;

    if (targets.length === 0) {
      setValidationError('Please enter at least one public wallet address or ENS domain.');
      return;
    }

    const invalid = targets.find(addr => !isValidEthAddressOrEns(addr));
    if (invalid) {
      setValidationError(`"${invalid}" is not a valid EVM address (0x...) or ENS domain (.eth)`);
      return;
    }

    setValidationError('');
    onSubmit(targets);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClearInput = () => {
    setValue('');
    setValidationError('');
  };

  const displayError = validationError || error;

  return (
    <div className="wallet-input-section">
      <div className="wallet-input-card">
        <div className="wallet-input-header">
          <div className="wallet-header-top-row">
            <label htmlFor="wallet-address-input" className="input-title-label">
              Public Wallet Address(es)
            </label>

            {/* Connect Wallet Action Button / Badge */}
            {connectedWallet ? (
              <div className="connected-wallet-badge">
                <span className="connected-dot" />
                <span className="connected-addr-text" title={connectedWallet}>
                  Connected: {formatAddress(connectedWallet)}
                </span>
                <button
                  className="disconnect-btn"
                  onClick={handleDisconnectWallet}
                  title="Disconnect wallet"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                className="connect-wallet-btn"
                onClick={handleConnectWalletClick}
                disabled={isLoading || isConnectingWallet}
                title="Connect browser Web3 wallet (MetaMask, Rabby, Coinbase Wallet)"
              >
                {isConnectingWallet ? (
                  <>
                    <span className="btn-spinner" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                    Connect Wallet
                  </>
                )}
              </button>
            )}
          </div>

          <span className="input-subtitle">
            Paste one or multiple EVM addresses (separated by commas/newlines) or connect your browser wallet
          </span>
        </div>

        <div className="input-group-wrapper">
          <div className="wallet-input-box-relative">
            <textarea
              id="wallet-address-input"
              className={`wallet-address-input ${displayError ? 'input-error' : ''}`}
              placeholder="e.g. 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045, vitalik.eth"
              value={value}
              onChange={e => {
                setValue(e.target.value);
                setValidationError('');
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={parsedAddresses.length > 1 ? 3 : 1}
              spellCheck={false}
            />
            {value.trim().length > 0 && (
              <button
                className="input-clear-btn"
                onClick={handleClearInput}
                title="Clear input"
              >
                ×
              </button>
            )}
          </div>

          <button
            id="analyze-btn"
            className={`analyze-btn ${isLoading ? 'loading' : ''}`}
            onClick={() => handleSubmit()}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="btn-spinner" />
                Fetching Data…
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Fetch Pipeline
              </>
            )}
          </button>
        </div>

        {/* Address Badges Count */}
        {parsedAddresses.length > 0 && !displayError && (
          <div className="parsed-badges-row">
            <span className="parsed-count-badge">
              {parsedAddresses.length} wallet address{parsedAddresses.length > 1 ? 'es' : ''} detected
            </span>
            {parsedAddresses.map((addr, idx) => (
              <span key={idx} className="address-chip">
                {addr}
              </span>
            ))}
          </div>
        )}

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

        {/* Demo Wallet Quick Select Presets */}
        <div className="demo-wallets">
          <span className="demo-label">Demo Presets:</span>
          {DEMO_PRESETS.map(preset => (
            <button
              key={preset.label}
              className="demo-link-chip"
              onClick={() => {
                setValue(preset.addresses.join(', '));
                handleSubmit(preset.addresses);
              }}
              disabled={isLoading}
              title={preset.description}
            >
              <span className="preset-title">{preset.label}</span>
              <span className="preset-count">({preset.addresses.length})</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
