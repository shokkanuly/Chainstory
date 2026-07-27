import { Zap } from 'lucide-react'

const footerLinks = {
  Product: ['Features', 'Architecture', 'Tax Reports', 'Security API', 'Pricing'],
  Developers: ['Documentation', 'API Reference', 'GitHub', 'NPM Package', 'Changelog'],
  Resources: ['Blog', 'Tax Guide', 'DeFi Glossary', 'Changelog', 'Status'],
  Legal: ['Privacy Policy', 'Terms of Service', 'Disclaimer', 'License'],
}

export default function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <a href="#" className="flex items-center gap-2 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-chain/10 border border-chain/20">
                <Zap className="h-3.5 w-3.5 text-chain" />
              </div>
              <span className="text-base font-bold">
                Chain<span className="text-chain">Story</span>
              </span>
            </a>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[200px]">
              Multi-chain plain-English tax & pre-sign security engine.
              Browser-first. Privacy-first.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                {category}
              </h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © 2026 ChainStory. All rights reserved.
          </p>
          <p className="text-[10px] text-muted-foreground/60 max-w-md text-center sm:text-right">
            Disclaimer: ChainStory provides AI/ML transaction classification and FIFO lot
            accounting estimates for informational purposes. Not financial or tax advice.
          </p>
        </div>
      </div>
    </footer>
  )
}
