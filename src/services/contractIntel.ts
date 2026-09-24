// src/services/contractIntel.ts
//
// Real on-chain contract facts, read from the block explorer.
//
// This replaces the previous approach, which derived a contract's age and
// verification status from a hash of its address string:
//
//     const ageDays = (hashVal % 290) + 10;
//     const isVerified = ageDays > 30;
//
// That produced confident, specific, entirely fictional claims — and because
// the threshold passed for ~90% of the hash space, an actually-malicious
// contract was overwhelmingly likely to be labelled "safe".
//
// The rule here is: every field is either a fact we fetched, or `null`.
// `null` means "we could not determine this", and callers must render that as
// unknown rather than filling it in. A security surface that guesses is worse
// than one that admits ignorance.

import type { ChainId } from '../types';
import { explorerRequest, NoServerKeyError } from './apiClient';

export interface AdminCapabilities {
  canUpgrade: boolean;
  canPause: boolean;
  canMint: boolean;
  hasOwner: boolean;
  /** Function names that drove the flags above, for display. */
  evidence: string[];
}

export interface ContractIntel {
  address: string;
  /** 'ok' when we reached the explorer; 'unavailable' when we could not. */
  status: 'ok' | 'unavailable';
  unavailableReason?: string;
  isContract: boolean | null;
  isVerified: boolean | null;
  contractName: string | null;
  isProxy: boolean | null;
  implementationAddress: string | null;
  createdAt: Date | null;
  ageDays: number | null;
  adminCapabilities: AdminCapabilities | null;
}

const UPGRADE_FNS = ['upgradeto', 'upgradetoandcall', 'setimplementation', 'upgrade'];
const PAUSE_FNS = ['pause', 'unpause', 'setpaused', 'freeze'];
const MINT_FNS = ['mint', 'mintto', 'minttokens', 'issue'];
const OWNER_FNS = ['owner', 'transferownership', 'setowner', 'admin', 'changeadmin'];

function emptyIntel(address: string, reason: string): ContractIntel {
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

export function isAddressShaped(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test((input || '').trim());
}

/** Read admin-ish capabilities out of a verified contract's ABI. */
export function analyseAbi(abiJson: string): AdminCapabilities | null {
  let abi: unknown;
  try {
    abi = JSON.parse(abiJson);
  } catch {
    return null;
  }
  if (!Array.isArray(abi)) return null;

  const fnNames = abi
    .filter((item: any) => item?.type === 'function' && typeof item.name === 'string')
    .map((item: any) => item.name as string);

  const lower = fnNames.map((n) => n.toLowerCase());
  const evidence: string[] = [];

  const match = (candidates: string[]) => {
    const hits = fnNames.filter((_, i) => candidates.includes(lower[i]));
    evidence.push(...hits);
    return hits.length > 0;
  };

  const canUpgrade = match(UPGRADE_FNS);
  const canPause = match(PAUSE_FNS);
  const canMint = match(MINT_FNS);
  const hasOwner = match(OWNER_FNS);

  return {
    canUpgrade,
    canPause,
    canMint,
    hasOwner,
    evidence: Array.from(new Set(evidence)),
  };
}

async function explorerCall(
  chainId: ChainId,
  params: Record<string, string>
): Promise<any | null> {
  try {
    return await explorerRequest(chainId, params as any);
  } catch (err) {
    if (err instanceof NoServerKeyError) throw err;
    console.warn('Explorer call failed', params.action, err);
    return null;
  }
}

/** Resolve a contract's deployment timestamp, tolerating older API shapes. */
async function fetchCreationDate(
  address: string,
  chainId: ChainId
): Promise<Date | null> {
  const creation = await explorerCall(chainId, {
    module: 'contract',
    action: 'getcontractcreation',
    contractaddresses: address,
  });

  const entry = Array.isArray(creation?.result) ? creation.result[0] : null;
  if (!entry) return null;

  // Newer API versions return the timestamp directly.
  if (entry.timestamp) {
    const ts = parseInt(String(entry.timestamp), 10);
    if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000);
  }

  // Otherwise resolve it via the creation transaction's block.
  let blockNumber: string | null = entry.blockNumber ?? null;

  if (!blockNumber && entry.txHash) {
    const txData = await explorerCall(chainId, {
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: entry.txHash,
    });
    const hexBlock = txData?.result?.blockNumber;
    if (hexBlock) blockNumber = String(parseInt(hexBlock, 16));
  }

  if (!blockNumber) return null;

  const blockData = await explorerCall(chainId, {
    module: 'block',
    action: 'getblockreward',
    blockno: String(blockNumber),
  });
  const ts = parseInt(String(blockData?.result?.timeStamp ?? ''), 10);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : null;
}

/**
 * Fetch what the explorer actually knows about an address.
 * Never throws — an unreachable explorer yields status 'unavailable'.
 */
export async function fetchContractIntel(
  address: string,
  chainId: ChainId = 'ethereum'
): Promise<ContractIntel> {
  const clean = (address || '').trim();

  if (!isAddressShaped(clean)) {
    return emptyIntel(clean, 'Not a valid 42-character hexadecimal address');
  }
  let codeData: any = null;
  let sourceData: any = null;
  try {
    [codeData, sourceData] = await Promise.all([
      explorerCall(chainId, { module: 'proxy', action: 'eth_getCode', address: clean, tag: 'latest' }),
      explorerCall(chainId, { module: 'contract', action: 'getsourcecode', address: clean }),
    ]);
  } catch (err) {
    if (err instanceof NoServerKeyError) {
      return emptyIntel(clean, 'No explorer API key configured on the server, so this contract cannot be verified');
    }
    throw err;
  }

  if (!codeData && !sourceData) {
    return emptyIntel(clean, 'Explorer did not respond — verification could not be completed');
  }

  const code: string | undefined = codeData?.result;
  const isContract = typeof code === 'string' ? code !== '0x' && code.length > 2 : null;

  // An EOA has no source, no proxy and no admin surface — report it plainly.
  if (isContract === false) {
    return {
      address: clean,
      status: 'ok',
      isContract: false,
      isVerified: null,
      contractName: null,
      isProxy: false,
      implementationAddress: null,
      createdAt: null,
      ageDays: null,
      adminCapabilities: null,
    };
  }

  const entry = Array.isArray(sourceData?.result) ? sourceData.result[0] : null;
  const sourceCode: string = entry?.SourceCode ?? '';
  const isVerified = entry ? sourceCode.trim().length > 0 : null;
  const contractName: string | null = entry?.ContractName || null;
  const isProxy = entry ? entry.Proxy === '1' : null;
  const implementationAddress: string | null =
    entry?.Implementation && entry.Implementation !== '' ? entry.Implementation : null;

  const adminCapabilities =
    isVerified && entry?.ABI && entry.ABI !== 'Contract source code not verified'
      ? analyseAbi(entry.ABI)
      : null;

  const createdAt = await fetchCreationDate(clean, chainId);
  const ageDays = createdAt
    ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000))
    : null;

  return {
    address: clean,
    status: 'ok',
    isContract,
    isVerified,
    contractName,
    isProxy,
    implementationAddress,
    createdAt,
    ageDays,
    adminCapabilities,
  };
}
