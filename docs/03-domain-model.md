# 03 — Domain Model

This is the contract between adapters and everything else. It lives in code at `src/domain/` (zod schemas + inferred types).
If you change it, update this file in the same change and grep for every consumer (duplicated types drift silently).

## Identifiers

- **Chain IDs use CAIP-2:** `eip155:1`, `eip155:42161`, `eip155:8453`, `eip155:10`, `eip155:137`, `solana:mainnet`, `solana:devnet`.
- **Address strings** are stored in canonical form: EVM = EIP-55 checksummed; Solana = base58.
- **Tx ID:** `${chainId}:${hash}` where hash is the EVM tx hash or the first Solana signature.
- **Asset key:** `${chainId}/${kind}:${address}` e.g. `eip155:1/erc20:0xa0b8…`, `solana:mainnet/spl:EPjFW…`, native = `…/native`.
  A compressed and an uncompressed token with the same mint share the **same asset key** (they are the same asset; only `state` differs).

## Core types

```ts
type ChainId = string;                       // CAIP-2
type Address = string;                       // canonical per chain family
type AssetKey = string;

interface Asset {
  key: AssetKey;
  chain: ChainId;
  kind: 'native' | 'fungible' | 'nft';
  address?: Address;                          // contract / mint; absent for native
  symbol?: string;                            // UNTRUSTED display string (attacker-controlled on-chain)
  decimals: number;
}

interface Movement {                          // one asset leg of a transaction, from the subject wallet's perspective
  asset: Asset;
  amount: bigint;                             // base units, always >= 0
  direction: 'in' | 'out';
  counterparty?: Address;
  state: 'standard' | 'compressed';           // 'compressed' only for ZK-compressed accounts
  role: 'transfer' | 'swap_leg' | 'fee' | 'rent' | 'reward' | 'mint' | 'burn' | 'wrap' | 'unwrap' | 'compress' | 'decompress';
}

interface Interaction {                       // who was called
  target: Address;                            // EVM: `to`; SVM: program ID
  protocol?: ProtocolId;                      // resolved from registry, e.g. 'uniswap-v3', 'jupiter', 'light-system'
  method?: string;                            // decoded name if known
  index?: number;                             // SVM instruction index / EVM internal call index
  decoded: boolean;
}

type Tag =
  | 'compressed_state' | 'compression:compress' | 'compression:decompress' | 'compression:transfer'
  | 'jito_tip' | 'priority_fee' | 'unknown_program' | 'failed'
  | 'approval' | 'unlimited_approval' | 'authority_change' | 'delegate_set'
  | 'flagged_counterparty';

interface NormalizedTx {
  id: string;                                 // `${chain}:${hash}`
  chain: ChainId;
  hash: string;
  time: number;                               // unix seconds
  position: { block?: number; slot?: number; index?: number };
  status: 'success' | 'failed';
  subject: Address;                           // the wallet we are explaining
  feePayer: Address;
  fee: { asset: Asset; amount: bigint; parts?: { base: bigint; priority?: bigint; tip?: bigint } };
  movements: Movement[];                      // net of intra-tx noise, subject's perspective
  interactions: Interaction[];
  tags: Tag[];
  provenance: { adapter: string; adapterVersion: string; rawRef: string };  // for debugging/repro, not for logic
}
```

### Invariants on `NormalizedTx`

1. `amount >= 0n`; sign lives in `direction`.
2. Movements are **net for the subject**: a swap through 3 pools is 1 `out` leg + 1 `in` leg, not 6 legs.
3. Fees are recorded in `fee`, not duplicated as a movement, except `role:'fee'` legs for non-native protocol fees the subject paid.
4. Failed txs keep `fee`, have no movements (except fee), tag `failed`.
5. `symbol` is display-only; never used as an identity or in logic.
6. `normalize()` is deterministic: same raw input → same output (fixtures rely on it).

## Classification and story

