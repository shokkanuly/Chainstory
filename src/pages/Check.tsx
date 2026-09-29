// src/pages/Check.tsx — "Check before you sign", on its own route.

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PageAurora from '@/components/motion/PageAurora';
import CheckBeforeSign from '@/components/check/CheckBeforeSign';
import '../App.css';

export default function CheckPage() {
  return (
    <div className="relative isolate min-h-[100dvh] text-foreground">
      <PageAurora />
      <Navbar />
      <main className="pt-20">
        <CheckBeforeSign />
      </main>
      <Footer />
    </div>
  );
}
