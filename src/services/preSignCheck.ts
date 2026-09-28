// src/services/preSignCheck.ts
//
// "Check before you sign": paste the calldata and target of a pending EVM
// transaction, get a green / yellow / red badge with the reasons behind it.
//
//   decodeAbiData → simulateTransactionPayload → explainContractPermissionRisk
//   → counterparty check → badge
//
// Advisory and read-only (I1). Nothing here signs, sends or connects a wallet,
// and src/testing/noSigning.test.ts fails the build if anything reachable from
// the /check page starts to.
//
// The badge comes from code, from facts the explorer returned or the calldata
// states. It never comes from an LLM (I5, I9); any AI wording is layered on
// afterwards and only rephrases the reasons below.
//
// The rule that decides most verdicts: an approval's risk lives in the
// SPENDER, a calldata argument, not in `to`, which is the token. So the
// spender's facts are fetched, and the token's admin powers are not held
// against an approval or a transfer: they are the same whether you sign or not.

import { formatEther } from 'viem';
import type { B2BSimulationResult, ChainId } from '../types';
import {
  APPROVE_SELECTOR,
  TRANSFER_FROM_SELECTOR,
  TRANSFER_SELECTOR,
  decodeAbiData,
  decodeApproval,
  decodeTokenTransfer,
  type DecodedAbiResult,
  type DecodedApproval,
  type DecodedTokenTransfer,
} from './abiDecoder';
import { simulateTransactionPayload } from './b2bSimulation';
import { fetchContractIntel, isAddressShaped, type ContractIntel } from './contractIntel';
import { explainContractIntel, type ContractPermissionRisk } from './contractRiskExplainer';
import { FLAG_LIST_NAME, lookupFlaggedAddress } from './preventiveScamScanner';

/** A contract younger than this is "fresh". Same cut-off as the token scanner. */
export const FRESH_CONTRACT_DAYS = 30;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type Badge = 'green' | 'yellow' | 'red';

/**
 * Every reason the check can give. A closed set, so the optional AI wording
 * (server/checkPhrasing.ts) receives identifiers, never free text or numbers.
 */
export const REASON_IDS = [
  'invalid_target',
  'malformed_calldata',
  'unknown_function',
  'flagged_address',
  'allowance_revocation',
  'allowance_limited',
  'unlimited_allowance',
  'spender_unchecked',
  'spender_eoa',
  'spender_unverified',
  'spender_fresh',
  'spender_upgradeable',
  'spender_verified',
  'token_transfer',
  'recipient_is_token',
  'recipient_zero',
  'native_transfer',
  'native_value',
  'target_no_code',
  'target_unchecked',
  'target_unverified',
  'target_fresh',
  'target_upgradeable',
  'target_verified',
] as const;
export type ReasonId = (typeof REASON_IDS)[number];

export interface PreSignReason {
  id: ReasonId;
  /** info: context only · warning: makes the badge yellow · critical: makes it red. */
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  /** The facts behind the reason (I9): what was read, and from where. */
  evidence: string[];
}

export interface PreSignInput {
  /** The transaction's `to`: for a token call, the token contract. */
  to: string;
  /** Calldata hex. Empty or '0x' is a plain ETH transfer. */
  data: string;
  /** Wei. */
  value?: bigint;
  chainId?: ChainId;
}

export type CallKind = 'native' | 'approve' | 'token_transfer' | 'contract_call' | 'unreadable';

export interface PreSignResult {
  badge: Badge;
  kind: CallKind;
  /** A short label for the kind of transaction. */
  headline: string;
  /** One deterministic sentence: what signing does. */
  story: string;
  reasons: PreSignReason[];
  decoded: DecodedAbiResult;
  approval: DecodedApproval | null;
  transfer: DecodedTokenTransfer | null;
  simulation: B2BSimulationResult;
  /** The contract at `to`. */
  target: ContractPermissionRisk;
  /** The approval's spender; null unless this grants an allowance. */
  spender: ContractPermissionRisk | null;
  disclaimer: string;
}

