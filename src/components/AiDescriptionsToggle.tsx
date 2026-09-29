// src/components/AiDescriptionsToggle.tsx
//
// The opt-in switch for AI descriptions (docs/06 §2): off by default, a
// visible state, and a preview of exactly what is sent, built by the same
// function that builds the request.

import { useState } from 'react';
import type { RawTransaction } from '../types';
import { buildDescribePayload, isAiDescriptionsEnabled, setAiDescriptionsEnabled } from '../services/aiDescriptions';

// An illustrative swap, only to show the shape of what is sent.
const EXAMPLE_TX = {
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
  input: '0x5ae401dc',
  functionName: 'multicall(bytes[] data)',
  isError: '0',
} as RawTransaction;

export default function AiDescriptionsToggle() {
  const [on, setOn] = useState(isAiDescriptionsEnabled);
  const toggle = () => {
    setAiDescriptionsEnabled(!on);
    setOn(!on);
  };
  const example = buildDescribePayload(EXAMPLE_TX, 'trade', 1.5, 5100);

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            AI descriptions <span className="ml-1 text-xs font-normal text-muted-foreground">(Google Gemini)</span>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {on
              ? 'On: a short summary of each transaction is sent through our server to Gemini, which words its description.'
              : 'Off: descriptions are written on your device, and nothing is sent to an AI.'}{' '}
            Applies to your next analysis.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI descriptions"
          onClick={toggle}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-secondary"
        >
          <span
            aria-hidden
            className="relative inline-block h-4 w-7 rounded-full transition-colors"
            style={{ background: on ? 'var(--b-ink)' : 'var(--b-line-strong)' }}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
              style={{ left: on ? '0.875rem' : '0.125rem' }}
            />
          </span>
          {on ? 'On' : 'Off'}
        </button>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">What is sent</summary>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          Per transaction: its category, ETH and USD value, method and token names, whether it failed, and both addresses
          shortened to their first 6 and last 4 characters. Never your full address, your labels or your notes. For
          example, a swap:
        </p>
        <pre className="b-num mt-1.5 overflow-x-auto rounded-lg bg-secondary/60 p-2 text-[11px] leading-snug">
          {JSON.stringify(example, null, 2)}
        </pre>
      </details>
    </div>
  );
}
