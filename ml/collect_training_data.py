"""
collect_training_data.py

Builds the silver-standard labeled dataset from Gemini, with two
deliberate corrections vs. the naive version of this plan:

1. FIX (B): Wallets are chosen to deliberately include "hard" cases —
   unknown/unregistered contracts, complex DeFi, edge tokens — not just
   easy, well-known-protocol wallets. A dataset that's 90% Uniswap swaps
   teaches the model nothing about the cases it actually needs to handle.

2. FIX (A precursor): We do NOT apply a single global confidence >= 0.9
   filter before checking per-class distribution. Filtering blind
   disproportionately removes minority classes (income, nft) since those
   are inherently more ambiguous to Gemini than a plain ERC-20 transfer.
   We check the distribution first, then filter per-class if needed.

Each row is tagged with `wallet_address` (required for the wallet-level
train/test split in train_classifier.py — FIX C) and `is_known_contract`
(required for the known-vs-unknown accuracy breakdown — FIX A).
"""

import json
import os
import time
import pandas as pd
import requests

# ─── API Keys ────────────────────────────────────────────────────────
# Uses the same keys as the frontend .env file
ETHERSCAN_API_KEY = os.environ.get("ETHERSCAN_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

# ─── Wallet Buckets ──────────────────────────────────────────────────
# Deliberately mixed wallet set. The point of each bucket is described
# so it's obvious the "hard" buckets are not an afterthought.
WALLETS = {
    "easy_known_protocol": [
        # Heavy Uniswap/Aave/Lido users — high confidence, well-known contracts
        "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",  # vitalik.eth — diverse mix
        "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",  # VB old address
        "0x2B888954421b424C5D3D9Ce9bB67c9bD47537d12",  # Active DeFi user
    ],
    "hard_unknown_contract": [
        # Wallets that interact with long-tail / unregistered contracts
        "0x28C6c06298d514Db089934071355E5743bf21d60",  # Binance hot wallet — varied interactions
        "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549",  # Multi-contract user
    ],
    "complex_defi": [
        # LP deposits/withdrawals, flash loans, multi-step swaps
        "0x1136B25047E142Fa3018184793aEc68fBB173cE4",  # DeFi power user
        "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",  # 0x Exchange proxy interactions
    ],
    "simple_holder": [
        # Mostly plain ETH/ERC-20 transfers — the "transfer" category baseline
        "0x71c7656ec7ab88b098defb751b7401b5f6d8976f",  # Simple transfer wallet
        "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",  # Binance cold wallet — mostly transfers
    ],
}

TXNS_PER_WALLET = 100

# ─── Method Signature Hints (same as classifier.ts) ──────────────────
METHOD_HINTS = {
    "0xa9059cbb": "ERC-20 token transfer",
    "0x23b872dd": "ERC-20 transferFrom",
    "0x095ea7b3": "ERC-20 approve (authorize spending)",
    "0x7ff36ab5": "Uniswap swap ETH for tokens",
    "0x38ed1739": "Uniswap swap tokens for tokens",
    "0x18cbafe5": "Uniswap swap tokens for ETH",
    "0x5ae401dc": "Uniswap V3 multicall (swap)",
    "0xb6f9de95": "Uniswap V3 swap",
    "0x3593564c": "Uniswap Universal Router swap",
    "0x12aa3caf": "1inch swap",
    "0xe449022e": "1inch swap",
    "0xa0712d68": "Mint (NFT or token)",
    "0x1249c58b": "Mint NFT",
    "0x6a627842": "Mint",
    "0x4e71d92d": "Claim rewards / staking rewards",
    "0x3d18b912": "Claim staking rewards",
    "0x2e1a7d4d": "Unwrap WETH",
    "0xd0e30db0": "Wrap ETH (deposit to WETH)",
    "0xe8eda9df": "Aave deposit",
    "0x69328dec": "Aave withdraw",
    "0x573ade81": "Aave repay",
    "0x": "Simple ETH transfer (no contract call)",
}

# ─── Known Contracts (same as protocolRegistry.ts) ────────────────────
KNOWN_CONTRACTS = {
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "0xe592427a0aece92de3edee1f18e0157c05861564",
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
    "0x1111111254fb6c44bac0bed2854e76f90643097d", "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
    "0xdef1c0ded9bec7f1a1670819833240f027b25eff", "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    "0xd533a949740bb3306d119cc777fa900ba034cd52", "0xba100000625a3754423978a60c9317c58a424e3d",
    "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9", "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b", "0x00000000006c3852cbef3e08e8df289169ede581",
    "0x00000000000001ad428e4906ae43d8f9852d0dd6", "0x74312363e45dcaba76c59ec49a7aa8a65a67eed3",
    "0x59728544b08ab483533076417fbbb2fd0b17ce3a", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f",
}


def wei_to_eth(wei_str: str) -> float:
    """Convert wei string to ETH float."""
    try:
        return int(wei_str) / 1e18
    except (ValueError, TypeError):
        return 0.0


def get_protocol_group(address: str) -> str:
    """Maps contract address to protocol group (same logic as protocolRegistry.ts)."""
    addr = (address or "").lower()
    dex = {"0x7a250d5630b4cf539739df2c5dacb4c659f2488d", "0xe592427a0aece92de3edee1f18e0157c05861564",
           "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad",
           "0x1111111254fb6c44bac0bed2854e76f90643097d", "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
           "0xdef1c0ded9bec7f1a1670819833240f027b25eff"}
    staking = {"0xae7ab96520de3a18e5e111b5eaab095312d7fe84", "0xd533a949740bb3306d119cc777fa900ba034cd52",
               "0xba100000625a3754423978a60c9317c58a424e3d"}
    lending = {"0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9", "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
               "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b"}
    nft = {"0x00000000006c3852cbef3e08e8df289169ede581", "0x00000000000001ad428e4906ae43d8f9852d0dd6",
           "0x74312363e45dcaba76c59ec49a7aa8a65a67eed3", "0x59728544b08ab483533076417fbbb2fd0b17ce3a"}

    if addr in dex:
        return "dex"
    if addr in staking:
        return "staking_defi"
    if addr in lending:
        return "lending"
    if addr in nft:
        return "nft_marketplace"
    if addr == "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2":
        return "wrapper"
    if addr in {"0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", "0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f"}:
        return "bridge"
    return "unknown"


def fetch_transactions(wallet: str) -> list[dict]:
    """Fetch recent transactions from Etherscan for a wallet."""
    url = "https://api.etherscan.io/api"
    params = {
        "module": "account",
        "action": "txlist",
        "address": wallet,
        "sort": "desc",
        "page": "1",
        "offset": str(TXNS_PER_WALLET),
        "apikey": ETHERSCAN_API_KEY,
    }
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") == "1":
            return data.get("result", [])
        print(f"  ⚠ Etherscan returned status=0 for {wallet}: {data.get('message', 'unknown')}")
        return []
    except Exception as e:
        print(f"  ❌ Etherscan fetch failed for {wallet}: {e}")
        return []


def label_with_gemini(tx: dict, wallet: str) -> dict | None:
    """Calls Gemini using the SAME prompt logic as classifier.ts buildPrompt().
    Returns {description, category, confidence} or None on failure."""

    eth_value = wei_to_eth(tx.get("value", "0"))
    direction = "outgoing" if tx.get("from", "").lower() == wallet.lower() else "incoming"
    input_prefix = (tx.get("input", "0x") or "0x")[:10]
    method_hint = METHOD_HINTS.get(input_prefix, f"Contract interaction ({input_prefix})")
    token_info = ""
    if tx.get("tokenSymbol"):
        token_info = f"Token: {tx.get('tokenName', '')} ({tx['tokenSymbol']})"

    prompt = f"""You are a blockchain transaction classifier for a crypto tax app. Given a raw Ethereum transaction, output ONLY valid JSON with these exact fields: description, category, confidence.

Transaction details:
- Direction: {direction} (wallet is {wallet})
- From: {tx.get('from', '')}
- To: {tx.get('to', 'Contract creation')}
- ETH value: {eth_value:.6f} ETH
- Method: {method_hint}
{token_info}
- Contract: {tx.get('contractAddress', '') or tx.get('to', '')}
- Error: {'YES - transaction failed' if tx.get('isError') == '1' else 'No'}
- Function name: {tx.get('functionName', 'N/A')}

Rules for category:
- "trade": swaps, token purchases/sales, DeFi trades that involve exchanging one asset for another
- "income": staking rewards, yield farming, airdrops, mining rewards — receiving tokens without giving something equivalent in return
- "transfer": moving assets between wallets you own, simple sends, wrapping/unwrapping
- "nft": NFT mints, NFT purchases, NFT sales, NFT transfers

Output ONLY this JSON (no markdown, no extra text):
{{"description":"<one sentence, plain English, max 15 words>","category":"<trade|income|transfer|nft>","confidence":<0.0-1.0>}}"""

    try:
        resp = requests.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 150},
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()

        # Strip markdown fences if present
        cleaned = text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(cleaned)

        category = parsed.get("category", "unknown")
        if category not in ("trade", "income", "transfer", "nft"):
            category = "unknown"

        confidence = parsed.get("confidence", 0.5)
        if not isinstance(confidence, (int, float)):
            confidence = 0.5

        return {
            "description": parsed.get("description", ""),
            "category": category,
            "confidence": float(confidence),
        }
    except Exception as e:
        print(f"    ⚠ Gemini labeling failed for tx {tx.get('hash', '?')[:10]}…: {e}")
        return None


