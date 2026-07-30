// src/components/Hero.tsx — Premium Blockchair-Inspired Hero
import { motion } from 'framer-motion';
import { ArrowRight, ExternalLink, Shield, Zap, Search } from 'lucide-react';

interface Props {
  onAnalyze?: (addresses: string[]) => void;
}

export default function Hero({ onAnalyze }: Props) {
  return (
    <section className="relative min-h-[88vh] flex items-center justify-center overflow-hidden bg-background pt-20 pb-16">
      {/* Background layers */}
      <div className="absolute inset-0 bg-grid opacity-20" />
      <div className="absolute inset-0 bg-radial-glow" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-[20%] w-80 h-80 rounded-full bg-chain/8 blur-[120px] animate-float" />
      <div className="absolute bottom-1/4 right-[20%] w-96 h-96 rounded-full bg-purple-500/5 blur-[140px] animate-float" style={{ animationDelay: '-4s' }} />

      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center space-y-10">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="inline-flex items-center gap-2.5 rounded-full border border-chain/20 bg-chain/5 px-4 py-1.5 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chain opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-chain" />
            </span>
            <span className="text-xs font-semibold text-chain tracking-wide">Wallet Intelligence &amp; AI Story Engine</span>
          </div>
        </motion.div>

        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="space-y-5"
        >
          <h1 className="text-5xl sm:text-6xl lg:text-[72px] font-extrabold tracking-[-0.04em] leading-[1.05]">
            Understand Any Wallet's Story,
            <br />
            <span className="text-gradient-chain">Draft Taxes &amp; Risk in Plain English</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Multi-chain EVM indexing across Ethereum, Arbitrum, Base, Optimism &amp; Polygon.
            <br className="hidden sm:block" />
            Wallet age, protocol activity diversity, counterparty risk screening, and draft Form 8949 estimates.
          </p>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="#app-workspace"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-chain hover:bg-chain-dim text-primary-foreground font-semibold px-8 py-3.5 rounded-xl glow-chain-strong transition-all duration-200 text-sm"
          >
            Launch Explorer
            <ArrowRight className="h-4 w-4" />
          </a>
          <button
            onClick={() => onAnalyze?.(['vitalik.eth'])}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 border border-border bg-card/50 hover:bg-card text-foreground font-semibold px-8 py-3.5 rounded-xl transition-all duration-200 text-sm hover:border-border/80"
          >
            Try Demo
            <span className="text-muted-foreground text-xs font-mono">vitalik.eth</span>
          </button>
        </motion.div>

        {/* Feature badges */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto"
        >
          {[
            { icon: Shield, title: 'Client-Side Privacy', desc: 'Zero server storage. All data stays local.' },
            { icon: Zap, title: '1ms Classification', desc: 'In-browser XGBoost ONNX runtime.' },
            { icon: Search, title: 'Form 8949 Reports', desc: 'FIFO cost basis & CSV export.' },
          ].map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3.5 bg-card/30 border border-border/50 p-4 rounded-xl text-left backdrop-blur-sm hover:bg-card/50 hover:border-border/80 transition-all duration-200"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-chain/8 border border-chain/15 text-chain">
                <item.icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-foreground leading-tight">{item.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</div>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
