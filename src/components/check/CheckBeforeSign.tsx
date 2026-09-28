// src/components/check/CheckBeforeSign.tsx
//
// "Check before you sign": paste a pending transaction's target and calldata,
// get a green / yellow / red badge with the reasons behind it.
//
// Read-only by construction (I1). There is no wallet connection on this page
// and no code path that signs or sends; src/testing/noSigning.test.ts walks
// every module this page can reach and fails if one appears.
//
// The badge and reasons are computed by src/services/preSignCheck.ts. The AI
// line, when the server has a key, only rewords them and is labelled as such.

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckCircleIcon,
  CircleNotchIcon,
  FlaskIcon,
  InfoIcon,
  ProhibitIcon,
  SparkleIcon,
  WarningIcon,
  WarningOctagonIcon,
  type Icon,
} from '@phosphor-icons/react';
import { parseEther } from 'viem';
import '../tripwire/tripwire.css';
import type { ChainId } from '../../types';
import { CHAIN_CONFIGS } from '../../services/chains';
import { isAddressShaped } from '../../services/contractIntel';
import type { ContractPermissionRisk } from '../../services/contractRiskExplainer';
import { checkBeforeSign, type Badge, type PreSignReason, type PreSignResult } from '../../services/preSignCheck';
import { PRE_SIGN_SCENARIOS, scenarioIntel, type PreSignScenario } from '../../services/preSignScenarios';
import { phraseCheckVerdict } from '../../services/apiClient';

// Colours are the validated status tokens in tripwire.css. A badge is never
// shown by colour alone: each carries an icon and a word.
const BADGE: Record<Badge, { label: string; verdict: string; color: string; icon: Icon }> = {
  green: { label: 'Green', verdict: 'No risk signals found', color: 'var(--tw-clear)', icon: CheckCircleIcon },
  yellow: { label: 'Yellow', verdict: 'Review before you sign', color: 'var(--tw-elevated)', icon: WarningIcon },
  red: { label: 'Red', verdict: "Don't sign unless you are certain", color: 'var(--tw-trip)', icon: ProhibitIcon },
};

const LEVEL: Record<PreSignReason['level'], { label: string; color: string; icon: Icon }> = {
  critical: { label: 'Critical', color: 'var(--tw-trip)', icon: WarningOctagonIcon },
  warning: { label: 'Warning', color: 'var(--tw-elevated)', icon: WarningIcon },
  info: { label: 'Note', color: 'var(--b-text-muted)', icon: InfoIcon },
};

type Source = { kind: 'live'; chain: ChainId } | { kind: 'scenario'; label: string };

interface Outcome {
  result: PreSignResult;
  source: Source;
  wording: string | null;
}

const CHAINS = Object.values(CHAIN_CONFIGS);

