// src/components/TestimonialsSection.tsx

const STAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  rating: number;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'Studio. transformed our online presence completely. The website they built exceeded all our expectations and the results speak for themselves.',
    name: 'Sarah Johnson',
    role: 'CEO, TechFlow Inc.',
    rating: 5,
  },
  {
    quote:
      'Working with Studio. was an incredible experience. Their attention to detail and creative approach made our brand stand out in the market.',
    name: 'Michael Chen',
    role: 'Founder, Artisan Labs',
    rating: 5,
  },
  {
    quote:
      'The team delivered a stunning e-commerce platform that boosted our sales by 300%. Professional, responsive, and truly talented.',
    name: 'Emily Rodriguez',
    role: 'Director, Bloom & Co.',
    rating: 5,
  },
];

export default function TestimonialsSection() {
  return (
    <section className="testimonials" id="testimonials">
      <div className="testimonials__container">
        <span className="section-label">TESTIMONIALS</span>
        <h2 className="section-heading">What Our Clients Say</h2>
        <p className="section-subtitle">
          Don't just take our word for it — hear from the businesses we've helped grow.
        </p>

        <div className="testimonials__grid">
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="testimonial-card">
              <div className="testimonial-card__stars">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <span key={i} className="testimonial-card__star">{STAR_ICON}</span>
                ))}
              </div>
              <blockquote className="testimonial-card__quote">
                "{t.quote}"
              </blockquote>
              <div className="testimonial-card__author">
                <div className="testimonial-card__avatar">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="testimonial-card__name">{t.name}</div>
                  <div className="testimonial-card__role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
