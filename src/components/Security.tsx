import { motion } from 'framer-motion'
import { Shield, AlertTriangle, Lock, Eye } from 'lucide-react'

const threats = [
  {
    icon: AlertTriangle,
    label: 'Unlimited ERC-20 Allowances',
    severity: 'Critical',
    severityColor: 'text-signal-red bg-signal-red/10 border-signal-red/20',
  },
  {
    icon: Shield,
    label: 'Unverified Contract Interactions',
    severity: 'High',
    severityColor: 'text-signal-amber bg-signal-amber/10 border-signal-amber/20',
  },
  {
    icon: Lock,
    label: 'High ETH Value Transfers',
    severity: 'Medium',
    severityColor: 'text-signal-amber bg-signal-amber/10 border-signal-amber/20',
  },
  {
    icon: Eye,
    label: 'Dangerous Protocol Calls',
    severity: 'High',
    severityColor: 'text-signal-amber bg-signal-amber/10 border-signal-amber/20',
  },
]

export default function Security() {
  return (
    <section id="security" className="relative py-24 sm:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-radial-glow opacity-30" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-signal-red/20 bg-signal-red/5 px-3 py-1 text-xs font-medium text-signal-red mb-6">
              <Shield className="h-3 w-3" />
              B2B Security API
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
              Pre-Sign <span className="text-gradient-chain">Transaction Security</span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-6">
              Before your users sign any transaction, ChainStory simulates the raw{' '}
              <code className="text-sm bg-secondary px-1.5 py-0.5 rounded font-mono">
                eth_sendTransaction
              </code>{' '}
              payload and surfaces risk warnings in plain English.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Integrate the{' '}
              <code className="text-sm bg-secondary px-1.5 py-0.5 rounded font-mono">
                @chainstory/core
              </code>{' '}
              SDK into your DeFi app to give users real-time security context before they approve any contract interaction.
            </p>
          </motion.div>

          {/* Right: threat cards */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-3"
          >
            <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
              <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-3">
                Pre-Sign Security Output
              </div>
              <div className="font-mono text-xs space-y-1 text-muted-foreground/80">
                <div>
                  <span className="text-chain">→</span> Simulating 0x7a3b...e42f
                </div>
                <div>
                  <span className="text-signal-red">⚠</span> Unlimited USDC allowance detected
                </div>
                <div>
                  <span className="text-signal-amber">⚠</span> Contract not verified on Etherscan
                </div>
                <div>
                  <span className="text-signal-green">✓</span> Gas within normal range (23 gwei)
                </div>
              </div>
            </div>

            {threats.map((t, i) => (
              <motion.div
                key={t.label}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
                className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-4 py-3 hover:border-chain/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <t.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t.label}</span>
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${t.severityColor}`}>
                  {t.severity}
                </span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
