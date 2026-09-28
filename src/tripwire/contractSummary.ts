// src/tripwire/contractSummary.ts
//
// Retold's contract facts (services/contractIntel.ts) in the shape the risk
// scorer takes. Pure: the caller fetches the facts with fetchContractIntel —
// in the browser over /api, in Node through server/explorerTransport.ts — and
// the scorer never touches the network.

import type { ContractIntel } from '../services/contractIntel.js';
import type { ContractRiskSummary } from './types.js';

/** null for a wallet: there is no contract to judge. */
export function summariseContract(intel: ContractIntel): ContractRiskSummary | null {
  if (intel.isContract === false) return null;

  const caps = intel.adminCapabilities;
  // Replaceable if the explorer says proxy, or the verified ABI has an upgrade
  // function. Only "not replaceable" when both were actually checked.
  const isUpgradeable =
    intel.isProxy === true || caps?.canUpgrade === true
      ? true
      : intel.isProxy === false && caps !== null
        ? false
        : null;

  return {
    address: intel.address,
    isVerified: intel.isVerified,
    ageDays: intel.ageDays,
    isUpgradeable,
    adminFunctions: caps && (caps.canPause || caps.canMint) ? caps.evidence : [],
  };
}
