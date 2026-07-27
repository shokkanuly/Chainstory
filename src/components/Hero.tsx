import { motion } from 'framer-motion'
import { ArrowRight, Shield, Zap, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute inset-0 bg-radial-glow" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-chain/5 blur-[100px] animate-float" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full bg-chain/3 blur-[120px] animate-float" style={{ animationDelay: '-3s' }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="inline-flex items-center gap-2 rounded-full border border-chain/20 bg-chain/5 px-4 py-1.5 mb-8"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chain opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-chain" />
            </span>
            <span className="text-xs font-medium text-chain">Multi-Chain Support · 5 Networks</span>
          </motion.div>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
            className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6"
          >
            Translate Blockchain
            <br />
            <span className="text-gradient-chain">Into Plain English</span>
          </motion.h1>

          {/* Subheading */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Auto-classify every DeFi transaction, calculate IRS Form 8949 tax reports,
            and simulate pre-sign security warnings — all running locally in your browser.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button size="lg" className="bg-chain hover:bg-chain-dim text-primary-foreground font-semibold glow-chain-strong text-base px-8">
              Start Free
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <Button size="lg" variant="outline" className="border-border hover:bg-accent text-base px-8">
              View Demo
            </Button>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1 }}
            className="mt-16 flex flex-wrap items-center justify-center gap-6 sm:gap-10"
          >
            {[
              { icon: Shield, label: 'Runs Locally', sub: 'No data leaves your browser' },
              { icon: Zap, label: '1ms Classification', sub: 'In-browser ONNX ML' },
              { icon: Wallet, label: '5 Chains', sub: 'ETH · ARB · Base · OP · Polygon' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                  <item.icon className="h-4.5 w-4.5 text-chain" />
                </div>
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.sub}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