export interface PreSignDeps {
  /** Explorer facts for an address. Defaults to the live explorer; tests and demo scenarios pass recorded facts. */
  fetchIntel?: (address: string, chainId: ChainId) => Promise<ContractIntel>;
}

export const PRE_SIGN_DISCLAIMER =
  'Advisory only. Retold never connects to your wallet and cannot sign or send anything. ' +
  'This reads the calldata and public explorer facts; it is not an audit, and a clean result is not a guarantee.';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
/** Raw token base units, digit-grouped. Exact: formats the bigint, never a float (I3). */
const units = (amount: bigint) => amount.toLocaleString('en-US');

/** Lower-case, 0x-prefixed calldata, or null when it is not hex bytes. */
export function normaliseCalldata(raw: string): string | null {
  const trimmed = (raw || '').trim().toLowerCase();
  if (trimmed === '' || trimmed === '0x') return '0x';
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  return /^0x(?:[0-9a-f]{2})+$/.test(hex) ? hex : null;
}

function unavailableIntel(address: string, reason: string): ContractIntel {
  return {
    address,
    status: 'unavailable',
    unavailableReason: reason,
    isContract: null,
    isVerified: null,
    contractName: null,
    isProxy: null,
    implementationAddress: null,
    createdAt: null,
    ageDays: null,
    adminCapabilities: null,
  };
}

async function readFacts(
  address: string,
  chainId: ChainId,
  fetchIntel: NonNullable<PreSignDeps['fetchIntel']>
): Promise<ContractPermissionRisk> {
  try {
    return explainContractIntel(await fetchIntel(address, chainId));
  } catch (err) {
    // Unknown input never throws (I8); an unreachable explorer is "unchecked".
    const reason = err instanceof Error ? err.message : 'The explorer could not be reached';
    return explainContractIntel(unavailableIntel(address, reason));
  }
}

/** Run the check. Never throws: every failure becomes a reason. */
export async function checkBeforeSign(input: PreSignInput, deps: PreSignDeps = {}): Promise<PreSignResult> {
  const fetchIntel = deps.fetchIntel ?? fetchContractIntel;
  const chainId = input.chainId ?? 'ethereum';
  const to = (input.to || '').trim().toLowerCase();
  const value = input.value ?? 0n;
  const normalised = normaliseCalldata(input.data);
  const data = normalised ?? '0x';

  const decoded = decodeAbiData(data);
  const approval = decodeApproval(data);
  const transfer = decodeTokenTransfer(data);
  const simulation = simulateTransactionPayload({ from: '', to, value: value.toString(), data, chainId });

  const validTarget = isAddressShaped(to);
  // A revocation is safe whoever the spender is, so it costs no lookup.
  const grantsAllowance = approval !== null && !approval.isRevocation;
  const [target, spender] = await Promise.all([
    validTarget
      ? readFacts(to, chainId, fetchIntel)
      : Promise.resolve(explainContractIntel(unavailableIntel(to, 'Not a valid 42-character EVM address'))),
    grantsAllowance ? readFacts(approval.spender, chainId, fetchIntel) : Promise.resolve(null),
  ]);

  const kind: CallKind =
    normalised === null || (!approval && !transfer && isTokenSelector(decoded.signature))
      ? 'unreadable'
      : data === '0x'
        ? 'native'
        : approval
          ? 'approve'
          : transfer
            ? 'token_transfer'
            : 'contract_call';

  const reasons: PreSignReason[] = [];
  const add = (r: PreSignReason) => reasons.push(r);

  if (!validTarget) {
    add({
      id: 'invalid_target',
      level: 'warning',
      title: 'The target is not an address',
      detail: 'An EVM address is 42 characters: "0x" and 40 hexadecimal digits. Nothing could be checked against it.',
      evidence: [`target: "${to.slice(0, 64)}"`],
    });
  }

  if (kind === 'unreadable') {
    add({
      id: 'malformed_calldata',
      level: 'warning',
      title: 'The calldata could not be read',
      detail:
        normalised === null
          ? 'Calldata is hexadecimal bytes, optionally prefixed with 0x. This input is not.'
          : `It starts with the ${decoded.methodName.split('(')[0]} selector, but its arguments are missing or malformed.`,
      evidence: normalised === null ? ['not an even-length hex string'] : [`selector ${decoded.signature}`],
    });
  }

  flagCounterparties(to, approval, transfer, add);

  if (kind === 'approve' && approval) {
    assessApproval(to, approval, spender, add);
    flagNoCode(target, add);
  }
  if (kind === 'token_transfer' && transfer) assessTransfer(to, transfer, target, add);
  if (kind === 'native' && validTarget) assessNative(target, value, add);
  if (kind === 'contract_call') assessContractCall(decoded, target, add);

  if (value > 0n && kind !== 'native') {
    add({
      id: 'native_value',
      level: 'info',
      title: 'It also sends ETH',
      detail: `Signing sends ${formatEther(value)} ETH to ${short(to)} along with the call.`,
      evidence: [`value: ${value.toString()} wei`],
    });
  }

  const badge: Badge = reasons.some((r) => r.level === 'critical')
    ? 'red'
    : reasons.some((r) => r.level === 'warning')
      ? 'yellow'
      : 'green';

  return {
    badge,
    kind,
    // The simulation labels by the target's address alone, so it calls any
    // call to a DEX router a swap; an unrecognised function is not one.
    headline:
      kind === 'unreadable'
        ? 'Unreadable transaction'
        : kind === 'contract_call' && decoded.categoryHint === 'unknown'
          ? 'Unrecognised contract call'
          : simulation.headline,
    story: tellStory(kind, to, value, decoded, approval, transfer),
    reasons: sortReasons(reasons),
    decoded,
    approval,
    transfer,
    simulation,
    target,
    spender,
    disclaimer: PRE_SIGN_DISCLAIMER,
  };
}

