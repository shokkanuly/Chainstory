// src/components/Features.tsx — Premium Feature Grid
import { motion } from 'framer-motion'
import {
  Globe,
  Cpu,
  FileText,
  ShieldCheck,
  Database,
  Layers,
} from 'lucide-react'

const features = [
  {
    icon: Globe,
    title: 'Multi-Chain EVM Indexing',
    description:
      'Index transactions across Ethereum, Arbitrum, Base, Optimism, and Polygon. Decodes internal transfers, DEX swaps, Aave liquidations, and Lido staking claims.',
    color: '#3b82f6',
    tag: 'Ingestion',
  },
  {
    icon: Database,
    title: 'DefiLlama Price Oracle',
    description:
      'Zero rate-limit pricing via DefiLlama historical API. Client-side IndexedDB cache guarantees 0ms latency on repeated lookups with zero 429 errors.',
    color: '#10b981',
    tag: 'Pricing',
  },
  {
    icon: Cpu,
    title: 'In-Browser ML Classification',
    description:
      '3-stage pipeline: TypeScript feature extraction → XGBoost ONNX classifier at 1ms latency → Gemini-powered natural language summaries.',
    color: '#f59e0b',
    tag: 'Intelligence',
  },
  {
    icon: FileText,
    title: 'IRS Form 8949 Tax Reports',
    description:
      'Strict per-wallet FIFO accounting with short/long-term capital gains. Deductible gas expense breakdown and tax-ready CSV export.',
    color: '#8b5cf6',
    tag: 'Tax',
  },
  {
    icon: ShieldCheck,
    title: 'Pre-Sign Security API',
    description:
      'Simulate raw eth_sendTransaction payloads before signing. Flag unlimited ERC-20 allowances, unverified contracts, and dangerous protocol interactions.',
    color: '#ef4444',
    tag: 'Security',
  },
  {
    icon: Layers,
    title: 'ENS & Multi-Wallet Batching',
    description:
      'Resolve .eth names via ENS and process batch wallet portfolios. Analyze multiple addresses in a single session.',
    color: '#06b6d4',
    tag: 'Identity',
  },
]

const container = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
}

export default function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3.5 py-1 text-[11px] font-semibold text-muted-foreground mb-5 uppercase tracking-wider">
            Core Capabilities
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] mb-4 leading-tight">
            Everything You Need to
            <br />
            <span className="text-gradient-chain">Understand On-Chain Activity</span>
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            From raw hex data to human-readable narratives and IRS-compliant tax reports.
          </p>
        </motion.div>

        {/* Grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={item}>
              <div className="h-full bg-card/40 border border-border/50 hover:border-border hover:bg-card/70 rounded-xl p-6 transition-all duration-300 group">
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg border transition-shadow duration-300 group-hover:shadow-lg"
                    style={{
                      backgroundColor: `${f.color}10`,
                      borderColor: `${f.color}20`,
                    }}
                  >
                    <f.icon className="h-5 w-5" style={{ color: f.color }} />
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {f.tag}
                  </span>
                </div>
                <h3 className="text-[15px] font-semibold text-foreground leading-snug mb-2 tracking-tight">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
