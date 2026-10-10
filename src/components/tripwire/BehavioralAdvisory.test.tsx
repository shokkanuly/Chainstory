import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BehavioralAdvisory from './BehavioralAdvisory';
import { parseOperationsReport } from '../../chains/evm/operations';
import sample from '../../testing/fixtures/tripwire/operations-behavioral-synthetic.json';
import { projectBehavioralAdvisory } from '../../tripwire/behavioralShadow';

const advisory = parseOperationsReport(sample).payments[0].behavioral;
const captured = sample.results[0].behavioral.assessment.capturedAt;
const checked = sample.results[0].behavioral.assessment.checkedAt;
const render = (now = checked) => renderToStaticMarkup(<BehavioralAdvisory advisory={advisory} nowMs={now * 1000} />);
describe('behavioral advisory read-only view', () => {
  it('labels synthetic scores as advisory indicators with missing facts and no approval controls', () => {
    const html = render(); expect(html).toContain('Advisory only'); expect(html).toContain('do not approve a payment');
    expect(html).toContain('Existing payout checks remain in force'); expect(html).toContain('Synthetic example');
    expect(html).toContain('Indicator 0.25 / 1'); expect(html).toContain('Indicator 0.10 / 1');
    expect(html).toContain('Signal was not supplied'); expect(html).toContain('not probabilities of loss');
    expect(html).not.toMatch(/<button|<input|<a |ALLOW|Signature/);
  });
  it('shows unavailable explicitly for old reports and observers with no assessment', () => {
    expect(renderToStaticMarkup(<BehavioralAdvisory nowMs={checked * 1000} />)).toContain('does not include behavioral signals');
    expect(renderToStaticMarkup(<BehavioralAdvisory advisory={projectBehavioralAdvisory()} nowMs={checked * 1000} />)).toContain('did not calculate behavioral signals');
  });
  it('suppresses aged scores as the page clock advances without resetting original capture', () => {
    expect(render(captured + 300)).toContain('Indicator 0.25');
    const old = render(captured + 301); expect(old).not.toMatch(/Indicator [0-9]/); expect(old).toContain('Assessment is too old');
    expect(old).toContain(new Date(captured * 1000).toLocaleString());
  });
  it.each([checked - 1, NaN])('suppresses scores when the browser clock is behind the export or invalid (%s)', (now) => {
    const html = render(now); expect(html).not.toMatch(/Indicator [0-9]/); expect(html).toContain('Check assessment clock');
  });
  it.each(['stale', 'future'] as const)('never revives scores already suppressed as %s at export', (kind) => {
    const original = { transfer: { route: sample.route, hash: sample.results[0].messageId }, signals: [{ id: 'size_vs_baseline', score: 0.25 }] };
    const a = projectBehavioralAdvisory(original, { route: sample.route, transferId: original.transfer.hash,
      capturedAt: kind === 'stale' ? checked - 301 : checked + 1, checkedAt: checked, synthetic: true });
    const html = renderToStaticMarkup(<BehavioralAdvisory advisory={a} nowMs={(checked + 20) * 1000} />);
    expect(html).not.toMatch(/Indicator [0-9]/); expect(html).toContain(kind === 'stale' ? 'Too old' : 'Check assessment clock');
  });
});
