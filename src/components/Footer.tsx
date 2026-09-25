import Logo from './ui/Logo'
// src/components/Footer.tsx — Premium Footer
export default function Footer() {
  const footerLinks = {
    Product: ['Features', 'Architecture', 'Tax Reports', 'Security API'],
    Developers: ['GitHub', 'API Reference', 'Documentation', 'Changelog'],
    Resources: ['Tax Guide', 'DeFi Glossary', 'Blog', 'Status'],
    Legal: ['Privacy Policy', 'Terms of Service', 'Disclaimer'],
  }

  return (
    <footer className="border-t border-border bg-card/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <a href="#" className="flex items-center mb-4">
              <Logo height={22} />
            </a>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
              Wallet intelligence — understand any wallet's story, draft tax estimates, and risk in plain English.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                {category}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
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
        <div className="mt-14 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © 2026 ChainStory. All rights reserved.
          </p>
          <p className="text-[11px] text-muted-foreground/60 max-w-xl text-center sm:text-right leading-relaxed">
            <strong>Disclaimer:</strong> ChainStory generates a DRAFT Form 8949 / Schedule D estimate to review with a qualified tax professional. This tool is for informational and educational purposes only and does not constitute formal tax or financial advice.
          </p>
        </div>
      </div>
    </footer>
  )
}