function isTokenSelector(selector: string): boolean {
  return selector === APPROVE_SELECTOR || selector === TRANSFER_SELECTOR || selector === TRANSFER_FROM_SELECTOR;
}

// --- the counterparty check -------------------------------------------------------

function flagCounterparties(
  to: string,
  approval: DecodedApproval | null,
  transfer: DecodedTokenTransfer | null,
  add: (r: PreSignReason) => void
) {
  const parties: Array<[role: string, address: string | null | undefined]> = [
    ['The target contract', to],
    ['The spender', approval?.spender],
    ['The recipient', transfer?.recipient],
    ['The account debited', transfer?.from],
  ];
  const seen = new Set<string>();
  for (const [role, address] of parties) {
    if (!address || seen.has(address)) continue;
    seen.add(address);
    const hit = lookupFlaggedAddress(address);
    if (!hit) continue;
    add({
      id: 'flagged_address',
      level: 'critical',
      title: `${role} appears on a phishing list`,
      detail: `${role}, ${short(address)}, appears on the ${FLAG_LIST_NAME} as "${hit.name}".`,
      evidence: [`list: ${FLAG_LIST_NAME}`, `entry: ${hit.name}`, `address: ${address}`],
    });
  }
}

// --- approve(spender, amount) --------------------------------------------------------

/** What makes a spender unsafe to hand an unlimited allowance to. */
function spenderConcerns(spender: ContractPermissionRisk): ReasonId[] {
  const intel = spender.intel;
  const concerns: ReasonId[] = [];
  if (!intel || intel.status === 'unavailable') return ['spender_unchecked'];
  if (intel.isContract === false) return ['spender_eoa'];
  if (intel.isVerified === false) concerns.push('spender_unverified');
  if (intel.ageDays !== null && intel.ageDays < FRESH_CONTRACT_DAYS) concerns.push('spender_fresh');
  return concerns;
}