```ts
type Category =
  | 'transfer_in' | 'transfer_out' | 'swap' | 'liquidity_add' | 'liquidity_remove'
  | 'stake' | 'unstake' | 'reward_claim' | 'airdrop' | 'mint' | 'nft_trade'
  | 'approval' | 'bridge' | 'compression' | 'account_management' | 'contract_deploy'
  | 'fee_only' | 'unclassified';

interface Classification {
  txId: string;
  category: Category;
  confidence: number;                         // 0..1
  source: 'rule' | 'ml' | 'llm' | 'fallback' | 'user';
  evidence: string[];                         // rule ids, matched programs, feature notes
}

interface Story {
  txId: string;
  category: Category;
  headline: string;                           // rendered from template slots
  slots: Record<string, SlotValue>;           // amounts/assets/counterparties: structured, from NormalizedTx only
  narrative?: string;                         // optional LLM prose; must not introduce new numbers/entities
  confidence: number;
  source: Classification['source'];
  warnings: Warning[];                        // each with evidence[] (I9)
}
```

Story example (headline is a template; slots carry the truth):
`"Swapped {out} for {in} on {protocol}"` with `slots = { out: {asset, amount}, in: {asset, amount}, protocol: 'jupiter' }`.

## Tax model

```ts
type TaxEventKind = 'acquire' | 'dispose' | 'income' | 'fee' | 'nontaxable_move';

interface TaxEvent {
  txId: string;
  kind: TaxEventKind;
  asset: Asset;
  amount: bigint;
  usdValue: Decimal | null;                   // null = price missing (row excluded, flagged)
  time: number;
  basisHint?: 'purchase' | 'reward' | 'airdrop';
}
```

### Category → tax mapping (single source of truth)

| Category | TaxEvent(s) |
|----------|-------------|
| `swap` | `dispose(out asset)` + `acquire(in asset)`; plus `fee` |
| `transfer_out` to third party | `dispose` only if user marks it a sale/payment; default `nontaxable_move` + flag for review |
| `transfer_in` from third party | `acquire` (purchase) or `income` (if reward/airdrop) — needs classification |
| `transfer` between user's own wallets | `nontaxable_move` (I7) |
| `reward_claim`, `airdrop` | `income` at fair market value on receipt → creates lot with that basis |
| `stake` / `unstake` | `nontaxable_move` (receipt tokens: treated as separate asset; **policy TODO(verify with tax professional)**) |
| `compression` (compress/decompress) | `nontaxable_move` (I7); same asset key before and after |
| wrap/unwrap (WETH, wSOL) | `nontaxable_move` |
| `approval`, `account_management`, `fee_only` | `fee` only |
| `unclassified` | nothing computed; row appears in "needs review" (I6) |

Fee handling: gas / base fee + priority fee + Solana Jito tip are deductible network costs → `fee` events.
**Rent deposits** (Solana account creation) are refundable deposits, not fees: record as `role:'rent'`, `nontaxable_move`.
Treatment of the non-refundable part is an open question (see roadmap).

FIFO invariants (property-tested): per `(wallet, asset key)` lots are consumed oldest-first; total lot quantity = Σacquire − Σdispose ≥ 0;
short/long-term split uses holding period > 1 year; all arithmetic in `bigint` / decimal.

## Mapping rules by chain

### EVM → NormalizedTx
| Raw | Normalized |
|-----|-----------|
| `value` (wei) | native `Movement` |
| ERC-20 `Transfer` logs involving subject | fungible `Movement`s |
| `to` + 4-byte selector | `Interaction` (decoded via ABI registry) |
| `gasUsed × effectiveGasPrice` | `fee` |
| internal transfers | native `Movement`s |

### Solana → NormalizedTx (see `04` for detail)
| Raw | Normalized |
|-----|-----------|
| `meta.preBalances/postBalances` | native SOL `Movement`s (fee-adjusted) |
| `meta.pre/postTokenBalances` | fungible `Movement`s (standard state) |
| Photon `opened_accounts` / `closed_accounts` | fungible / native `Movement`s with `state:'compressed'` |
| instruction `programId` (incl. inner instructions) | `Interaction`s via program registry |
| `meta.fee` + ComputeBudget + tip transfer | `fee.parts` |
