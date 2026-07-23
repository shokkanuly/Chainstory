// src/components/PortfolioSection.tsx
import { useState } from 'react';

type Category = 'all' | 'web' | 'design' | 'mobile';

interface Project {
  title: string;
  description: string;
  category: Category;
  categoryLabel: string;
  image: string;
}

const PROJECTS: Project[] = [
  {
    title: 'E-Commerce Platform',
    description: 'A modern online store with real-time inventory tracking.',
    category: 'web',
    categoryLabel: 'Web App',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop',
  },
  {
    title: 'Brand Identity',
    description: 'Complete visual identity for a fintech startup.',
    category: 'design',
    categoryLabel: 'Design',
    image: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=600&h=400&fit=crop',
  },
  {
    title: 'Analytics Dashboard',
    description: 'Real-time data visualization for marketing teams.',
    category: 'web',
    categoryLabel: 'Web App',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop',
  },
  {
    title: 'Fitness Tracker',
    description: 'Cross-platform mobile app for health enthusiasts.',
    category: 'mobile',
    categoryLabel: 'Mobile',
    image: 'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?w=600&h=400&fit=crop',
  },
  {
    title: 'Restaurant Website',
    description: 'Elegant website with online reservation system.',
    category: 'web',
    categoryLabel: 'Web App',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop',
  },
  {
    title: 'Product Packaging',
    description: 'Premium packaging design for a luxury brand.',
    category: 'design',
    categoryLabel: 'Design',
    image: 'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=600&h=400&fit=crop',
  },
];

const FILTERS: { label: string; value: Category }[] = [
  { label: 'All', value: 'all' },
  { label: 'Web App', value: 'web' },
  { label: 'Design', value: 'design' },
  { label: 'Mobile', value: 'mobile' },
];

export default function PortfolioSection() {
  const [active, setActive] = useState<Category>('all');

  const filtered = active === 'all'
    ? PROJECTS
    : PROJECTS.filter(p => p.category === active);

  return (
    <section className="portfolio" id="portfolio">
      <div className="portfolio__container">
        <span className="section-label">PORTFOLIO</span>
        <h2 className="section-heading">Featured Work</h2>
        <p className="section-subtitle">
          A selection of projects we're proud to have delivered.
        </p>

        <div className="portfolio__filters">
          {FILTERS.map(f => (
            <button
              key={f.value}
              className={`portfolio__filter ${active === f.value ? 'portfolio__filter--active' : ''}`}
              onClick={() => setActive(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="portfolio__grid">
          {filtered.map(project => (
            <div key={project.title} className="portfolio-card">
              <div className="portfolio-card__img-wrap">
                <img
                  src={project.image}
                  alt={project.title}
                  className="portfolio-card__img"
                  loading="lazy"
                />
              </div>
              <div className="portfolio-card__body">
                <span className="portfolio-card__tag">{project.categoryLabel}</span>
                <h3 className="portfolio-card__title">{project.title}</h3>
                <p className="portfolio-card__desc">{project.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
