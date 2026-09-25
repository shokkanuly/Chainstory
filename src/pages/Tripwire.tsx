// src/pages/Tripwire.tsx — the incident replay, on its own route.
//
// Code-split from the rest of the app: it carries an in-browser EVM, which
// has no business on the landing page's critical path.

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import TripwireDashboard from '@/components/tripwire/TripwireDashboard';
import '../App.css';

export default function TripwirePage() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Navbar />
      <main className="pt-20">
        <TripwireDashboard />
      </main>
      <Footer />
    </div>
  );
}
