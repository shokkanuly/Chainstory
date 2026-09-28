# 09 — Glossary

## ChainStory terms
| Term | Meaning |
|------|---------|
| **NormalizedTx** | Chain-agnostic transaction from the subject wallet's perspective; the only seam between adapters and everything else (`03`) |
| **Story** | Plain-English card for one transaction: template headline + structured slots + confidence + warnings |
| **Adapter** | Per-chain-family module implementing `ChainAdapter` (fetch, normalize, audit, scan, simulate) |
| **Subject** | The wallet being explained |
| **Slot** | A structured value (asset/amount/counterparty) inserted into a story template |
| **Golden** | Stored expected output for a fixture; changes must be explained |
| **Fixture** | Recorded real raw chain/indexer data used for deterministic tests |
| **Guard** | Phase 4 read-only pre-sign simulation and explanation |
| **story-attest** | Phase 5 optional program that stores opt-in receipts as compressed accounts |

## Solana terms
| Term | Meaning |
|------|---------|
| **Program** | Solana's smart contract (identified by a program ID) |
| **Instruction / inner instruction** | A call to a program within a tx / a CPI made by another program |
| **Token account / ATA** | Account holding a token balance for an owner; ATA = the canonical associated token account |
| **Rent-exempt deposit** | Lamports an account must hold; refundable when the account is closed |
| **Lamport** | 1e-9 SOL |
| **Balance-diff** | Net balance change computed from pre/post balances in tx meta |
| **Slot** | Solana's time unit for block production (analogous to, not identical to, block height) |
| **Priority fee** | Optional fee (price per compute unit × units) to improve inclusion |
| **Address Lookup Table (ALT)** | On-chain table letting v0 transactions reference many accounts compactly |
| **Versioned tx (v0)** | Transaction format supporting ALTs |
| **Delegate** | Address allowed to spend from a token account up to `delegatedAmount` (Solana's approval analog) |
| **Upgrade authority** | Key that can replace an upgradeable program's code (null = immutable) |
| **Mint / freeze authority** | Keys that can create supply / freeze token accounts for a mint |
| **Jito tip / bundle** | Tip paid (a SOL transfer to a tip account) to have a bundle prioritized by Jito's block engine |
| **wSOL** | Wrapped SOL as an SPL token; wrapping is not a taxable event |

## ZK Compression terms
| Term | Meaning |
|------|---------|
| **ZK Compression** | Light Protocol's mechanism storing account data in the ledger with a commitment in a Merkle tree, verified with zero-knowledge proofs |
| **Compressed account** | Account whose state is a leaf in a state tree; types: compressed token, compressed SOL, compressed PDA |
| **State tree** | Merkle tree of compressed account hashes (V1 concurrent, V2 batched) |
| **Validity proof** | Constant-size (~128 bytes) ZK proof that inputs exist in a tree (and new addresses don't); fetched from the RPC (`getValidityProof`) |
| **Nullifier (queue)** | Mechanism marking spent compressed accounts to prevent double-spend |
| **Photon** | Open-source indexer (Helius) serving compressed state and proofs over RPC |
| **Opened / closed accounts** | In Photon tx info: outputs created / inputs spent by a compressed tx |
| **Compress / decompress** | Move value from standard accounts into compressed state / back |
| **Indexer lag** | Photon's processed slot behind the chain tip; recent compressed activity may be missing |
| **Compressed NFT (Bubblegum)** | Different system (SPL account compression + DAS API); **not** ZK Compression |

## Tax terms
| Term | Meaning |
|------|---------|
| **FIFO** | First-in-first-out lot consumption for cost basis |
| **Lot** | Acquired quantity with a cost basis and acquisition time |
| **Short/long-term** | Holding period ≤ / > 1 year (US) |
| **Form 8949** | IRS form listing capital-gain/loss transactions (ChainStory exports a *draft*) |
| **Ordinary income** | Rewards/airdrops taxed at fair market value when received; that value becomes the lot's basis |
| **Non-taxable move** | Transfer between own wallets, wrap/unwrap, compress/decompress |
