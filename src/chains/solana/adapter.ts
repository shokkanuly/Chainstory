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
import type { NormalizedTx, Address } from '../../domain';
import { WELL_KNOWN_CHAINS } from '../../domain';
import { matchAddress } from '../registry';
import { normalizeSolanaTx, type SolanaRpcTransaction } from './normalize/balanceDiff';
import { fetchWithBackoff } from '../http';
import { auditSplDelegates, assessProgramUpgradeRisk } from './risk';

export class SolanaAdapter implements ChainAdapter<SolanaRpcTransaction> {
  readonly family = 'svm' as const;
  readonly chains = [
    WELL_KNOWN_CHAINS.SOLANA_MAINNET,
    WELL_KNOWN_CHAINS.SOLANA_DEVNET,
  ];
  readonly defaultRpcUrl = 'https://api.mainnet-beta.solana.com';

  canHandle(input: string): AddressMatch | null {
    const match = matchAddress(input);
    return match && match.family === 'svm' ? match : null;
  }

  async resolve(input: string, _ctx?: AdapterCtx): Promise<Result<ResolvedAddress>> {
    const match = this.canHandle(input);
    if (!match) {
      return { ok: false, error: new Error(`Invalid Solana address or name: ${input}`) };
    }
    return {
      ok: true,
      value: {
        address: match.input,
        chain: WELL_KNOWN_CHAINS.SOLANA_MAINNET,
      },
    };
  }

  async *fetchHistory(
    q: HistoryQuery,
    ctx?: AdapterCtx
  ): AsyncIterable<Result<HistoryPage<SolanaRpcTransaction>>> {
    const rpcUrl = ctx?.rpcUrl || this.defaultRpcUrl;

    try {
      // 1. Fetch transaction signatures for target address
      const limit = q.limit || 20;
      const sigsRes = await fetchWithBackoff<{
        jsonrpc: string;
        result?: Array<{ signature: string; slot: number; err: any; blockTime?: number }>;
        error?: { message: string; code: number };
      }>(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'solana-sigs',
          method: 'getSignaturesForAddress',
          params: [
            q.address,
            {
              limit,
              before: q.cursor,
            },
          ],
        }),
        signal: ctx?.signal,
        timeoutMs: 10000,
        maxRetries: 2,
      });

      const sigInfos = sigsRes.result || [];
      if (sigInfos.length === 0) {
        yield {
          ok: true,
          value: {
            transactions: [],
            hasMore: false,
          },
        };
        return;
      }

      // 2. Fetch full transactions via batch JSON-RPC requests
      const batchPayload = sigInfos.map((item, idx) => ({
        jsonrpc: '2.0',
        id: `tx-${idx}`,
        method: 'getTransaction',
        params: [
          item.signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
          },
        ],
      }));

      const batchRes = await fetchWithBackoff<
        Array<{ jsonrpc: string; id: string; result?: SolanaRpcTransaction | null; error?: any }>
      >(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
        signal: ctx?.signal,
        timeoutMs: 15000,
        maxRetries: 2,
      });

      const txs: SolanaRpcTransaction[] = [];
      if (Array.isArray(batchRes)) {
        for (const item of batchRes) {
          if (item.result) {
            txs.push(item.result);
          }
        }
      }

      const nextCursor =
        sigInfos.length >= limit ? sigInfos[sigInfos.length - 1].signature : undefined;

      yield {
        ok: true,
        value: {
          transactions: txs,
          nextCursor,
          hasMore: Boolean(nextCursor),
        },
      };
    } catch (err: any) {
      yield {
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  normalize(raw: SolanaRpcTransaction, subject: Address, ctx: NormalizeCtx): NormalizedTx {
    return normalizeSolanaTx(raw, subject, ctx.chainId);
  }

  async auditPermissions(subject: Address, ctx?: AdapterCtx): Promise<Result<PermissionFinding[]>> {
    const rpcUrl = ctx?.rpcUrl || this.defaultRpcUrl;
    try {
      const res = await fetchWithBackoff<{
        result?: {
          value: Array<{
            pubkey: string;
            account: {
              data: {
                parsed?: {
                  info?: {
                    mint: string;
                    owner: string;
                    tokenAmount?: { amount: string };
                    delegate?: string;
                    delegatedAmount?: { amount: string };
                  };
                };
              };
            };
          }>;
        };
      }>(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'audit-tokens',
          method: 'getTokenAccountsByOwner',
          params: [
            subject,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' },
          ],
        }),
        signal: ctx?.signal,
        timeoutMs: 10000,
        maxRetries: 1,
      });

      const accounts = (res.result?.value || []).map((item) => {
        const info = item.account.data.parsed?.info;
        return {
          pubkey: item.pubkey,
          mint: info?.mint || '',
          owner: info?.owner || subject,
          amount: BigInt(info?.tokenAmount?.amount || '0'),
          delegate: info?.delegate || null,
          delegatedAmount: info?.delegatedAmount ? BigInt(info.delegatedAmount.amount) : 0n,
        };
      });

      const findings = auditSplDelegates(accounts);
      return { ok: true, value: findings };
    } catch {
      return { ok: true, value: [] };
    }
  }

  async scanContract(target: Address, ctx?: AdapterCtx): Promise<Result<ContractRiskReport>> {
    const rpcUrl = ctx?.rpcUrl || this.defaultRpcUrl;
    try {
      const res = await fetchWithBackoff<{
        result?: {
          value: {
            owner: string;
            data?: any;
          } | null;
        };
      }>(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'scan-contract',
          method: 'getAccountInfo',
          params: [target, { encoding: 'jsonParsed' }],
        }),
        signal: ctx?.signal,
        timeoutMs: 10000,
        maxRetries: 1,
      });

      const acc = res.result?.value;
      if (!acc) {
        return {
          ok: true,
          value: {
            target,
            isContract: false,
            riskLevel: 'low',
            flags: ['account_not_found'],
            explanations: ['Account does not exist or has zero lamports.'],
          },
        };
      }

      const isUpgradeable = acc.owner === 'BPFLoaderUpgradeab1e11111111111111111111111';
      if (isUpgradeable && acc.data?.parsed?.info?.programData) {
        const programDataAddr = acc.data.parsed.info.programData;
        const pdRes = await fetchWithBackoff<{
          result?: {
            value: {
              data?: {
                parsed?: {
                  info?: {
                    authority?: string | null;
                  };
                };
              };
            } | null;
          };
        }>(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'scan-programdata',
            method: 'getAccountInfo',
            params: [programDataAddr, { encoding: 'jsonParsed' }],
          }),
          signal: ctx?.signal,
          timeoutMs: 10000,
          maxRetries: 1,
        });

        const authority = pdRes.result?.value?.data?.parsed?.info?.authority || null;
        const report = assessProgramUpgradeRisk({
          programId: target,
          programDataAddress: programDataAddr,
          upgradeAuthority: authority,
        });
        return { ok: true, value: report };
      }

      return {
        ok: true,
        value: {
          target,
          isContract: acc.owner.includes('Loader') || acc.owner.includes('BPF'),
          riskLevel: 'low',
          flags: [],
          explanations: [`Owned by system/runtime program: ${acc.owner}`],
        },
      };
    } catch {
      return {
        ok: true,
        value: {
          target,
          isContract: true,
          riskLevel: 'low',
          flags: [],
          explanations: ['RPC inspection timed out; defaulting to low risk advisory.'],
        },
      };
    }
  }
}

export const solanaAdapter = new SolanaAdapter();