function assessApproval(
  token: string,
  approval: DecodedApproval,
  spender: ContractPermissionRisk | null,
  add: (r: PreSignReason) => void
) {
  const who = short(approval.spender);

  if (approval.isRevocation) {
    add({
      id: 'allowance_revocation',
      level: 'info',
      title: 'This revokes an allowance',
      detail: `It sets ${who}'s allowance on this token to zero. Revoking takes a permission away; it cannot give one.`,
      evidence: ['approve amount argument: 0'],
    });
    return;
  }

  const concerns = spender ? spenderConcerns(spender) : ['spender_unchecked' as const];
  const flagged = lookupFlaggedAddress(approval.spender) !== null;

  if (approval.isUnlimited) {
    // Unlimited on its own is common (DEX routers ask for it). Unlimited to a
    // spender that is fresh, unverified, a plain wallet, unchecked or flagged
    // is the shape approval phishing takes — that combination is the red.
    const severe = concerns.length > 0 || flagged;
    add({
      id: 'unlimited_allowance',
      level: severe ? 'critical' : 'warning',
      title: 'Unlimited allowance',
      detail:
        `${who} could move every unit of this token you hold, now or at any later time, until you revoke it.` +
        (severe
          ? ' Granting that to a spender with the concerns below matches a pattern associated with approval phishing.'
          : ' Approve only the amount this transaction needs if the app allows it.'),
      evidence: [`approve amount argument: ${approval.amount.toString()} (≥ 2^255 is treated as unlimited)`],
    });
  } else {
    add({
      id: 'allowance_limited',
      level: 'info',
      title: 'A limited allowance',
      detail: `${who} could spend up to ${units(approval.amount)} base units of the token at ${short(token)}. Token decimals are not looked up.`,
      evidence: [`approve amount argument: ${approval.amount.toString()}`],
    });
  }

  if (!spender) return;
  const intel = spender.intel;
  const source = 'block explorer';

  for (const concern of concerns) {
    if (concern === 'spender_unchecked') {
      add({
        id: 'spender_unchecked',
        level: 'warning',
        title: "The spender couldn't be checked",
        detail: `${intel?.unavailableReason ?? 'The explorer did not respond'}. Treat ${who} as unverified; this is not a clean result.`,
        evidence: [`${source}: unavailable`],
      });
    } else if (concern === 'spender_eoa') {
      add({
        id: 'spender_eoa',
        level: 'warning',
        title: 'The spender is a wallet, not a contract',
        detail: `There is no contract code at ${who}. Approving a plain wallet, rather than an app's contract, matches a pattern associated with approval phishing.`,
        evidence: [`${source}: eth_getCode returned no code`],
      });
    } else if (concern === 'spender_unverified') {
      add({
        id: 'spender_unverified',
        level: 'warning',
        title: "The spender's source code isn't verified",
        detail: `Nobody can read what ${who} will do with the allowance: its source is not published on the explorer.`,
        evidence: [`${source}: getsourcecode returned no source`],
      });
    } else if (concern === 'spender_fresh' && intel?.ageDays !== null && intel?.ageDays !== undefined) {
      add({
        id: 'spender_fresh',
        level: 'warning',
        title: 'The spender is brand new',
        detail: `${who} was deployed ${intel.ageDays} day(s) ago. Contracts that ask for allowances days after deployment have no track record.`,
        evidence: [`${source}: contract creation ${intel.createdAt?.toISOString().slice(0, 10) ?? 'date'} (${intel.ageDays} day(s) ago)`],
      });
    }
  }

  if (spender.canUpgradeCode) {
    add({
      id: 'spender_upgradeable',
      level: 'info',
      title: "The spender's code can be replaced",
      detail: `${who} is upgradeable: whoever controls it can change what it does with your allowance later.`,
      evidence: spender.evidence.length ? spender.evidence.map((fn) => `ABI function: ${fn}`) : [`${source}: flagged as a proxy`],
    });
  }

  if (concerns.length === 0 && intel?.isVerified) {
    add({
      id: 'spender_verified',
      level: 'info',
      title: 'The spender is a verified contract',
      detail:
        `${spender.contractName ? `"${spender.contractName}"` : who} has published source` +
        (intel.ageDays !== null ? ` and was deployed ${intel.ageDays} day(s) ago.` : '.') +
        ' That is a reading of public facts, not an audit.',
      evidence: [`${source}: verified source`, ...(intel.ageDays !== null ? [`${source}: ${intel.ageDays} day(s) old`] : [])],
    });
  }
}

