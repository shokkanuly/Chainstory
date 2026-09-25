// The whole site: one page. Vercel rewrites every path here, so /tripwire and
// any old link land on it too.

import { GithubLogoIcon } from '@phosphor-icons/react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import TripwireDashboard from '@/components/tripwire/TripwireDashboard';

const REPO = 'https://github.com/shokkanuly/Chainstory';

export default function TripwirePage() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" aria-label="Tripwire home">
            <Logo size={30} />
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <GithubLogoIcon size={18} weight="bold" aria-hidden />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>
      <main>
        <TripwireDashboard />
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground sm:px-6 lg:px-8">
          Tripwire · MIT · Not deployed to a live chain. Incident figures as reported by the linked sources.
        </p>
      </footer>
    </div>
  );
}
