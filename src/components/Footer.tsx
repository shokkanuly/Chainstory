// src/components/Footer.tsx — shared by the landing page, Retold and Tripwire.
import Logo from './Logo'

const LINKS = [
  { label: 'Retold app', href: '/app' },
  { label: 'Tripwire replay', href: '/tripwire' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'GitHub', href: 'https://github.com/shokkanuly/Chainstory' },
]

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div className="max-w-sm">
          <a href="/" aria-label="Retold home">
            <Logo size={26} />
          </a>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Read any wallet. Protect every bridge. Retold and Tripwire are read-only: nothing to connect, nothing to sign.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] uppercase tracking-[0.12em]">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-7xl border-t border-border px-4 py-5 text-[11px] leading-relaxed text-muted-foreground sm:px-6 lg:px-8">
        © 2026 Retold · Tripwire · MIT. Retold’s tax output is a draft Form 8949 estimate to review with a qualified tax
        professional, not tax advice. Tripwire is not yet deployed to a live chain.
      </div>
    </footer>
  )
}
