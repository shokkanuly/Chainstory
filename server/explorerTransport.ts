// server/explorerTransport.ts
//
// The explorer proxy, called in-process. Retold's contract checks
// (src/services/contractIntel.ts) reach the explorer through apiClient's
// transport, which in the browser is HTTP to /api/explorer. A Node process —
// the Tripwire watcher — has no /api to call, so it hands apiClient this
// instead: the very handler /api/explorer runs, with the same allowlist and
// validation, and the key read from the process environment.
//
//   import { setExplorerTransport } from '../../src/services/apiClient.js';
//   setExplorerTransport(inProcessExplorer(process.env));
//
// Structurally an `ExplorerTransport` (src/services/apiClient.ts); a test there
// pins the two together.

import { handleExplorer } from './explorerHandler.js';

export function inProcessExplorer(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch
): (chainId: string, params: Record<string, string>) => Promise<{ status: number; json(): Promise<unknown> }> {
  return async (chainId, params) => {
    const { status, body } = await handleExplorer(
      { method: 'GET', query: { ...params, chain: chainId } },
      env,
      // The proxy's per-IP limiter still applies, to this process as one client.
      'tripwire-watcher',
      fetchImpl
    );
    return { status, json: async () => body };
  };
}
