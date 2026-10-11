import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CirclePause, Fingerprint, GitBranch, LockKeyhole, RotateCcw, ShieldCheck } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Logo from '@/components/Logo';
import ShaderField from '@/components/motion/ShaderField';
import DecodeText from '@/components/motion/DecodeText';
import RevealText from '@/components/motion/RevealText';
import VelocityMarquee from '@/components/motion/VelocityMarquee';
import { Magnetic, TiltCard } from '@/components/motion/pointer';
import { EASE, useReducedMotion, useRise, useRiseInView, useStagger } from '@/lib/motion';
import '../styles/tripwire-site.css';

const DOCS = 'https://github.com/shokkanuly/Chainstory/blob/main/docs/plans/';
const EXAMPLES = [
  { label: 'Verified payment', state: 'Ready for review', reason: 'Source and mint match. Screening and customer rules pass in this example.', checks: ['Source burn matched', 'Exact escrow credit', 'Screening receipt valid', 'Customer policy passed'], held: false },
  { label: 'Missing evidence', state: 'Held for evidence', reason: 'A source receipt is unavailable. The payment waits for evidence before review.', checks: ['Source receipt unavailable', 'Escrow credit observed', 'Screening cannot clear backing', 'Release remains on hold'], held: true },
  { label: 'Screening match', state: 'Held for screening', reason: 'The issuer reports a list match. This payment is held for review.', checks: ['Source burn matched', 'Exact escrow credit', 'Screening match reported', 'Release remains on hold'], held: true },
] as const;

const FAQ = [
  { q: 'What does Tripwire control?', a: 'Payouts through the configured cross-chain USDC escrow. It checks source backing, the destination credit, independent screening and the customer’s payment rules before release. Direct treasury transfers and other bridges sit outside that integration.' },
  { q: 'Does this website move funds?', a: 'The website is a read-only viewer and a local replay. It cannot approve, sign or send payments. A separately configured operator and on-chain contracts handle execution.' },
  { q: 'What happens when a check is unavailable?', a: 'The payment stays on hold with a reason. Missing, stale or conflicting mandatory evidence cannot authorize a release. A completed screening check is only one required gate.' },
  { q: 'Can held funds be returned?', a: 'The customer can request a delayed return of an authenticated escrow credit to its precommitted destination address. A return on Ethereum does not undo the source burn or automatically bridge funds back.' },
  { q: 'Which route is the payment pilot built for?', a: 'CCTP v2 Standard USDC from Base Sepolia to Ethereum Sepolia. The production target is Base to Ethereum. Additional routes need their own configuration, integration and review.' },
  { q: 'What is ready today?', a: 'The repository includes the screened escrow, operator, discovery, receipt checks and operations viewer. A separate guardian bridge demo has a recorded Sepolia deployment. The screened payment pilot still needs an independent review, an issuer integration, a fresh deployment and real payment evidence.' },
];