// --- transfer(to, amount) / transferFrom(from, to, amount) -----------------------------

function assessTransfer(
  token: string,
  transfer: DecodedTokenTransfer,
  target: ContractPermissionRisk,
  add: (r: PreSignReason) => void
) {
  add({
    id: 'token_transfer',
    level: 'info',
    title: transfer.from ? 'Moves tokens from another account' : 'Sends tokens you hold',
    detail:
      `${units(transfer.amount)} base units of the token at ${short(token)} go to ${short(transfer.recipient)}` +
      (transfer.from ? `, taken from ${short(transfer.from)} under an allowance it gave.` : '.') +
      ' Token decimals are not looked up.',
    evidence: [`recipient argument: ${transfer.recipient}`, `amount argument: ${transfer.amount.toString()}`],
  });

  if (transfer.recipient === token) {
    add({
      id: 'recipient_is_token',
      level: 'warning',
      title: "The recipient is the token's own contract",
      detail: 'Tokens sent to their own contract address are usually lost for good: most tokens cannot send them back.',
      evidence: [`recipient argument equals the target: ${token}`],
    });
  } else if (transfer.recipient === ZERO_ADDRESS) {
    add({
      id: 'recipient_zero',
      level: 'warning',
      title: 'The recipient is the zero address',
      detail: 'Nobody holds the key to the zero address. Tokens sent there are gone.',
      evidence: [`recipient argument: ${ZERO_ADDRESS}`],
    });
  }

  flagNoCode(target, add);
}

// --- plain ETH transfers and other contract calls ---------------------------------------

function flagNoCode(target: ContractPermissionRisk, add: (r: PreSignReason) => void) {
  if (target.intel?.isContract !== false) return;
  add({
    id: 'target_no_code',
    level: 'warning',
    title: 'There is no contract at the target',
    detail: `${short(target.contractAddress)} is a plain wallet, so this call does nothing but send any ETH attached. Check that the target is the token or app, and not the recipient.`,
    evidence: ['block explorer: eth_getCode returned no code'],
  });
}

function assessNative(target: ContractPermissionRisk, value: bigint, add: (r: PreSignReason) => void) {
  const intel = target.intel;
  const toWallet = intel?.isContract === false;
  add({
    id: 'native_transfer',
    level: 'info',
    title: toWallet ? 'A plain ETH transfer to a wallet' : 'Sends ETH with no function call',
    detail: `${formatEther(value)} ETH goes to ${short(target.contractAddress)}.${toWallet ? '' : ' If that is a contract, its code decides what happens to it.'}`,
    evidence: [`value: ${value.toString()} wei`, 'calldata: empty'],
  });
  // Unchecked reads as info here, not a warning: the only thing at stake is the
  // ETH the user already chose to send.
  if (!toWallet) assessTargetContract(target, add, false);
}

function assessContractCall(decoded: DecodedAbiResult, target: ContractPermissionRisk, add: (r: PreSignReason) => void) {
  if (decoded.categoryHint === 'unknown') {
    add({
      id: 'unknown_function',
      level: 'warning',
      title: "This function isn't recognised",
      detail: `The check has no signature for selector ${decoded.signature}, so it cannot tell you what signing does.`,
      evidence: [`selector ${decoded.signature}: not in the local signature table`],
    });
  }
  if (target.intel?.isContract === false) flagNoCode(target, add);
  else assessTargetContract(target, add, true);
}

