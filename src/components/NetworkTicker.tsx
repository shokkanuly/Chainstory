// src/components/NetworkTicker.tsx — Premium Multi-Chain Network Stats
import { motion } from 'framer-motion';

export interface ChainStat {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  tps: string;
  gasGwei: string;
  status: 'online' | 'busy';
  color: string;
}

const CHAIN_STATS: ChainStat[] = [
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', icon: '◆', tps: '14.2', gasGwei: '18', status: 'online', color: '#627eea' },
  { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', icon: '◈', tps: '38.5', gasGwei: '0.1', status: 'online', color: '#28a0f0' },
  { id: 'base', name: 'Base', symbol: 'BASE', icon: '●', tps: '42.1', gasGwei: '0.05', status: 'online', color: '#0052ff' },
  { id: 'optimism', name: 'OP Mainnet', symbol: 'OP', icon: '◉', tps: '29.8', gasGwei: '0.08', status: 'online', color: '#ff0420' },
  { id: 'polygon', name: 'Polygon', symbol: 'POL', icon: '⬡', tps: '54.0', gasGwei: '32', status: 'online', color: '#8247e5' },
];

interface Props {
  selectedChain: string;
  onSelectChain: (id: string) => void;
}

export default function NetworkTicker({ selectedChain, onSelectChain }: Props) {
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Network Status
        </div>
        <span className="text-[11px] text-muted-foreground font-medium">5 EVM chains indexed</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {CHAIN_STATS.map((chain) => {
          const isSelected = selectedChain === chain.id || selectedChain === 'all';
          return (
            <motion.button
              key={chain.id}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectChain(chain.id)}
              className={`text-left rounded-xl border p-4 transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'border-chain/30 bg-card shadow-lg shadow-black/20'
                  : 'border-border/50 bg-card/30 opacity-60 hover:opacity-100 hover:border-border'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-lg" style={{ color: chain.color }}>{chain.icon}</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                  style={{
                    color: chain.color,
                    borderColor: `${chain.color}30`,
                    backgroundColor: `${chain.color}10`,
                  }}
                >
                  {chain.symbol}
                </span>
              </div>

              <div className="font-semibold text-[13px] text-foreground tracking-tight leading-tight mb-2.5">
                {chain.name}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                <span>{chain.tps} tps</span>
                <span style={{ color: chain.color }}>{chain.gasGwei} Gwei</span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