def extract_features(tx: dict, wallet: str) -> dict:
    """Extract the feature columns that match train_classifier.py FEATURE_COLUMNS."""
    input_data = tx.get("input", "0x") or "0x"
    input_prefix = input_data[:10]

    # Map method signature to a machine-friendly category
    method_map = {
        "0xa9059cbb": "erc20_transfer", "0x23b872dd": "erc20_transfer_from",
        "0x095ea7b3": "erc20_approve", "0x7ff36ab5": "uniswap_swap_eth_for_tokens",
        "0x38ed1739": "uniswap_swap_tokens_for_tokens", "0x18cbafe5": "uniswap_swap_tokens_for_eth",
        "0x5ae401dc": "uniswap_v3_multicall", "0xb6f9de95": "uniswap_v3_swap",
        "0x3593564c": "uniswap_universal_router_swap", "0x12aa3caf": "1inch_swap",
        "0xe449022e": "1inch_swap", "0xa0712d68": "nft_mint", "0x1249c58b": "nft_mint",
        "0x6a627842": "mint", "0x4e71d92d": "staking_claim", "0x3d18b912": "staking_claim",
        "0x2e1a7d4d": "weth_withdraw", "0xd0e30db0": "weth_deposit",
        "0xe8eda9df": "aave_deposit", "0x69328dec": "aave_withdraw", "0x573ade81": "aave_repay",
        "0x": "simple_transfer",
    }
    method_category = method_map.get(input_prefix, "unknown")
    direction = "outgoing" if tx.get("from", "").lower() == wallet.lower() else "incoming"
    to_addr = (tx.get("to") or "").lower()

    return {
        "method_category": method_category,
        "direction": direction,
        "eth_value": wei_to_eth(tx.get("value", "0")),
        "usd_value": 0,  # CoinGecko lookup omitted for training data simplicity
        "gas_used": int(tx.get("gasUsed", 0) or 0),
        "has_token_transfer": 1 if tx.get("tokenSymbol") else 0,
        "protocol_group": get_protocol_group(to_addr),
        "input_data_length": len(input_data),
        "is_failed": 1 if tx.get("isError") == "1" else 0,
        "is_known_contract": 1 if to_addr in KNOWN_CONTRACTS else 0,
    }


