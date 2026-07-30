// src/components/WatchlistModal.tsx
import { useState } from 'react';
import { getWatchlist, addWatchlistItem, removeWatchlistItem, type WatchlistItem } from '../services/watchlistStore';
import type { ChainId } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectWallet: (address: string, chainId: ChainId) => void;
}

export default function WatchlistModal({ isOpen, onClose, onSelectWallet }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>(() => getWatchlist());
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [selectedChain, setSelectedChain] = useState<ChainId>('ethereum');

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    const updated = addWatchlistItem({
      address: newAddress.trim(),
      label: newLabel.trim() || newAddress.trim(),
      chainId: selectedChain,
    });

    setItems(updated);
    setNewAddress('');
    setNewLabel('');
  };

  const handleRemove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = removeWatchlistItem(id);
    setItems(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐</span>
            <h2 className="text-lg font-bold text-white">Wallet Watchlist</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          
          {/* Add Wallet Form */}
          <form onSubmit={handleAdd} className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/50 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">Add Wallet to Watchlist</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Wallet Address (0x...) or ENS"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-white"
                required
              />
              <input
                type="text"
                placeholder="Label / Name (e.g. My Treasury)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-white"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <select
                value={selectedChain}
                onChange={(e) => setSelectedChain(e.target.value as ChainId)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="ethereum">⟠ Ethereum Mainnet</option>
                <option value="arbitrum">🔵 Arbitrum One</option>
                <option value="base">🔷 Base L2</option>
                <option value="optimism">🔴 Optimism Mainnet</option>
                <option value="polygon">💜 Polygon PoS</option>
              </select>

              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition"
              >
                + Add Wallet
              </button>
            </div>
          </form>

          {/* List of Saved Wallets */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Saved Wallets ({items.length})</h3>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No saved wallets in your watchlist.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectWallet(item.address, item.chainId);
                      onClose();
                    }}
                    className="group flex items-center justify-between p-3.5 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/40 hover:border-indigo-500/50 rounded-xl cursor-pointer transition"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">{item.label}</span>
                        {item.tags?.map((t) => (
                          <span key={t} className="text-[10px] bg-slate-700 text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs font-mono text-slate-400">{item.address}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-1 rounded-lg capitalize font-medium">
                        {item.chainId}
                      </span>
                      <button
                        onClick={(e) => handleRemove(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700/50 transition"
                        title="Remove from watchlist"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-900 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
