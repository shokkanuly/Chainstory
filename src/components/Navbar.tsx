// src/components/Navbar.tsx
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'

// Absolute anchors work from every Tripwire page.
const navLinks = [
  { label: 'How it works', href: '/#workflow' },
  { label: 'Controls', href: '/#controls' },
  { label: 'Replay', href: '/tripwire' },
  { label: 'FAQ', href: '/#faq' },
]

export default function Navbar() {
  const reduce = useReducedMotion();
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Reading progress, as a thread of light along the bar's lower edge.
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 34, restDelta: 0.001 })

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <motion.nav
      aria-label="Main navigation"
      initial={reduce ? false : { y: -18, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled || pathname !== '/'
          ? 'nav-solid border-b border-border/60 shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <a href="/" aria-label="Tripwire home" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-[var(--b-purple)]" style={{ borderColor: 'color-mix(in oklab, var(--b-purple) 45%, transparent)' }}>
              TESTNET
            </span>
          </a>

          {/* Desktop nav */}
          <div className="hidden xl:flex items-center gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={link.href === pathname ? 'page' : undefined}
                className="px-3 py-2 text-[14px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-secondary/60"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden xl:flex items-center gap-3">
            <ThemeToggle />
            <a
              href="https://github.com/shokkanuly/Chainstory"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-[var(--b-line-strong)] hover:bg-secondary"
            >
              GitHub ↗
            </a>
            <a
              href="/tripwire/operations"
              aria-current={pathname === '/tripwire/operations' ? 'page' : undefined}
              className="b-btn b-btn--primary !px-4 !py-2.5 !text-[13px]"
            >
              Open operations
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            className="xl:hidden p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            aria-controls="tripwire-mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {scrolled && !reduce && (
        <motion.div
          aria-hidden
          className="absolute bottom-[-1px] left-0 right-0 h-[2px] origin-left"
          style={{ scaleX: progress, background: 'linear-gradient(90deg, var(--b-purple), var(--b-cyan))', boxShadow: '0 0 12px var(--b-purple)' }}
        />
      )}

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            // A disclosure still needs to open; under reduced motion it just
            // appears rather than sliding.
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            id="tripwire-mobile-menu"
            className="xl:hidden overflow-hidden glass-strong border-b border-border/60"
          >
            <div className="px-4 py-4 space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/60"
                >
                  {link.label}
                </a>
              ))}
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-muted-foreground">Theme</span>
                <ThemeToggle />
              </div>
              <div className="pt-3 border-t border-border mt-3">
                <a
                  href="/tripwire/operations"
                  onClick={() => setMobileOpen(false)}
                  className="b-btn b-btn--primary w-full"
                >
                  Open operations
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
