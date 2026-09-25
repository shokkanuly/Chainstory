// src/components/PricingSection.tsx

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

interface PricingTier {
  name: string;
  description: string;
  price: string;
  period: string;
  features: string[];
  popular?: boolean;
}

const TIERS: PricingTier[] = [
  {
    name: 'Starter',
    description: 'Perfect for small businesses getting started online.',
    price: '$499',
    period: '/per project',
    features: [
      'Single page website',
      'Mobile responsive',
      'Basic SEO setup',
      '1 revision round',
      '2-week delivery',
    ],
  },
  {
    name: 'Professional',
    description: 'For growing businesses that need a complete digital presence.',
    price: '$1,499',
    period: '/per project',
    popular: true,
    features: [
      'Multi-page website',
      'Custom UI/UX design',
      'CMS integration',
      'SEO optimization',
      '3 revision rounds',
      'Analytics setup',
      '4-week delivery',
    ],
  },
  {
    name: 'Enterprise',
    description: 'Full-scale solutions for established organizations.',
    price: '$4,999',
    period: '/per project',
    features: [
      'Custom web application',
      'Advanced functionality',
      'API integrations',
      'Performance optimization',
      'Unlimited revisions',
      'Dedicated support',
      'Priority delivery',
    ],
  },
];

export default function PricingSection() {
  return (
    <section className="pricing" id="pricing">
      <div className="pricing__container">
        <span className="section-label">PRICING</span>
        <h2 className="section-heading">Transparent Pricing</h2>
        <p className="section-subtitle">
          Choose the plan that fits your ambition. No hidden fees, no surprises.
        </p>

        <div className="pricing__grid">
          {TIERS.map(tier => (
            <div
              key={tier.name}
              className={`pricing-card ${tier.popular ? 'pricing-card--popular' : ''}`}
            >
              {tier.popular && (
                <div className="pricing-card__badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Most Popular
                </div>
              )}
              <h3 className="pricing-card__name">{tier.name}</h3>
              <p className="pricing-card__desc">{tier.description}</p>
              <div className="pricing-card__price">
                <span className="pricing-card__amount">{tier.price}</span>
                <span className="pricing-card__period">{tier.period}</span>
              </div>
              <a
                href="#contact"
                className={`btn ${tier.popular ? 'btn--primary' : 'btn--outline'} btn--full`}
              >
                Get Started
              </a>
              <ul className="pricing-card__features">
                {tier.features.map(feat => (
                  <li key={feat} className="pricing-card__feature">
                    <span className="pricing-card__check">{CHECK_ICON}</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
