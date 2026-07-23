// src/components/ContactSection.tsx
import { useState } from 'react';

export default function ContactSection() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('Thank you! We\'ll be in touch soon.');
    setForm({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <section className="contact" id="contact">
      <div className="contact__container">
        <span className="section-label">CONTACT</span>
        <h2 className="section-heading">Let's Work Together</h2>
        <p className="section-subtitle">
          Have a project in mind? We'd love to hear about it.
        </p>

        <div className="contact__grid">
          {/* Contact Info */}
          <div className="contact__info">
            <div className="contact__info-item">
              <div className="contact__info-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div>
                <div className="contact__info-label">Email</div>
                <div className="contact__info-value">hello@studio.com</div>
              </div>
            </div>

            <div className="contact__info-item">
              <div className="contact__info-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div>
                <div className="contact__info-label">Phone</div>
                <div className="contact__info-value">+1 (555) 123-4567</div>
              </div>
            </div>

            <div className="contact__info-item">
              <div className="contact__info-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div>
                <div className="contact__info-label">Location</div>
                <div className="contact__info-value">San Francisco, CA</div>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <form className="contact__form" onSubmit={handleSubmit}>
            <div className="contact__form-row">
              <input
                type="text"
                name="name"
                placeholder="Your name"
                value={form.name}
                onChange={handleChange}
                className="contact__input"
                required
              />
              <input
                type="email"
                name="email"
                placeholder="Your email"
                value={form.email}
                onChange={handleChange}
                className="contact__input"
                required
              />
            </div>
            <input
              type="text"
              name="subject"
              placeholder="Subject"
              value={form.subject}
              onChange={handleChange}
              className="contact__input"
            />
            <textarea
              name="message"
              placeholder="Tell us about your project..."
              value={form.message}
              onChange={handleChange}
              className="contact__textarea"
              rows={5}
              required
            />
            <button type="submit" className="btn btn--primary btn--lg">
              Send Message
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
