// src/components/StatsBar.tsx

const STATS = [
  { value: '200+', label: 'Projects Delivered' },
  { value: '50+', label: 'Happy Clients' },
  { value: '98%', label: 'Satisfaction Rate' },
  { value: '5+', label: 'Years Experience' },
];

export default function StatsBar() {
  return (
    <section className="stats" id="stats">
      <div className="stats__container">
        {STATS.map(stat => (
          <div key={stat.label} className="stats__item">
            <span className="stats__value">{stat.value}</span>
            <span className="stats__label">{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
