import type {
  NormalizedTx,
  Movement,
  Interaction,
  Tag,
  Asset,
  Address,
  ChainId,
} from '../../../domain';
import { createAssetKey, WELL_KNOWN_CHAINS } from '../../../domain';
import { resolveSolanaProgram } from '../registry/programs';
import { getLightProgram } from '../registry/light';
import { detectJitoTip } from '../jito';
import type { CompressionInfo } from '../photon';

export interface SolanaRpcTransaction {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<string | { pubkey: string; signer?: boolean; writable?: boolean }>;
      instructions: Array<{
        programId?: string;
        programIdIndex?: number;
        accounts?: number[];
        data?: string;
      }>;
    };
  };
  meta: {
    err: any | null;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmountString?: string;
      };
    }>;
    postTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount: {
        amount: string;
        decimals: number;
        uiAmountString?: string;
      };
    }>;
    innerInstructions?: Array<{
      index: number;
      instructions: Array<{
        programId?: string;
        programIdIndex?: number;
      }>;
    }>;
  } | null;
  compressionInfo?: CompressionInfo;
}

export function normalizeSolanaTx(
  raw: SolanaRpcTransaction,
  subject: Address,
  chainId: ChainId = WELL_KNOWN_CHAINS.SOLANA_MAINNET
): NormalizedTx {
  const sig = raw.transaction.signatures[0] || 'unknown-signature';
  const meta = raw.meta;
  const isFailed = !!meta?.err;
  const time = raw.blockTime || 0;

  // Resolve account keys as flat strings
  const accountKeys: string[] = raw.transaction.message.accountKeys.map((k) =>
    typeof k === 'string' ? k : k.pubkey
  );
  const feePayer = accountKeys[0] || subject;
  const subjectIndex = accountKeys.findIndex((k) => k === subject);

  const nativeAsset: Asset = {
    key: createAssetKey(chainId, 'native'),
    chain: chainId,
    kind: 'native',
    symbol: 'SOL',
    decimals: 9,
  };

  const feeAmount = BigInt(meta?.fee || 0);

  const movements: Movement[] = [];
  const tags: Tag[] = [];

  if (isFailed) {
    tags.push('failed');
  }

  // -----------------------------------------------------------------
  // 1. ZK Compression Deltas (Photon compressionInfo)
  // -----------------------------------------------------------------
  let openedCmpLamports = 0n;
  let closedCmpLamports = 0n;
  const openedTokens = new Map<string, bigint>();
  const closedTokens = new Map<string, bigint>();

  if (raw.compressionInfo) {
    const hasOpened = (raw.compressionInfo.opened_accounts || []).length > 0;
    const hasClosed = (raw.compressionInfo.closed_accounts || []).length > 0;
    if (hasOpened || hasClosed) {
      tags.push('compressed_state');
    }

    for (const acc of raw.compressionInfo.opened_accounts || []) {
      if (acc.owner === subject) {
        if (acc.lamports !== undefined) {
          openedCmpLamports += BigInt(acc.lamports);
        }
        if (acc.tokenData && acc.tokenData.owner === subject) {
          const prev = openedTokens.get(acc.tokenData.mint) || 0n;
          openedTokens.set(acc.tokenData.mint, prev + BigInt(acc.tokenData.amount));
        }
      }
    }

    for (const acc of raw.compressionInfo.closed_accounts || []) {
      if (acc.owner === subject) {
        if (acc.lamports !== undefined) {
          closedCmpLamports += BigInt(acc.lamports);
        }
        if (acc.tokenData && acc.tokenData.owner === subject) {
          const prev = closedTokens.get(acc.tokenData.mint) || 0n;
          closedTokens.set(acc.tokenData.mint, prev + BigInt(acc.tokenData.amount));
        }
      }
    }
  }

  const deltaCmpLamports = openedCmpLamports - closedCmpLamports;

  // -----------------------------------------------------------------
  // 2. Native SOL: Standard Δstd & Compressed Δcmp Normalization
  // -----------------------------------------------------------------
  if (meta && subjectIndex !== -1 && !isFailed) {
    const preBal = BigInt(meta.preBalances[subjectIndex] || 0);
    const postBal = BigInt(meta.postBalances[subjectIndex] || 0);
    let deltaStd = postBal - preBal;

    if (subject === feePayer) {
      deltaStd += feeAmount;
    }

    // Case A: Compress SOL (standard out, compressed in)
    if (deltaStd < 0n && deltaCmpLamports > 0n) {
      tags.push('compression:compress');
      movements.push({
        asset: nativeAsset,
        amount: deltaCmpLamports,
        direction: 'out',
        state: 'compressed',
        role: 'compress',
      });
    }
    // Case B: Decompress SOL (compressed out, standard in)
    else if (deltaStd > 0n && deltaCmpLamports < 0n) {
      tags.push('compression:decompress');
      movements.push({
        asset: nativeAsset,
        amount: deltaStd,
        direction: 'in',
        state: 'standard',
        role: 'decompress',
      });
    }
    // Case C: Compressed SOL Transfer
    else if (deltaStd === 0n && deltaCmpLamports !== 0n) {
      tags.push('compression:transfer');
      const isIncoming = deltaCmpLamports > 0n;
      movements.push({
        asset: nativeAsset,
        amount: deltaCmpLamports < 0n ? -deltaCmpLamports : deltaCmpLamports,
        direction: isIncoming ? 'in' : 'out',
        state: 'compressed',
        role: 'transfer',
      });
    }
    // Case D: Standard SOL Transfer
    else if (deltaStd !== 0n && deltaCmpLamports === 0n) {
      const isIncoming = deltaStd > 0n;
      movements.push({
        asset: nativeAsset,
        amount: deltaStd < 0n ? -deltaStd : deltaStd,
        direction: isIncoming ? 'in' : 'out',
        state: 'standard',
        role: 'transfer',
      });
    }
  }

  // -----------------------------------------------------------------
  // 3. SPL Token Deltas: Standard Δstd & Compressed Δcmp
  // -----------------------------------------------------------------
  if (meta && !isFailed) {
    const preTokens = new Map<string, { amount: bigint; decimals: number; mint: string }>();
    const postTokens = new Map<string, { amount: bigint; decimals: number; mint: string }>();

    for (const b of meta.preTokenBalances || []) {
      const owner = b.owner || (b.accountIndex !== undefined ? accountKeys[b.accountIndex] : undefined);
      if (owner === subject) {
        preTokens.set(b.mint, {
          amount: BigInt(b.uiTokenAmount.amount || '0'),
          decimals: b.uiTokenAmount.decimals,
          mint: b.mint,
        });
      }
    }

    for (const b of meta.postTokenBalances || []) {
      const owner = b.owner || (b.accountIndex !== undefined ? accountKeys[b.accountIndex] : undefined);
      if (owner === subject) {
        postTokens.set(b.mint, {
          amount: BigInt(b.uiTokenAmount.amount || '0'),
          decimals: b.uiTokenAmount.decimals,
          mint: b.mint,
        });
      }
    }

    const allMints = new Set([
      ...preTokens.keys(),
      ...postTokens.keys(),
      ...openedTokens.keys(),
      ...closedTokens.keys(),
    ]);

    for (const mint of allMints) {
      const pre = preTokens.get(mint)?.amount || 0n;
      const post = postTokens.get(mint)?.amount || 0n;
      const decimals = postTokens.get(mint)?.decimals ?? preTokens.get(mint)?.decimals ?? 6;
      const deltaStd = post - pre;

      const openedCmp = openedTokens.get(mint) || 0n;
      const closedCmp = closedTokens.get(mint) || 0n;
      const deltaCmp = openedCmp - closedCmp;

      const tokenAsset: Asset = {
        key: createAssetKey(chainId, 'fungible', mint),
        chain: chainId,
        kind: 'fungible',
        address: mint,
        decimals,
      };

      // Case A: Compress Token
      if (deltaStd < 0n && deltaCmp > 0n) {
        tags.push('compression:compress');
        movements.push({
          asset: tokenAsset,
          amount: deltaCmp,
          direction: 'out',
          state: 'compressed',
          role: 'compress',
        });
      }
      // Case B: Decompress Token
      else if (deltaStd > 0n && deltaCmp < 0n) {
        tags.push('compression:decompress');
        movements.push({
          asset: tokenAsset,
          amount: deltaStd,
          direction: 'in',
          state: 'standard',
          role: 'decompress',
        });
      }
      // Case C: Compressed Token Transfer
      else if (deltaStd === 0n && deltaCmp !== 0n) {
        tags.push('compression:transfer');
        const isIncoming = deltaCmp > 0n;
        movements.push({
          asset: tokenAsset,
          amount: deltaCmp < 0n ? -deltaCmp : deltaCmp,
          direction: isIncoming ? 'in' : 'out',
          state: 'compressed',
          role: 'transfer',
        });
      }
      // Case D: Standard Token Transfer
      else if (deltaStd !== 0n && deltaCmp === 0n) {
        const isIncoming = deltaStd > 0n;
        movements.push({
          asset: tokenAsset,
          amount: deltaStd < 0n ? -deltaStd : deltaStd,
          direction: isIncoming ? 'in' : 'out',
          state: 'standard',
          role: 'transfer',
        });
      }
    }
  }

  // If there is both an in movement and out movement without compression, mark as swap_leg
  const hasIn = movements.some((m) => m.direction === 'in' && m.role !== 'decompress');
  const hasOut = movements.some((m) => m.direction === 'out' && m.role !== 'compress');
  if (hasIn && hasOut && !tags.some((t) => t.startsWith('compression:'))) {
    for (const m of movements) {
      m.role = 'swap_leg';
    }
  }

  // -----------------------------------------------------------------
  // 4. Interactions & Program Identification
  // -----------------------------------------------------------------
  const interactions: Interaction[] = [];
  const programIds = new Set<string>();

  for (const ix of raw.transaction.message.instructions) {
    const pid = ix.programId || (ix.programIdIndex !== undefined ? accountKeys[ix.programIdIndex] : undefined);
    if (pid) programIds.add(pid);
  }

  for (const inner of meta?.innerInstructions || []) {
    for (const ix of inner.instructions) {
      const pid = ix.programId || (ix.programIdIndex !== undefined ? accountKeys[ix.programIdIndex] : undefined);
      if (pid) programIds.add(pid);
    }
  }

  for (const pid of programIds) {
    const reg = resolveSolanaProgram(pid);
    const lightReg = getLightProgram(pid);

    interactions.push({
      target: pid,
      protocol: lightReg ? 'light-protocol' : reg?.protocol,
      method: lightReg ? lightReg.name : reg?.name,
      decoded: !!(reg || lightReg),
    });
  }

  const jito = detectJitoTip(accountKeys, raw.transaction.message.instructions);
  if (jito.hasTip) {
    tags.push('jito_tip');
  }

  return {
    id: `${chainId}:${sig}`,
    chain: chainId,
    hash: sig,
    time,
    position: {
      slot: raw.slot,
    },
    status: isFailed ? 'failed' : 'success',
    subject,
    feePayer,
    fee: {
      asset: nativeAsset,
      amount: feeAmount + jito.tipLamports,
      parts: {
        base: feeAmount,
        tip: jito.hasTip ? jito.tipLamports : undefined,
      },
    },
    movements,
    interactions,
    tags,
    provenance: {
      adapter: 'svm',
      adapterVersion: '2.0.0',
      rawRef: `slot:${raw.slot}`,
    },
  };
}
