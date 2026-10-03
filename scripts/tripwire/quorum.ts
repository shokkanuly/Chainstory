// scripts/tripwire/quorum.ts
//
// Threshold attestation (ADR-021). The guardian's oracle may be a TripwireQuorum
// contract: a k-of-n attestor set answering ERC-1271. Each member independently
// decides whether to sign the full typed request, so a member can refuse what
// its own verification does not support. The aggregator only collects, checks
// and orders signatures; it holds no authority of its own.
//
// `quorumAccount` presents the set as a viem LocalAccount whose address is the
// quorum contract, so the attestor and release reviews use it unchanged.
import {
  concat, hashTypedData, recoverAddress, type Hex, type LocalAccount, type TypedDataDefinition,
} from 'viem';
import { toAccount } from 'viem/accounts';
import { z } from 'zod';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Hex);
const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((v) => v.toLowerCase() as Hex);
/** Mirrors TripwireQuorum.MAX_SIGNERS. */
export const MAX_QUORUM_SIGNERS = 16;

export const quorumConfigSchema = z.object({
  address: addressSchema,
  signers: z.array(addressSchema).min(1).max(MAX_QUORUM_SIGNERS),
  threshold: z.number().int().positive(),
}).strict().superRefine((c, ctx) => {
  if (new Set(c.signers).size !== c.signers.length) ctx.addIssue({ code: 'custom', message: 'Duplicate quorum signer.' });
  // The contract's honest-majority rule: two disjoint groups can never both sign.
  if (c.threshold > c.signers.length || c.threshold * 2 <= c.signers.length) {
    ctx.addIssue({ code: 'custom', message: 'Quorum threshold must be a strict majority of its signers.' });
  }
});
export type QuorumConfig = z.output<typeof quorumConfigSchema>;

export type QuorumRequest = TypedDataDefinition;

/** One independent attestor. Returns null to refuse; a refusal is never an error. */
export interface QuorumMember {
  address: Hex;
  sign(request: QuorumRequest): Promise<Hex | null>;
}

export class QuorumUnavailableError extends Error {
  constructor(readonly collected: number, readonly threshold: number, readonly refusals: number) {
    super(`Quorum not met: ${collected} of ${threshold} required attestor signatures (${refusals} refused or failed).`);
    this.name = 'QuorumUnavailableError';
  }
}

/**
 * A member backed by a local key. `approve` is the member's own policy: an
 * independent attestor re-runs its own source verification before agreeing.
 */
export function localMember(account: LocalAccount, approve: (request: QuorumRequest) => Promise<boolean> | boolean = () => true): QuorumMember {
  return {
    address: account.address,
    async sign(request) {
      if (!(await approve(request))) return null;
      return account.signTypedData(request);
    },
  };
}

/**
 * Collect signatures for one digest. Every returned signature is recovered and
 * must belong to the member that produced it; failures and refusals only
 * reduce the count. Output is ordered ascending by signer, as the contract requires.
 */
export async function collectQuorumSignature(config: QuorumConfig, members: QuorumMember[], request: QuorumRequest): Promise<Hex> {
  const cfg = quorumConfigSchema.parse(config);
  const digest = hashTypedData(request);
  const allowed = new Set(cfg.signers);
  const seen = new Set<Hex>();
  const outcomes = await Promise.allSettled(members.map(async (member) => {
    const address = addressSchema.parse(member.address);
    if (!allowed.has(address) || seen.has(address)) return null;
    seen.add(address);
    const raw = await member.sign(request);
    if (raw === null) return null;
    const signature = signatureSchema.parse(raw);
    if ((await recoverAddress({ hash: digest, signature })).toLowerCase() !== address) return null;
    return { address, signature };
  }));
  const valid = outcomes.flatMap((o) => (o.status === 'fulfilled' && o.value ? [o.value] : []));
  if (valid.length < cfg.threshold) throw new QuorumUnavailableError(valid.length, cfg.threshold, members.length - valid.length);
  valid.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  // Exactly threshold: extra signatures add gas, not security.
  return concat(valid.slice(0, cfg.threshold).map((v) => v.signature));
}

/** Combine signatures gathered elsewhere (e.g. from remote attestors) into the contract's format. */
export async function combineQuorumSignatures(config: QuorumConfig, request: QuorumRequest, parts: Array<{ signer: string; signature: string }>): Promise<Hex> {
  return collectQuorumSignature(config, parts.map((p) => ({
    address: p.signer as Hex, sign: async () => p.signature as Hex,
  })), request);
}

/** The quorum as an account: its address is the contract the guardian trusts as `oracle`. */
export function quorumAccount(config: QuorumConfig, members: QuorumMember[]): LocalAccount {
  const cfg = quorumConfigSchema.parse(config);
  const refuse = () => { throw new Error('A quorum signs typed attestations only; it cannot sign messages or transactions.'); };
  return toAccount({
    address: cfg.address,
    signMessage: async () => refuse(),
    signTransaction: async () => refuse(),
    signTypedData: async (request) => collectQuorumSignature(cfg, members, request as QuorumRequest),
  });
}

export const UPDATE_SIGNERS_TYPES = {
  UpdateSigners: [
    { name: 'signers', type: 'address[]' },
    { name: 'threshold', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
  ],
} as const;

/** The typed request the current set signs to rotate membership (TripwireQuorum.updateSigners). */
export function updateSignersRequest(quorum: Hex, chainId: number, next: { signers: Hex[]; threshold: bigint; epoch: bigint }): QuorumRequest {
  const signers = [...next.signers].map((s) => addressSchema.parse(s)).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return {
    domain: { name: 'TripwireQuorum', version: '1', chainId, verifyingContract: quorum },
    types: UPDATE_SIGNERS_TYPES, primaryType: 'UpdateSigners',
    message: { signers, threshold: next.threshold, epoch: next.epoch },
  } as QuorumRequest;
}
