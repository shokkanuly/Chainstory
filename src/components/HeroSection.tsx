// src/components/HeroSection.tsx

export default function HeroSection() {
  return (
    <section className="hero" id="hero">
      <div className="hero__container">
        <div className="hero__badge">
          <span className="hero__badge-icon">✨</span>
          <span>Crafting Digital Excellence</span>
        </div>

        <h1 className="hero__title">
          We Build{' '}
          <span className="hero__title-accent">Solutions</span>{' '}
          That Drive Growth
        </h1>

        <p className="hero__subtitle">
          From stunning websites to powerful applications — we create digital
          experiences that captivate audiences and accelerate your business
          forward.
        </p>

        <div className="hero__actions">
          <a href="#contact" className="btn btn--primary btn--lg">
            Start Your Project
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
          <a href="#portfolio" className="btn btn--outline btn--lg">
            View Our Work
          </a>
        </div>
      </div>
    </section>
  );
}
