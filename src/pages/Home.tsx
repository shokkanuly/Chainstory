import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import Features from '@/components/Features'
import Architecture from '@/components/Architecture'
import HowItWorks from '@/components/HowItWorks'
import Security from '@/components/Security'
import CTA from '@/components/CTA'
import Footer from '@/components/Footer'

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Hero />
      <Features />
      <Architecture />
      <HowItWorks />
      <Security />
      <CTA />
      <Footer />
    </div>
  )
}
