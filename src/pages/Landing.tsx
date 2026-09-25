// src/pages/Landing.tsx
//
// Marketing for both products: Retold (the analyser, at /app) and Tripwire (/tripwire).

import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import Architecture from '@/components/Architecture';
import HowItWorks from '@/components/HowItWorks';
import Security from '@/components/Security';
import CTA from '@/components/CTA';
import Footer from '@/components/Footer';
import TripwireTeaser from '@/components/tripwire/TripwireTeaser';
import { useNavigate } from 'react-router-dom';
import '../App.css';

export default function Landing() {
  const navigate = useNavigate();

  // The hero CTA hands the wallet to the workspace rather than analysing here.
  const openWorkspace = (addresses: string[]) => {
    const target = addresses[0];
    navigate(target ? `/app?address=${encodeURIComponent(target)}` : '/app');
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <Navbar />
      <Hero onAnalyze={openWorkspace} />
      <TripwireTeaser />
      <Features />
      <Architecture />
      <HowItWorks />
      <Security />
      <CTA />
      <Footer />
    </div>
  );
}
