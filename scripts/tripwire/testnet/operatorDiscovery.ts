// Discovery hands proof locators to the signing operator (H3: "handing discovery
// to signing"). Locators are hints only: the operator's source adapter fetches
// and authenticates the full burn and mint receipts before any ALLOW, exactly as
// for a hand-written manifest. The discovery cursor lives in the operator's own
// journal and is committed only after the round's operator work and a final
// canonical check, so a crash or a reorg re-scans rather than skipping.
import type { Hex } from 'viem';
import type { OperatorStore } from '../store.js';
import { parseObserverManifest, type OperatorManifest } from './cctpManifest.js';
import { discoverCctpRequests, DiscoveryStoppedError, type DiscoveryCoverage } from './cctpDiscovery.js';

type Feeds = Parameters<typeof discoverCctpRequests>[1];

export function operatorDiscovery(input: { manifest: unknown; feeds: Feeds; starts: { source: bigint; destination: bigint }; signal: AbortSignal }) {
  const manifest = parseObserverManifest(input.manifest);
  if ((manifest.version !== 3 && manifest.version !== 4) || manifest.requests.length) {
    throw new DiscoveryStoppedError('Operator discovery requires an empty customer-payment manifest (version 3 or 4).');
  }
  let requests: OperatorManifest['requests'] = [];
  return {
    manifest,
    /** The operator's source-proof locator: whatever the last completed scan found. */
    locate: async (messageId: Hex) => requests.find((r) => r.messageId === messageId)?.proof ?? null,
    /** Scan, run `work` with the new locators, re-check the scanned history, then commit the cursor. */
    async round<T>(store: OperatorStore, work: () => Promise<T>): Promise<{ result: T; coverage: DiscoveryCoverage }> {
      const found = await discoverCctpRequests(manifest, input.feeds, input.starts, input.signal, { resume: store.loadDiscovery() });
      requests = found.manifest.requests;
      const result = await work();
      await found.assertCanonical();
      if (found.state) store.saveDiscovery(found.state);
      return { result, coverage: found.metadata };
    },
  };
}
