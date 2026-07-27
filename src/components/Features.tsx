import { motion } from 'framer-motion'
import {
  Globe,
  Cpu,
  FileText,
  ShieldCheck,
  Database,
  Layers,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

const features = [
  {
    icon: Globe,
    title: 'Multi-Chain EVM Indexing',
    description:
      'Index transactions across Ethereum, Arbitrum, Base, Optimism, and Polygon. Decodes internal transfers, DEX swaps, Aave liquidations, and Lido staking claims.',
    color: 'text-chain',
    tag: 'Ingestion',
  },
  {
    icon: Database,
    title: 'DefiLlama Price Oracle',
    description:
      'Zero rate-limit pricing via DefiLlama historical API. Client-side IndexedDB cache guarantees 0ms latency on repeated lookups with zero 429 errors.',
    color: 'text-signal-green',
    tag: 'Pricing',
  },
  {
    icon: Cpu,
    title: 'In-Browser ML Classification',
    description:
      '3-stage pipeline: TypeScript feature extraction → XGBoost ONNX classifier at 1ms latency → Gemini-powered natural language summaries.',
    color: 'text-signal-amber',
    tag: 'Intelligence',
  },
  {
    icon: FileText,
    title: 'IRS Form 8949 Tax Reports',
    description:
      'Strict per-wallet FIFO accounting with short/long-term capital gains. Deductible gas expense breakdown and tax-ready CSV export.',
    color: 'text-chain',
    tag: 'Tax',
  },
  {
    icon: ShieldCheck,
    title: 'Pre-Sign Security API',
    description:
      'Simulate raw eth_sendTransaction payloads before signing. Flag unlimited ERC-20 allowances, unverified contracts, and dangerous protocol interactions.',
    color: 'text-signal-red',
    tag: 'Security',
  },
  {
    icon: Layers,
    title: 'ENS & Multi-Wallet Batching',
    description:
      'Resolve .eth names via ENS and process batch wallet portfolios. Analyze multiple addresses in a single session.',
    color: 'text-chain',
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
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
}

export default function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            Core Capabilities
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Everything You Need to
            <br />
            <span className="text-gradient-chain">Understand On-Chain Activity</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            From raw hex data to human-readable narratives and IRS-compliant tax reports.
          </p>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={item}>
              <Card className="h-full bg-card/50 border-border/50 hover:border-chain/30 hover:bg-card transition-all duration-300 group">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chain/10 border border-chain/15 group-hover:glow-chain transition-shadow">
                      <f.icon className={`h-5 w-5 ${f.color}`} />
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {f.tag}
                    </span>
                  </div>
                  <CardTitle className="text-base font-semibold leading-snug">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed text-muted-foreground/80">
                    {f.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