def main():
    os.makedirs("data", exist_ok=True)
    rows = []
    total_wallets = sum(len(w) for w in WALLETS.values())
    processed = 0

    for bucket, wallets in WALLETS.items():
        print(f"\n{'='*60}")
        print(f"Bucket: {bucket} ({len(wallets)} wallets)")
        print(f"{'='*60}")

        for wallet in wallets:
            processed += 1
            print(f"\n[{processed}/{total_wallets}] Fetching {wallet}…")
            txns = fetch_transactions(wallet)
            print(f"  Got {len(txns)} transactions")

            for i, tx in enumerate(txns):
                if i % 10 == 0:
                    print(f"  Labeling tx {i+1}/{len(txns)}…")

                label = label_with_gemini(tx, wallet)
                if label is None:
                    continue

                features = extract_features(tx, wallet)

                rows.append({
                    "wallet_address": wallet,
                    "bucket": bucket,
                    "hash": tx.get("hash", ""),
                    **features,
                    **label,
                })

                # Rate limit: ~2 calls/sec to stay under Gemini free tier
                time.sleep(0.5)

    df = pd.DataFrame(rows)
    print(f"\n{'='*60}")
    print(f"Total labeled transactions: {len(df)}")

    if len(df) == 0:
        print("❌ No data collected! Check API keys and wallet addresses.")
        return

    # --- FIX A precursor: inspect class balance BEFORE filtering ---
    print("\nRaw label distribution:")
    print(df["category"].value_counts())
    print("\nConfidence distribution by category:")
    print(df.groupby("category")["confidence"].describe())

    # Per-class confidence filter instead of one global threshold —
    # e.g. keep top 80% by confidence WITHIN each category, rather than
    # a flat >= 0.9 cutoff that guts rarer/harder classes.
    filtered = (
        df.groupby("category", group_keys=False)
        .apply(lambda g: g[g["confidence"] >= g["confidence"].quantile(0.2)])
    )

    print("\nFiltered label distribution:")
    print(filtered["category"].value_counts())

    filtered.to_csv("data/labeled_dataset.csv", index=False)
    df.to_json("data/raw_transactions.jsonl", orient="records", lines=True)

    print(f"\n✅ Saved {len(filtered)} labeled rows to data/labeled_dataset.csv")
    print(f"✅ Saved {len(df)} raw rows to data/raw_transactions.jsonl")


if __name__ == "__main__":
    main()