/** For a call whose effect is decided by the target's code, that code is the risk. */
function assessTargetContract(target: ContractPermissionRisk, add: (r: PreSignReason) => void, isCall: boolean) {
  const intel = target.intel;
  const who = short(target.contractAddress);
  const source = 'block explorer';

  if (!intel || intel.status === 'unavailable') {
    add({
      id: 'target_unchecked',
      level: isCall ? 'warning' : 'info',
      title: "The target contract couldn't be checked",
      detail: `${intel?.unavailableReason ?? 'The explorer did not respond'}. Treat ${who} as unverified; this is not a clean result.`,
      evidence: [`${source}: unavailable`],
    });
    return;
  }
  if (intel.isVerified === false) {
    add({
      id: 'target_unverified',
      level: 'warning',
      title: "The target's source code isn't verified",
      detail: `Nobody can read what ${who} does: its source is not published on the explorer.`,
      evidence: [`${source}: getsourcecode returned no source`],
    });
  }
  if (intel.ageDays !== null && intel.ageDays < FRESH_CONTRACT_DAYS) {
    add({
      id: 'target_fresh',
      level: 'warning',
      title: 'The target contract is brand new',
      detail: `${who} was deployed ${intel.ageDays} day(s) ago and has no track record.`,
      evidence: [`${source}: ${intel.ageDays} day(s) old`],
    });
  }
  if (target.canUpgradeCode) {
    add({
      id: 'target_upgradeable',
      level: 'info',
      title: "The target's code can be replaced",
      detail: `${who} is upgradeable: what it does today is not a promise about tomorrow.`,
      evidence: target.evidence.length ? target.evidence.map((fn) => `ABI function: ${fn}`) : [`${source}: flagged as a proxy`],
    });
  }
  if (intel.isVerified === true && !(intel.ageDays !== null && intel.ageDays < FRESH_CONTRACT_DAYS)) {
    add({
      id: 'target_verified',
      level: 'info',
      title: 'The target is a verified contract',
      detail:
        `${target.contractName ? `"${target.contractName}"` : who} has published source` +
        (intel.ageDays !== null ? ` and was deployed ${intel.ageDays} day(s) ago.` : '.'),
      evidence: [`${source}: verified source`],
    });
  }
}

// --- the story --------------------------------------------------------------------------

function tellStory(
  kind: CallKind,
  to: string,
  value: bigint,
  decoded: DecodedAbiResult,
  approval: DecodedApproval | null,
  transfer: DecodedTokenTransfer | null
): string {
  if (!isAddressShaped(to)) return 'The target is not a valid address, so the call cannot be described.';
  switch (kind) {
    case 'approve':
      if (!approval) break;
      if (approval.isRevocation) return `Revoke ${short(approval.spender)}'s permission to spend the token at ${short(to)}.`;
      return approval.isUnlimited
        ? `Give ${short(approval.spender)} permission to spend all of the token at ${short(to)} you hold, with no limit.`
        : `Give ${short(approval.spender)} permission to spend up to ${units(approval.amount)} base units of the token at ${short(to)}.`;
    case 'token_transfer':
      if (!transfer) break;
      return transfer.from
        ? `Move ${units(transfer.amount)} base units of the token at ${short(to)} from ${short(transfer.from)} to ${short(transfer.recipient)}.`
        : `Send ${units(transfer.amount)} base units of the token at ${short(to)} to ${short(transfer.recipient)}.`;
    case 'native':
      return `Send ${formatEther(value)} ETH to ${short(to)}.`;
    case 'contract_call':
      return decoded.categoryHint === 'unknown'
        ? `Call an unrecognised function (${decoded.signature}) on ${short(to)}.`
        : `Call ${decoded.methodName.split('(')[0]} on ${short(to)}.`;
    case 'unreadable':
      break;
  }
  return `Call ${short(to)} with calldata this check cannot read.`;
}

const LEVEL_ORDER: Record<PreSignReason['level'], number> = { critical: 0, warning: 1, info: 2 };

function sortReasons(reasons: PreSignReason[]): PreSignReason[] {
  // Stable: within a level, the order the rules ran in.
  return reasons
    .map((r, i) => [r, i] as const)
    .sort(([a, i], [b, j]) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || i - j)
    .map(([r]) => r);
}