export default function Landing() {
  const [example, setExample] = useState(0);
  const reduce = useReducedMotion();
  const hero = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 851px) and (hover: hover) and (pointer: fine)');
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] });
  const fieldOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.15]);
  const fieldScale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -55]);
  const cardY = useTransform(scrollYProgress, [0, 1], [0, -95]);
  const label = useRise(0.05);
  const body = useRise(0.5);
  const ctas = useRise(0.65);
  const card = useRise(0.25, 30);
  const reveal = useRiseInView();
  const stagger = useStagger(0.1);
  const selected = EXAMPLES[example];
  return <div className="tw-site min-h-[100dvh] text-foreground">
    <Navbar />
    <main id="main-content">
      <div ref={hero} className="tw-hero-stage">
        <motion.div className="tw-hero-light" style={reduce ? undefined : { opacity: fieldOpacity, scale: fieldScale }} aria-hidden>
          <ShaderField className="fx-hero-field tw-hero-field" />
        </motion.div>
        <div className="fx-hero-veil tw-hero-veil" aria-hidden />
        <section className="tw-hero tw-container">
        <motion.div className="tw-hero-copy" style={!reduce && wide ? { y: copyY } : undefined}>
          <motion.p className="tw-eyebrow" {...label}><span className="tw-dot" /> CROSS-CHAIN PAYMENTS / VERIFIED BEFORE RELEASE</motion.p>
          <h1><DecodeText text="Every payout." duration={650} delay={150} /><br /><DecodeText className="tw-heading-accent" text="Prove it first." duration={900} delay={420} /></h1>
          <motion.p className="tw-lead" {...body}>A control layer for cross-chain USDC. Verify the source, check the policy, and hold the payment when the evidence doesn’t add up.</motion.p>
          <motion.div className="tw-actions" {...ctas}>
            <Magnetic><a href="/tripwire/operations" className="b-btn b-btn--primary">Open operations <ArrowUpRight size={17} /></a></Magnetic>
            <Magnetic strength={0.15}><a href="/tripwire" className="tw-link">Run the replay <ArrowRight size={17} /></a></Magnetic>
          </motion.div>
          <p className="tw-footnote">Read-only workspace · Testnet pilot tooling</p>
          <a href="#workflow" className="tw-scroll"><ArrowDown size={15} /> Follow a payment</a>
        </motion.div>
        <motion.div className="tw-payment-motion" style={!reduce && wide ? { y: cardY } : undefined} aria-label="Illustrative payment checks">
        <motion.div {...card}>
        <TiltCard className="tw-payment" baseX={wide && !reduce ? 2 : 0} baseY={wide && !reduce ? -5 : 0} max={wide ? 6 : 0}>
          <div className="tw-payment-top"><Logo size={25} /><span className="tw-chip">ILLUSTRATIVE EXAMPLE</span></div>
          <div className="tw-route"><span>BASE SEPOLIA</span><ArrowRight size={15} /><span>ETHEREUM SEPOLIA</span></div>
          <div className="tw-amount">1,200<span>USDC</span></div>
          <p className="tw-payment-caption">One payment. Every required check.</p>
          <div className="tw-example-picker" role="group" aria-label="Payment examples">
            {EXAMPLES.map((item, i) => <button key={item.label} type="button" aria-pressed={i === example} onClick={() => setExample(i)}>{item.label}</button>)}
          </div>
          <motion.ol key={example} className="tw-checks" variants={stagger.container} initial={reduce ? false : 'hidden'} animate="show">{selected.checks.map((check, i) => <motion.li key={check} variants={stagger.child} className="fx-scan" data-scan={reduce ? undefined : 'on'} style={{ '--scan': selected.held ? 'var(--b-warn)' : 'var(--b-purple)' } as CSSProperties}><span className="tw-check-index">0{i + 1}</span><span>{check}</span>{selected.held && (i >= 2 || (example === 1 && i === 0)) ? <CirclePause size={17} className="tw-warn" /> : <Check size={17} className="tw-pass" />}</motion.li>)}</motion.ol>
          <div className={`tw-decision ${selected.held ? 'tw-decision--held' : ''}`} aria-live="polite" aria-atomic="true"><div><span className="tw-eyebrow">PAYMENT STATUS</span><strong><DecodeText text={selected.state} duration={550} /></strong><p>{selected.reason}</p></div><motion.span key={selected.state} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: reduce ? 0 : 0.45, ease: EASE }}>{selected.held ? <CirclePause size={27} /> : <ShieldCheck size={27} />}</motion.span></div>
          <p className="tw-example-note">Synthetic scenario · No funds moved or execution permission issued.</p>
        </TiltCard>
        </motion.div>
        </motion.div>
        </section>
      </div>

      <div className="tw-strip"><p className="sr-only">Authenticated backing, independent screening, customer rules and a fixed return path.</p><VelocityMarquee baseSpeed={1.8}>{['AUTHENTICATED BACKING', 'INDEPENDENT SCREENING', 'CUSTOMER RULES', 'FIXED RETURN PATH'].map((text) => <span className="tw-ticker-item" key={text}><span>+</span>{text}</span>)}</VelocityMarquee></div>

      <section id="workflow" className="tw-section tw-container">
        <div className="tw-section-heading"><p className="tw-eyebrow">01 / THE PAYMENT PATH</p><Heading first="A message arrives." accent="The checks come next." /><p>Authentication is the start. Release also needs the right amount, recipient, policy and current evidence.</p></div>
        <motion.ol className="tw-flow" variants={stagger.container} initial={reduce ? false : 'hidden'} whileInView="show" viewport={{ once: true, amount: 0.2 }}>
          {[
            ['Burn', 'Source intent', 'The source operation binds the payment, recipient, policy and fixed return address.'],
            ['Credit', 'Destination escrow', 'An authenticated CCTP mint funds the exact net credit held for this payment.'],
            ['Verify', 'Tripwire gates', 'Source receipts, screening, customer rules and guardian limits are checked before release.'],
            ['Resolve', 'Payout or return', 'A permitted payout can execute. A held credit keeps its customer-requested return path.'],
          ].map(([name, label, copy], i) => <motion.li key={name} variants={stagger.child}><div className="tw-flow-number">0{i + 1}<ArrowRight size={18} /></div><p className="tw-eyebrow">{label}</p><h3>{name}</h3><p>{copy}</p></motion.li>)}
        </motion.ol>
      </section>

      <section id="controls" className="tw-section tw-container tw-controls">
        <div className="tw-section-heading"><p className="tw-eyebrow">02 / BUILT INTO THE PATH</p><Heading first="Evidence first." accent="Control all the way through." /></div>
        <div className="tw-control-grid">
          {[
            { icon: Fingerprint, title: 'A payment with provenance.', text: 'Bind the source burn and destination mint to one operation, exact net amount and intended recipient. A missing proof remains a hold.' },
            { icon: LockKeyhole, title: 'The customer sets the rules.', text: 'Recipient permissions, amount and budget limits, approvals, delays and pause state remain execution constraints.' },
            { icon: ShieldCheck, title: 'Screening with a receipt.', text: 'The screened escrow checks independent issuer evidence at review and execution. Expired, missing or matched evidence blocks release.' },
            { icon: RotateCcw, title: 'A defined way back.', text: 'Return an authenticated credit to its fixed destination beneficiary after the customer requests it and the required delay passes.' },
          ].map(({ icon: Icon, title, text }) => <motion.article key={title} className="fx-spot" {...reveal}><Icon size={24} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p></motion.article>)}
        </div>
        <p className="tw-scope-note">Controls cover the configured escrow path. Treasury owners and guardian authorities retain the powers documented in the integration’s trust model.</p>
      </section>

      <section id="operations" className="tw-section tw-container tw-operations">
        <div className="tw-section-heading"><p className="tw-eyebrow">03 / THE OPERATOR’S VIEW</p><Heading first="Know what’s held." accent="Know what happened." /><p>Inspect reported payment states, hold reasons, policy versions and receipt timelines. Import a public report or follow a local report folder.</p><a href="/tripwire/operations" className="tw-link">Explore the operations workspace <ArrowUpRight size={17} /></a></div>
        <motion.div className="tw-queue fx-spot" {...reveal}><div className="tw-queue-heading"><GitBranch size={17} /><span>PAYMENT QUEUE</span><span className="tw-chip">SYNTHETIC PREVIEW</span></div>
          {[
            ['01', 'Held', 'Customer approval required', 'tw-warn'],
            ['02', 'Paid', 'Payout receipt reported', 'tw-pass'],
            ['03', 'Returned', 'Fixed return receipt reported', 'tw-muted'],
          ].map(([id, state, reason, color]) => <motion.div className="tw-queue-row" key={id} {...reveal}><span className="tw-queue-id">PAYMENT / {id}</span><strong className={color}>{state}</strong><p>{reason}</p></motion.div>)}
          <p className="tw-example-note">Public reports describe a captured snapshot. They do not prove current liveness or a complete treasury inventory.</p>
        </motion.div>
      </section>

      <section id="replay" className="tw-section tw-container tw-replay">
        <div><p className="tw-eyebrow">04 / TEST THE TIMING</p><Heading first="Before execution" accent="makes the difference." /><p className="tw-lead">Compare a guardian acting before a modeled payout with one reacting after inclusion. Step through synthetic patterns inspired by Kelp DAO, Verus and Syscoin.</p><Magnetic><a href="/tripwire?incident=kelp" className="b-btn b-btn--primary">Open incident replay <ArrowUpRight size={17} /></a></Magnetic><p className="tw-footnote">Local EVM · Compiled guardian · Synthetic inputs</p></div>
        <motion.div className="tw-timing fx-spot" {...reveal}><div><span className="tw-eyebrow">BEFORE EXECUTION</span><div className="tw-timing-line"><span>Check</span><ArrowRight size={18} /><span className="tw-timing-gate">Hold</span><ArrowRight size={18} /><span>Payout waits</span></div></div><div><span className="tw-eyebrow">AFTER INCLUSION</span><div className="tw-timing-line"><span>Payout</span><ArrowRight size={18} /><span>Check</span><ArrowRight size={18} /><span className="tw-warn">Too late</span></div></div><p>This replay illustrates guardian timing. It does not reproduce original exploit transactions or establish prevented historical losses.</p></motion.div>
      </section>

      <section id="readiness" className="tw-section tw-container">
        <div className="tw-section-heading"><p className="tw-eyebrow">05 / CURRENT RELEASE</p><Heading first="Built in the repo." accent="Pilot gates still open." /><p>The engineering and the deployment gates are separate. Here is the current payment-pilot scope.</p></div>
        <div className="tw-readiness"><motion.article {...reveal}><span className="tw-chip">IMPLEMENTED LOCALLY</span><h3>Screened payment workflow</h3><ul><li>Escrow, customer policy and fixed returns</li><li>Independent screening receipt verification</li><li>Operator recovery and payment discovery</li><li>Public reports and operations viewer</li></ul><a href={`${DOCS}tripwire-progress.md`} target="_blank" rel="noopener noreferrer" className="tw-link">Read the engineering checkpoint <ArrowUpRight size={16} /></a></motion.article><motion.article {...reveal}><span className="tw-chip">PILOT GATES OPEN</span><h3>Next: real payment evidence</h3><ul><li>Independent review of the pinned release</li><li>Screening issuer/provider integration</li><li>Fresh screened escrow deployment and consent</li><li>Real payout, hold and return receipts</li></ul><a href={`${DOCS}tripwire-product.md`} target="_blank" rel="noopener noreferrer" className="tw-link">Read the product contract <ArrowUpRight size={16} /></a></motion.article></div>
        <p className="tw-scope-note">First payment route: Base Sepolia → Ethereum Sepolia · CCTP v2 Standard · USDC. The recorded Sepolia guardian demo is separate from the screened payment pilot.</p>
      </section>

      <section id="faq" className="tw-section tw-container tw-faq"><div className="tw-section-heading"><p className="tw-eyebrow">06 / THE DETAILS</p><Heading first="Clear boundaries." accent="Useful answers." /></div><div>{FAQ.map(({ q, a }) => <details key={q}><summary>{q}<span aria-hidden>+</span></summary><p>{a}</p></details>)}</div></section>
      <div className="fx-horizon"><section className="tw-close tw-container"><p className="tw-eyebrow">TRIPWIRE / VERIFY BEFORE RELEASE</p><Heading first="Put evidence" accent="in front of the payout." /><div className="tw-actions"><Magnetic><a href="/tripwire/operations" className="b-btn b-btn--primary">Open operations <ArrowUpRight size={17} /></a></Magnetic><Magnetic strength={0.15}><a href="/tripwire" className="tw-link">Try the replay <ArrowRight size={17} /></a></Magnetic></div></section></div>
    </main>
    <Footer />
  </div>;
}

function Heading({ first, accent }: { first: string; accent: string }) {
  return <RevealText parts={[{ text: first, className: 'tw-heading-line' }, { text: accent, className: 'tw-heading-line tw-heading-accent' }]} />;
}
