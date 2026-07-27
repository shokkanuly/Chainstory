import { motion } from 'framer-motion'
import { Search, Cpu, FileDown } from 'lucide-react'

const steps = [
  {
    icon: Search,
    title: 'Paste Wallet or ENS',
    description:
      'Enter one or multiple wallet addresses, or resolve .eth ENS names. Select your target chain from 5 supported EVM networks.',
    step: '1',
  },
  {
    icon: Cpu,
    title: 'Auto-Classify Everything',
    description:
      'ChainStory fetches transactions, decodes internal calls, prices assets via DefiLlama, and runs the 3-stage ML pipeline locally.',
    step: '2',
  },
  {
    icon: FileDown,
    title: 'Export Tax-Ready Reports',
    description:
      'Download IRS Form 8949 compliant CSVs with FIFO cost-basis, short/long-term gains, and deductible gas fees — ready for your CPA.',
    step: '3',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground mb-4">
            How It Works
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Three Steps to <span className="text-gradient-chain">Tax Clarity</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            From wallet address to filed taxes in minutes, not days.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="relative text-center group"
            >
              {/* Step number */}
              <div className="relative inline-flex mb-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-chain/20 bg-chain/5 group-hover:glow-chain transition-shadow">
                  <step.icon className="h-7 w-7 text-chain" />
                </div>
                <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-chain text-[10px] font-bold text-primary-foreground">
                  {step.step}
                </span>
              </div>

              <h3 className="text-lg font-bold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                {step.description}
              </p>

              {/* Connector arrow (desktop) */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-8 left-[calc(50%+40px)] w-[calc(100%-80px)]">
                  <div className="w-full h-px bg-border relative">
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-chain/40" />
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