export default function CheckBeforeSign() {
  const [to, setTo] = useState('');
  const [data, setData] = useState('');
  const [eth, setEth] = useState('');
  const [chain, setChain] = useState<ChainId>('ethereum');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A newer check always wins over a slower, older one.
  const latest = useRef(0);

  const run = async (source: Source, input: Parameters<typeof checkBeforeSign>[0], scenario: boolean) => {
    const id = ++latest.current;
    setBusy(true);
    setFormError(null);
    let result: PreSignResult;
    try {
      result = await checkBeforeSign(input, scenario ? { fetchIntel: scenarioIntel } : {});
    } catch {
      // checkBeforeSign turns every failure into a reason; this is a backstop.
      if (id === latest.current) {
        setFormError('The check could not be completed.');
        setBusy(false);
      }
      return;
    }
    if (id !== latest.current) return;
    setOutcome({ result, source, wording: null });
    setBusy(false);

    const wording = await phraseCheckVerdict(result.badge, result.reasons.map((r) => r.id));
    if (wording && id === latest.current) setOutcome((o) => (o ? { ...o, wording } : o));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const target = to.trim();
    if (!isAddressShaped(target)) {
      setFormError('The target is 42 characters: "0x" and 40 hexadecimal digits.');
      return;
    }
    let value = 0n;
    const amount = eth.trim();
    if (amount) {
      try {
        if (!/^(\d+\.?\d*|\.\d+)$/.test(amount)) throw new Error('not a positive decimal');
        value = parseEther(amount);
      } catch {
        setFormError('The ETH value is a positive decimal, like 0.25.');
        return;
      }
    }
    void run({ kind: 'live', chain }, { to: target, data, value, chainId: chain }, false);
  };

  const tryScenario = (s: PreSignScenario) => {
    setTo(s.input.to);
    setData(s.input.data);
    setEth('');
    void run({ kind: 'scenario', label: s.label }, s.input, true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="b-eyebrow">Retold · check before you sign</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Know what you are about to sign.</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Paste a pending transaction’s target and data, the way your wallet shows them. Retold reads the calldata,
          looks up the contracts involved on the block explorer, and tells you what signing does, with a green, yellow
          or red badge and the reasons for it. Nothing to connect, nothing to sign.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="b-card min-w-0 space-y-5 p-4 sm:p-5" aria-label="Transaction to check">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Target contract" hint="The transaction's “to”. For a token approval or transfer, the token.">
              {(id) => (
                <input
                  id={id}
                  className="b-input"
                  style={{ fontSize: '0.8125rem' }}
                  placeholder="0x…"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Calldata" hint="The transaction's data, starting 0x. Leave empty for a plain ETH transfer.">
              {(id) => (
                <textarea
                  id={id}
                  className="b-input block"
                  style={{ borderRadius: 'var(--b-r-md)', fontSize: '0.75rem', minHeight: '7.5rem', wordBreak: 'break-all' }}
                  placeholder="0x095ea7b3…"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  spellCheck={false}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ETH value" hint="Optional.">
                {(id) => (
                  <input
                    id={id}
                    className="b-input"
                    style={{ fontSize: '0.8125rem' }}
                    inputMode="decimal"
                    placeholder="0"
                    value={eth}
                    onChange={(e) => setEth(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Chain">
                {(id) => (
                  <select
                    id={id}
                    className="b-input"
                    style={{ fontSize: '0.8125rem', fontFamily: 'var(--b-font)' }}
                    value={chain}
                    onChange={(e) => setChain(e.target.value as ChainId)}
                  >
                    {CHAINS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            {formError && (
              <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--tw-trip)' }}>
                {formError}
              </p>
            )}

            <button type="submit" disabled={busy} className="b-btn b-btn--primary w-full disabled:opacity-60">
              {busy ? <CircleNotchIcon size={15} weight="bold" className="animate-spin" aria-hidden /> : null}
              {busy ? 'Checking…' : 'Check it'}
            </button>
          </form>

          <div className="border-t border-border pt-4">
            <p className="b-eyebrow flex items-center gap-1.5">
              <FlaskIcon size={13} weight="bold" aria-hidden /> Demo scenarios
            </p>
            <div className="mt-2 grid gap-2">
              {PRE_SIGN_SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => tryScenario(s)}
                  className="b-card flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="min-w-0">{s.label}</span>
                  <BadgeDot badge={s.expectedBadge} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The scenarios’ calldata is real ERC-20 encoding. Their contract facts are synthetic, on placeholder
              addresses, so the demo runs without the explorer.
            </p>
          </div>
        </section>

        <section className="min-w-0" aria-live="polite" aria-busy={busy}>
          {outcome ? <ResultCard outcome={outcome} /> : <EmptyState busy={busy} />}
        </section>
      </div>
    </div>
  );
}

// --- form parts -------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = `check-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function BadgeDot({ badge }: { badge: Badge }) {
  const b = BADGE[badge];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
      <b.icon size={14} weight="fill" color={b.color} aria-hidden />
      {b.label}
    </span>
  );
}

function EmptyState({ busy }: { busy: boolean }) {
  return (
    <div className="b-card flex min-h-[18rem] flex-col items-center justify-center gap-2 p-6 text-center">
      {busy ? (
        <>
          <CircleNotchIcon size={22} weight="bold" className="animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Reading the calldata and asking the explorer about the contracts…</p>
        </>
      ) : (
        <>
          <p className="font-semibold">Nothing checked yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Paste a transaction on the left, or try one of the demo scenarios to see a green and a red result.
          </p>
        </>
      )}
    </div>
  );
}

// --- the result -------------------------------------------------------------------------

function ResultCard({ outcome }: { outcome: Outcome }) {
  const { result, source, wording } = outcome;
  const b = BADGE[result.badge];

  return (
    <article className="b-card overflow-hidden" style={{ borderColor: b.color }}>
      <div className="h-1.5" style={{ background: b.color }} aria-hidden />
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold"
            style={{ borderColor: `color-mix(in oklab, ${b.color} 55%, transparent)` }}
          >
            <b.icon size={16} weight="fill" color={b.color} aria-hidden />
            {b.label} · {b.verdict}
          </span>
          <span className="text-xs text-muted-foreground">
            {source.kind === 'scenario'
              ? 'Demo scenario · synthetic contract facts'
              : `Live · ${CHAIN_CONFIGS[source.chain].name} explorer`}
          </span>
        </div>

        <div>
          <p className="b-eyebrow">{result.headline}</p>
          <h2 className="mt-1 text-xl font-semibold leading-snug break-words">{result.story}</h2>
        </div>

        {wording && (
          <div className="rounded-xl border border-border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <SparkleIcon size={13} weight="fill" aria-hidden /> In plain words
            </p>
            <p className="mt-1 text-sm leading-relaxed">{wording}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              AI wording of the reasons below. The badge comes from code, not from the model.
            </p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold">Why</h3>
          <ul className="mt-2 space-y-2">
            {result.reasons.map((r, i) => (
              <ReasonRow key={`${r.id}-${i}`} reason={r} />
            ))}
          </ul>
        </div>

        <Facts result={result} />

        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{result.disclaimer}</p>
      </div>
    </article>
  );
}

function ReasonRow({ reason }: { reason: PreSignReason }) {
  const l = LEVEL[reason.level];
  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex items-start gap-2">
        <l.icon size={16} weight="fill" color={l.color} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            <span className="sr-only">{l.label}: </span>
            {reason.title}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground break-words">{reason.detail}</p>
          {reason.evidence.length > 0 && (
            <details className="mt-1.5 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Evidence</summary>
              <ul className="b-num mt-1 space-y-0.5 break-all text-muted-foreground">
                {reason.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

function Facts({ result }: { result: PreSignResult }) {
  const rows: Array<[string, ReactNode]> = [
    ['Function', result.kind === 'unreadable' ? 'Could not be read' : result.decoded.methodName],
    ['Target', <Address key="t" address={result.target.contractAddress} facts={describeFacts(result.target)} />],
  ];
  if (result.approval) {
    rows.push([
      'Spender',
      <Address
        key="s"
        address={result.approval.spender}
        facts={result.spender ? describeFacts(result.spender) : 'Not looked up: revoking is safe whoever the spender is'}
      />,
    ]);
    rows.push(['Allowance', result.approval.isUnlimited ? 'Unlimited' : `${result.approval.amount.toLocaleString('en-US')} base units`]);
  }
  if (result.transfer) {
    if (result.transfer.from) rows.push(['From', <Address key="f" address={result.transfer.from} />]);
    rows.push(['Recipient', <Address key="r" address={result.transfer.recipient} />]);
    rows.push(['Amount', `${result.transfer.amount.toLocaleString('en-US')} base units`]);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold">What was read</h3>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Address({ address, facts }: { address: string; facts?: string }) {
  return (
    <span className="block min-w-0">
      <span className="b-num block break-all text-[13px]">{address}</span>
      {facts && <span className="block text-xs text-muted-foreground">{facts}</span>}
    </span>
  );
}

/** One line of explorer facts. Unknown is said as unknown, never as a reassuring no. */
function describeFacts(risk: ContractPermissionRisk): string {
  const intel = risk.intel;
  if (!intel || intel.status === 'unavailable') {
    return `Not checked: ${intel?.unavailableReason ?? 'the explorer did not respond'}`;
  }
  if (intel.isContract === false) return 'A wallet: no contract code';
  const parts = [
    intel.isVerified === true ? 'Verified source' : intel.isVerified === false ? 'Unverified source' : 'Verification unknown',
    intel.contractName ? `“${intel.contractName}”` : null,
    intel.ageDays !== null ? `deployed ${intel.ageDays} day(s) ago` : 'deployment date unknown',
    intel.isProxy ? 'upgradeable proxy' : null,
  ];
  return parts.filter(Boolean).join(' · ');
}
