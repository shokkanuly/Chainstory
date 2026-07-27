import { motion } from 'framer-motion'
import { ArrowRight, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CTA() {
  return (
    <section className="relative py-24 sm:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-radial-glow opacity-50" />
      <div className="absolute inset-0 bg-grid opacity-20" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="relative rounded-2xl border border-chain/20 bg-card/50 p-8 sm:p-12 lg:p-16 text-center overflow-hidden"
        >
          {/* Glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-chain/10 blur-[80px] rounded-full" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-chain/20 bg-chain/5 px-4 py-1.5 mb-6">
              <Zap className="h-3.5 w-3.5 text-chain" />
              <span className="text-xs font-medium text-chain">Open Source · Browser-First</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
              Stop Guessing Your
              <br />
              <span className="text-gradient-chain">Crypto Tax Liability</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
              ChainStory runs entirely in your browser. No data is sent to any server.
              Your wallets, transactions, and tax data stay on your machine.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                className="bg-chain hover:bg-chain-dim text-primary-foreground font-semibold glow-chain-strong text-base px-8"
              >
                Get Started — It's Free
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <Button size="lg" variant="outline" className="border-border hover:bg-accent text-base px-8">
                View on GitHub
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
