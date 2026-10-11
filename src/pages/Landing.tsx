import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, CirclePause, Fingerprint, GitBranch, LockKeyhole, RotateCcw, ShieldCheck } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import Logo from '@/components/Logo';
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
  const selected = EXAMPLES[example];
  return <div className="tw-site min-h-[100dvh] text-foreground">
    <Navbar />
    <main id="main-content">
      <section className="tw-hero tw-container">
        <div className="tw-hero-copy">
          <p className="tw-eyebrow"><span className="tw-dot" /> CROSS-CHAIN PAYMENTS / VERIFIED BEFORE RELEASE</p>
          <h1>Every payout.<br /><span>Prove it first.</span></h1>
          <p className="tw-lead">A control layer for cross-chain USDC. Verify the source, check the policy, and hold the payment when the evidence doesn’t add up.</p>
          <div className="tw-actions">
            <a href="/tripwire/operations" className="b-btn b-btn--primary">Open operations <ArrowUpRight size={17} /></a>
            <a href="/tripwire" className="tw-link">Run the replay <ArrowRight size={17} /></a>
          </div>
          <p className="tw-footnote">Read-only workspace · Testnet pilot tooling</p>
          <a href="#workflow" className="tw-scroll"><ArrowDown size={15} /> Follow a payment</a>
        </div>
        <div className="tw-payment" aria-label="Illustrative payment checks">
          <div className="tw-payment-top"><Logo size={25} /><span className="tw-chip">ILLUSTRATIVE EXAMPLE</span></div>
          <div className="tw-route"><span>BASE SEPOLIA</span><ArrowRight size={15} /><span>ETHEREUM SEPOLIA</span></div>
          <div className="tw-amount">1,200<span>USDC</span></div>
          <p className="tw-payment-caption">One payment. Every required check.</p>
          <div className="tw-example-picker" role="group" aria-label="Payment examples">
            {EXAMPLES.map((item, i) => <button key={item.label} type="button" aria-pressed={i === example} onClick={() => setExample(i)}>{item.label}</button>)}
          </div>
          <ol className="tw-checks">{selected.checks.map((check, i) => <li key={check}><span className="tw-check-index">0{i + 1}</span><span>{check}</span>{selected.held && (i >= 2 || (example === 1 && i === 0)) ? <CirclePause size={17} className="tw-warn" /> : <Check size={17} className="tw-pass" />}</li>)}</ol>
          <div className={`tw-decision ${selected.held ? 'tw-decision--held' : ''}`} aria-live="polite" aria-atomic="true"><div><span className="tw-eyebrow">PAYMENT STATUS</span><strong>{selected.state}</strong><p>{selected.reason}</p></div>{selected.held ? <CirclePause size={27} /> : <ShieldCheck size={27} />}</div>
          <p className="tw-example-note">Synthetic scenario · No funds moved or execution permission issued.</p>
        </div>
      </section>

      <div className="tw-strip"><div className="tw-container"><span>AUTHENTICATED BACKING</span><span>INDEPENDENT SCREENING</span><span>CUSTOMER RULES</span><span>FIXED RETURN PATH</span></div></div>

      <section id="workflow" className="tw-section tw-container">
        <div className="tw-section-heading"><p className="tw-eyebrow">01 / THE PAYMENT PATH</p><h2>A message arrives.<br /><span>The checks come next.</span></h2><p>Authentication is the start. Release also needs the right amount, recipient, policy and current evidence.</p></div>
        <ol className="tw-flow">
          {[
            ['Burn', 'Source intent', 'The source operation binds the payment, recipient, policy and fixed return address.'],
            ['Credit', 'Destination escrow', 'An authenticated CCTP mint funds the exact net credit held for this payment.'],
            ['Verify', 'Tripwire gates', 'Source receipts, screening, customer rules and guardian limits are checked before release.'],
            ['Resolve', 'Payout or return', 'A permitted payout can execute. A held credit keeps its customer-requested return path.'],
          ].map(([name, label, copy], i) => <li key={name}><div className="tw-flow-number">0{i + 1}<ArrowRight size={18} /></div><p className="tw-eyebrow">{label}</p><h3>{name}</h3><p>{copy}</p></li>)}
        </ol>
      </section>

      <section id="controls" className="tw-section tw-container tw-controls">
        <div className="tw-section-heading"><p className="tw-eyebrow">02 / BUILT INTO THE PATH</p><h2>Evidence first.<br /><span>Control all the way through.</span></h2></div>
        <div className="tw-control-grid">
          {[
            { icon: Fingerprint, title: 'A payment with provenance.', text: 'Bind the source burn and destination mint to one operation, exact net amount and intended recipient. A missing proof remains a hold.' },
            { icon: LockKeyhole, title: 'The customer sets the rules.', text: 'Recipient permissions, amount and budget limits, approvals, delays and pause state remain execution constraints.' },
            { icon: ShieldCheck, title: 'Screening with a receipt.', text: 'The screened escrow checks independent issuer evidence at review and execution. Expired, missing or matched evidence blocks release.' },
            { icon: RotateCcw, title: 'A defined way back.', text: 'Return an authenticated credit to its fixed destination beneficiary after the customer requests it and the required delay passes.' },
          ].map(({ icon: Icon, title, text }) => <article key={title}><Icon size={24} strokeWidth={1.5} /><h3>{title}</h3><p>{text}</p></article>)}
        </div>
        <p className="tw-scope-note">Controls cover the configured escrow path. Treasury owners and guardian authorities retain the powers documented in the integration’s trust model.</p>
      </section>

      <section id="operations" className="tw-section tw-container tw-operations">
        <div className="tw-section-heading"><p className="tw-eyebrow">03 / THE OPERATOR’S VIEW</p><h2>Know what’s held.<br /><span>Know what happened.</span></h2><p>Inspect reported payment states, hold reasons, policy versions and receipt timelines. Import a public report or follow a local report folder.</p><a href="/tripwire/operations" className="tw-link">Explore the operations workspace <ArrowUpRight size={17} /></a></div>
        <div className="tw-queue"><div className="tw-queue-heading"><GitBranch size={17} /><span>PAYMENT QUEUE</span><span className="tw-chip">SYNTHETIC PREVIEW</span></div>
          {[
            ['01', 'Held', 'Customer approval required', 'tw-warn'],
            ['02', 'Paid', 'Payout receipt reported', 'tw-pass'],
            ['03', 'Returned', 'Fixed return receipt reported', 'tw-muted'],
          ].map(([id, state, reason, color]) => <div className="tw-queue-row" key={id}><span className="tw-queue-id">PAYMENT / {id}</span><strong className={color}>{state}</strong><p>{reason}</p></div>)}
          <p className="tw-example-note">Public reports describe a captured snapshot. They do not prove current liveness or a complete treasury inventory.</p>
        </div>
      </section>

      <section id="replay" className="tw-section tw-container tw-replay">
        <div><p className="tw-eyebrow">04 / TEST THE TIMING</p><h2>Before execution<br /><span>makes the difference.</span></h2><p className="tw-lead">Compare a guardian acting before a modeled payout with one reacting after inclusion. Step through synthetic patterns inspired by Kelp DAO, Verus and Syscoin.</p><a href="/tripwire?incident=kelp" className="b-btn b-btn--primary">Open incident replay <ArrowUpRight size={17} /></a><p className="tw-footnote">Local EVM · Compiled guardian · Synthetic inputs</p></div>
        <div className="tw-timing"><div><span className="tw-eyebrow">BEFORE EXECUTION</span><div className="tw-timing-line"><span>Check</span><ArrowRight size={18} /><span className="tw-timing-gate">Hold</span><ArrowRight size={18} /><span>Payout waits</span></div></div><div><span className="tw-eyebrow">AFTER INCLUSION</span><div className="tw-timing-line"><span>Payout</span><ArrowRight size={18} /><span>Check</span><ArrowRight size={18} /><span className="tw-warn">Too late</span></div></div><p>This replay illustrates guardian timing. It does not reproduce original exploit transactions or establish prevented historical losses.</p></div>
      </section>

      <section id="readiness" className="tw-section tw-container">
        <div className="tw-section-heading"><p className="tw-eyebrow">05 / CURRENT RELEASE</p><h2>Built in the repo.<br /><span>Pilot gates still open.</span></h2><p>The engineering and the deployment gates are separate. Here is the current payment-pilot scope.</p></div>
        <div className="tw-readiness"><article><span className="tw-chip">IMPLEMENTED LOCALLY</span><h3>Screened payment workflow</h3><ul><li>Escrow, customer policy and fixed returns</li><li>Independent screening receipt verification</li><li>Operator recovery and payment discovery</li><li>Public reports and operations viewer</li></ul><a href={`${DOCS}tripwire-progress.md`} target="_blank" rel="noopener noreferrer" className="tw-link">Read the engineering checkpoint <ArrowUpRight size={16} /></a></article><article><span className="tw-chip">PILOT GATES OPEN</span><h3>Next: real payment evidence</h3><ul><li>Independent review of the pinned release</li><li>Screening issuer/provider integration</li><li>Fresh screened escrow deployment and consent</li><li>Real payout, hold and return receipts</li></ul><a href={`${DOCS}tripwire-product.md`} target="_blank" rel="noopener noreferrer" className="tw-link">Read the product contract <ArrowUpRight size={16} /></a></article></div>
        <p className="tw-scope-note">First payment route: Base Sepolia → Ethereum Sepolia · CCTP v2 Standard · USDC. The recorded Sepolia guardian demo is separate from the screened payment pilot.</p>
      </section>

      <section id="faq" className="tw-section tw-container tw-faq"><div className="tw-section-heading"><p className="tw-eyebrow">06 / THE DETAILS</p><h2>Clear boundaries.<br /><span>Useful answers.</span></h2></div><div>{FAQ.map(({ q, a }) => <details key={q}><summary>{q}<span aria-hidden>+</span></summary><p>{a}</p></details>)}</div></section>
      <section className="tw-close tw-container"><p className="tw-eyebrow">TRIPWIRE / VERIFY BEFORE RELEASE</p><h2>Put evidence<br /><span>in front of the payout.</span></h2><div className="tw-actions"><a href="/tripwire/operations" className="b-btn b-btn--primary">Open operations <ArrowUpRight size={17} /></a><a href="/tripwire" className="tw-link">Try the replay <ArrowRight size={17} /></a></div></section>
    </main>
    <Footer />
  </div>;
}
