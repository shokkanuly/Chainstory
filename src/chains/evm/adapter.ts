import type {
  ChainAdapter,
  AdapterCtx,
  HistoryQuery,
  HistoryPage,
  AddressMatch,
  ResolvedAddress,
  PermissionFinding,
  ContractRiskReport,
  Result,
  NormalizeCtx,
} from '../types';
import type {
  NormalizedTx,
  Movement,
  Interaction,
  Tag,
  Asset,
  Address,
} from '../../domain';
import { createAssetKey, WELL_KNOWN_CHAINS } from '../../domain';
import type { RawTransaction } from '../../types';
import { matchAddress } from '../registry';
import { fetchMultiWalletTransactions } from '../../services/etherscan';

export class EvmAdapter implements ChainAdapter<RawTransaction> {
  readonly family = 'evm' as const;
  readonly chains = [
    WELL_KNOWN_CHAINS.ETHEREUM,
    WELL_KNOWN_CHAINS.ARBITRUM,
    WELL_KNOWN_CHAINS.BASE,
    WELL_KNOWN_CHAINS.OPTIMISM,
    WELL_KNOWN_CHAINS.POLYGON,
  ];

  canHandle(input: string): AddressMatch | null {
    const match = matchAddress(input);
    return match && match.family === 'evm' ? match : null;
  }

  async resolve(input: string, _ctx?: AdapterCtx): Promise<Result<ResolvedAddress>> {
    const match = this.canHandle(input);
    if (!match) {
      return { ok: false, error: new Error(`Invalid EVM address or ENS name: ${input}`) };
    }
    return {
      ok: true,
      value: {
        address: match.input,
        chain: WELL_KNOWN_CHAINS.ETHEREUM,
      },
    };
  }

  async *fetchHistory(
    q: HistoryQuery,
    _ctx?: AdapterCtx
  ): AsyncIterable<Result<HistoryPage<RawTransaction>>> {
    try {
      const result = await fetchMultiWalletTransactions([q.address]);
      // The fetcher falls back to labelled demo data when live data fails. An
      // adapter has no demo flag, so passing it through would present synthetic
      // history as real: report it as the expected failure it is instead.
      if (result.source === 'demo') {
        yield { ok: false, error: new Error(result.demoReason ?? 'Live data unavailable') };
        return;
      }
      yield {
        ok: true,
        value: {
          transactions: result.transactions,
          hasMore: false,
        },
      };
    } catch (err: any) {
      yield {
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  normalize(raw: RawTransaction, subject: Address, ctx: NormalizeCtx): NormalizedTx {
    const isSubjectSender = raw.from.toLowerCase() === subject.toLowerCase();
    const isFailed = raw.isError === '1' || raw.txreceipt_status === '0';

    const nativeAsset: Asset = {
      key: createAssetKey(ctx.chainId, 'native'),
      chain: ctx.chainId,
      kind: 'native',
      symbol: ctx.chainId.includes('137') ? 'POL' : 'ETH',
      decimals: 18,
    };

    const gasUsed = BigInt(raw.gasUsed || '0');
    const gasPrice = BigInt(raw.gasPrice || '0');
    const feeAmount = gasUsed * gasPrice;

    const movements: Movement[] = [];
    const tags: Tag[] = [];

    if (isFailed) {
      tags.push('failed');
    }

    // Process native currency transfer if value > 0
    let rawValBigInt = 0n;
    try {
      if (raw.value && raw.value !== '0') {
        rawValBigInt = BigInt(raw.value);
      }
    } catch {
      rawValBigInt = 0n;
    }

    if (rawValBigInt > 0n && !isFailed) {
      const isSwap = (raw.functionName || '').toLowerCase().includes('swap');
      movements.push({
        asset: nativeAsset,
        amount: rawValBigInt,
        direction: isSubjectSender ? 'out' : 'in',
        counterparty: isSubjectSender ? raw.to : raw.from,
        state: 'standard',
        role: isSwap ? 'swap_leg' : 'transfer',
      });
    }

    // Interactions
    const interactions: Interaction[] = [];
    if (raw.to) {
      interactions.push({
        target: raw.to,
        method: raw.functionName || (raw.input && raw.input.length >= 10 ? raw.input.slice(0, 10) : undefined),
        decoded: !!raw.functionName,
      });
    }

    if (raw.input?.startsWith('0x095ea7b3')) {
      tags.push('approval');
    }

    return {
      id: `${ctx.chainId}:${raw.hash}`,
      chain: ctx.chainId,
      hash: raw.hash,
      time: parseInt(raw.timeStamp, 10) || 0,
      position: {
        block: parseInt(raw.blockNumber, 10) || undefined,
      },
      status: isFailed ? 'failed' : 'success',
      subject,
      feePayer: raw.from,
      fee: {
        asset: nativeAsset,
        amount: feeAmount,
        parts: { base: feeAmount },
      },
      movements,
      interactions,
      tags,
      provenance: {
        adapter: 'evm',
        adapterVersion: '2.0.0',
        rawRef: `block:${raw.blockNumber || 'unknown'}`,
      },
    };
  }

  async auditPermissions(_subject: Address, _ctx?: AdapterCtx): Promise<Result<PermissionFinding[]>> {
    return { ok: true, value: [] };
  }

  async scanContract(target: Address, _ctx?: AdapterCtx): Promise<Result<ContractRiskReport>> {
    return {
      ok: true,
      value: {
        target,
        isContract: true,
        riskLevel: 'low',
        flags: [],
        explanations: [],
      },
    };
  }
}

export const evmAdapter = new EvmAdapter();
