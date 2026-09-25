// src/services/web3Wallet.ts

declare global {
  interface Window {
    ethereum?: any;
  }
}

export interface Web3WalletState {
  isConnected: boolean;
  address: string | null;
  error: string | null;
}

export function isWeb3WalletAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

export async function connectWeb3Wallet(): Promise<string> {
  if (!isWeb3WalletAvailable()) {
    throw new Error('No Web3 wallet extension found (e.g. MetaMask, Rabby, Coinbase Wallet). Please install an EVM extension or paste your address manually.');
  }

  try {
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts selected in your wallet.');
    }

    return accounts[0];
  } catch (err: any) {
    if (err.code === 4001) {
      throw new Error('Wallet connection request was rejected.');
    }
    throw new Error(err.message || 'Failed to connect wallet.');
  }
}

export async function getCurrentConnectedAccount(): Promise<string | null> {
  if (!isWeb3WalletAvailable()) return null;
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts && accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

export function setupWalletAccountListener(onAccountChange: (account: string | null) => void): () => void {
  if (!isWeb3WalletAvailable() || !window.ethereum.on) {
    return () => {};
  }

  const handler = (accounts: string[]) => {
    if (accounts && accounts.length > 0) {
      onAccountChange(accounts[0]);
    } else {
      onAccountChange(null);
    }
  };

  window.ethereum.on('accountsChanged', handler);
  return () => {
    if (window.ethereum.removeListener) {
      window.ethereum.removeListener('accountsChanged', handler);
    }
  };
}
