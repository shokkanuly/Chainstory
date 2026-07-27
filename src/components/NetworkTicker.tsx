// src/components/NetworkTicker.tsx
import { motion } from 'framer-motion';

export interface ChainStat {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  tps: string;
  gasGwei: string;
  status: 'online' | 'busy';
  badgeColor: string;
}

const CHAIN_STATS: ChainStat[] = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', icon: '🔷', tps: '14.2 tps', gasGwei: '18 Gwei', status: 'online', badgeColor: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', icon: '🔵', tps: '38.5 tps', gasGwei: '0.1 Gwei', status: 'online', badgeColor: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
  { id: 'base', name: 'Base Network', symbol: 'BASE', icon: '🔵', tps: '42.1 tps', gasGwei: '0.05 Gwei', status: 'online', badgeColor: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10' },
  { id: 'optimism', name: 'OP Mainnet', symbol: 'OP', icon: '🔴', tps: '29.8 tps', gasGwei: '0.08 Gwei', status: 'online', badgeColor: 'text-red-400 border-red-500/30 bg-red-500/10' },
  { id: 'polygon', name: 'Polygon POS', symbol: 'MATIC', icon: '💜', tps: '54.0 tps', gasGwei: '32 Gwei', status: 'online', badgeColor: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
];

interface Props {
  selectedChain: string;
  onSelectChain: (id: string) => void;
}

export default function NetworkTicker({ selectedChain, onSelectChain }: Props) {
  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Blockchair Multi-Chain Network Indexer
        </div>
        <span className="text-xs text-muted-foreground">5 EVM Networks Indexed</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CHAIN_STATS.map((chain) => {
          const isSelected = selectedChain === chain.id || selectedChain === 'all';
          return (
            <motion.div
              key={chain.id}
              whileHover={{ y: -2 }}
              onClick={() => onSelectChain(chain.id)}
              className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                isSelected
                  ? 'border-chain bg-card shadow-lg shadow-chain/10'
                  : 'border-border/60 bg-card/40 opacity-70 hover:opacity-100 hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-base">{chain.icon}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${chain.badgeColor}`}>
                  {chain.symbol}
                </span>
              </div>

              <div className="font-semibold text-sm text-foreground tracking-tight leading-tight">
                {chain.name}
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>{chain.tps}</span>
                <span className="text-chain">{chain.gasGwei}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
