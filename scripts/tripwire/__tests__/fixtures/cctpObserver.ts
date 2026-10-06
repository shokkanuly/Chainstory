// Accepted synthetic product/runtime/receipts on the discovery fixture's linked headers.
import { keccak256, stringToHex, zeroAddress } from 'viem';
import { vi } from 'vitest';
import { actors } from '../../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../../src/chains/evm/registry/cctp.js';
import { cctpBindings } from '../../testnet/cctpBindings.js';
import type { CctpAuditReader } from '../../testnet/cctpAudit.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../../testnet/artifactAcceptance.js';
import { discoveryFixture } from './cctpDiscovery.js';

export function observerFixture() {
  const d = discoveryFixture(), f = d.f, manifest = { ...d.manifest, operator: actors.oracle.address.toLowerCase() };
  f.source.port.getBlock = d.source.client.pub.getBlock;
  const facts: Record<string, unknown> = { ...cctpBindings(manifest.vault), REVIEW_FORMAT_VERSION: 3n, PAYMENT_ESCROW_VERSION: 1n,
    policyAuthority: manifest.payment.authority, authorizedSourceSender: manifest.payment.sourceSender, recoveryRecipient: manifest.payment.returnRecipient, recoveryDelay: 3600n,
    token: route.destination.usdc, guardian: manifest.guardian, routeId: keccak256(stringToHex(route.id)), MAX_REVIEW_TTL: 600n, RELEASE_POLICY_VERSION: 2n,
    releases: [f.release.recipient, f.release.amount, 0, 0n, zeroAddress, 0n, 0], credits: [manifest.payment.returnRecipient, f.intent.operationId, f.intent.policyHash, 0n, false],
    policyVersion: 1n, policyHash: f.intent.policyHash, paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n],
    approvedPolicyVersion: 0n, reviewedPolicyVersion: 0n, paymentsPaused: false, permittedRecipients: true, paymentDelayUntil: 0n, releaseDelayUntil: 0n };
  const reader: CctpAuditReader = { ...f.destination.port, getBlock: d.destination.client.pub.getBlock,
    readVault: vi.fn(async (name) => facts[name]),
    readCode: vi.fn(async (address) => address === manifest.guardian ? expectedGuardianRuntime(manifest.guardian) : expectedPaymentRuntime(manifest.vault, manifest.guardian, manifest.payment)),
    readGuardian: vi.fn(async (name: Parameters<CctpAuditReader['readGuardian']>[0]) => ({ owner: manifest.vault, oracle: manifest.operator, GUARDIAN_POLICY_VERSION: 2n,
      isProtected: true, currentTier: 0, getRoute: { windowSeconds: 3600n, cap: 10_000_000n, tierExpiresAt: 0n } })[name]) };
  return { ...d, manifest, reader, facts };
}
