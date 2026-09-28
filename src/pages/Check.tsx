// src/pages/Check.tsx — "Check before you sign", on its own route.

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import CheckBeforeSign from '@/components/check/CheckBeforeSign';
import '../App.css';

export default function CheckPage() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Navbar />
      <main className="pt-20">
        <CheckBeforeSign />
      </main>
      <Footer />
    </div>
  );
}
