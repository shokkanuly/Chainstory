// src/components/Hero.tsx — Blockchair Multi-Chain Search Hero
import { motion } from 'framer-motion';
import { Shield, Zap, Search, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onAnalyze?: (addresses: string[]) => void;
}

export default function Hero({ onAnalyze }: Props) {
  return (
    <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden bg-background pt-20 pb-12">
      {/* Background layers */}
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute inset-0 bg-radial-glow" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-chain/10 blur-[100px] animate-float" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full bg-chain/5 blur-[120px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center space-y-8">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="inline-flex items-center gap-2 rounded-full border border-chain/30 bg-chain/10 px-4 py-1.5"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chain opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-chain" />
          </span>
          <span className="text-xs font-semibold text-chain">Blockchair Multi-Chain Explorer &amp; Tax Engine</span>
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]"
        >
          Search Every EVM Transaction
          <br />
          <span className="text-gradient-chain">In Plain English</span>
        </motion.h1>

        {/* Subheading */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
        >
          Blockchair-grade multi-chain indexing for Ethereum, Arbitrum, Base, OP, and Polygon.
          Calculate IRS Form 8949 FIFO tax reports &amp; simulate pre-sign security warnings locally.
        </motion.p>

        {/* Action CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2"
        >
          <a
            href="#app-workspace"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-chain hover:bg-chain-dim text-primary-foreground font-semibold px-8 py-3.5 rounded-xl glow-chain-strong transition-all text-sm"
          >
            Launch Search Engine
            <ArrowRight className="h-4 w-4" />
          </a>
          <button
            onClick={() => onAnalyze?.(['vitalik.eth'])}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-border bg-card/60 hover:bg-card text-foreground font-semibold px-8 py-3.5 rounded-xl transition-all text-sm"
          >
            Try Demo (vitalik.eth)
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </motion.div>

        {/* Feature badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="pt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto"
        >
          {[
            { icon: Shield, title: 'Client-Side Privacy', desc: 'Zero server storage' },
            { icon: Zap, title: '1ms Classification', desc: 'In-browser XGBoost ML' },
            { icon: Search, title: 'Form 8949 Tax Engine', desc: 'FIFO cost basis calculation' },
          ].map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-card/40 border border-border/60 p-3.5 rounded-xl text-left">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chain/10 border border-chain/20 text-chain">
                <item.icon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">{item.title}</div>
                <div className="text-[11px] text-muted-foreground">{item.desc}</div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
