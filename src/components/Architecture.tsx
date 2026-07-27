import { motion } from 'framer-motion'

const stages = [
  {
    num: '01',
    title: 'Feature Extraction',
    module: 'featureExtractor.ts',
    description:
      'Pure TypeScript module extracts 10 tabular parameters per transaction: method signatures, gas profiles, protocol groups, contract age, and transfer values.',
    accent: 'border-chain',
    dot: 'bg-chain',
  },
  {
    num: '02',
    title: 'ML Classification',
    module: 'mlClassifier.ts',
    description:
      'In-browser XGBoost classifier via ONNX Runtime Web assigns categories — trade, income, transfer, NFT — at 1ms latency with zero server calls.',
    accent: 'border-signal-amber',
    dot: 'bg-signal-amber',
  },
  {
    num: '03',
    title: 'Natural Language Summary',
    module: 'descriptionGenerator.ts',
    description:
      'Google Gemini 1.5 Flash generates concise 1-sentence plain-English descriptions using the pre-classified category context.',
    accent: 'border-signal-green',
    dot: 'bg-signal-green',
  },
]

export default function Architecture() {
  return (
    <section id="architecture" className="relative py-24 sm:py-32 overflow-hidden">
      {/* Subtle background */}
      <div className="absolute inset-0 bg-radial-glow opacity-50" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            Architecture
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Decoupled <span className="text-gradient-chain">3-Stage ML Pipeline</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            No AI wrapper. A real ML pipeline running entirely in your browser.
          </p>
        </motion.div>

        {/* Pipeline flow */}
        <div className="relative max-w-4xl mx-auto">
          {/* Vertical connector line */}
          <div className="absolute left-[27px] top-0 bottom-0 w-px bg-border hidden sm:block" />

          <div className="space-y-6">
            {stages.map((stage, i) => (
              <motion.div
                key={stage.num}
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="relative flex gap-6 items-start"
              >
                {/* Step dot */}
                <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background">
                  <div className={`h-3 w-3 rounded-full ${stage.dot}`} />
                </div>

                {/* Content */}
                <div className={`flex-1 rounded-xl border ${stage.accent}/20 bg-card/50 p-6 sm:p-8 hover:bg-card transition-colors`}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold tracking-widest text-muted-foreground">
                      STAGE {stage.num}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                      {stage.module}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{stage.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {stage.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Architecture diagram (simplified visual) */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 max-w-3xl mx-auto"
        >
          <div className="rounded-xl border border-border bg-card/30 p-6 sm:p-8">
            <div className="font-mono text-xs text-muted-foreground space-y-2 text-center">
              <div className="flex items-center justify-center gap-3">
                <span className="rounded bg-secondary px-2 py-1 border border-border">Multi-Chain Ingestion</span>
                <span className="text-chain">→</span>
                <span className="rounded bg-secondary px-2 py-1 border border-border">DefiLlama Oracle</span>
                <span className="text-chain">→</span>
                <span className="rounded bg-secondary px-2 py-1 border border-border">3-Stage ML</span>
              </div>
              <div className="text-chain text-lg">↓</div>
              <div>
                <span className="rounded bg-chain/10 border border-chain/20 px-3 py-1.5 text-chain font-semibold">
                  FIFO Tax Accounting Engine → Form 8949 CSV
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
