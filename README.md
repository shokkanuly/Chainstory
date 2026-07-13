# ⛓️ ChainStory

**ChainStory** translates cryptic blockchain transaction history into plain-English stories and auto-generates category/tax reports using Google Gemini AI. Built for the Native.builder Hackathon, it bridges the gap between raw web3 block explorer logs and human-readable, tax-ready records.

---

## 🌟 What This App Can Do

ChainStory takes raw, hexadecimal-filled block explorer records and converts them into a beautiful, structured timeline. Here are the core features:

1. **Dynamic Transaction Fetching**:
   - Fetches recent normal transactions and ERC-20 token transfers directly from the Ethereum mainnet via the **Etherscan API**.
   - Automatically merges, deduplicates, and orders transactions chronologically.

2. **Historical Price Valuation**:
   - Connects to the **CoinGecko API** to retrieve the exact price of Ethereum at the time of each transaction.
   - Calculates the USD value of each transaction at historical value.

3. **AI-Powered Interpretation**:
   - Utilizes the **Google Gemini API (`gemini-1.5-flash`)** with structured prompt engineering and method signature heuristics.
   - Decodes complex smart contract calls (Uniswap swaps, NFT mints, staking, wrapper tokens) into a one-sentence, plain-English summary (e.g., *"Swapped 2 ETH for 3,400 USDC on Uniswap"*).

4. **Tax & Category Classification**:
   - Classifies transactions into specific tax categories:
     - 💱 **Trade**: Swapping or exchanging crypto assets.
     - 💰 **Income**: Staking rewards, airdrops, mining, or yield.
     - 🔄 **Transfer**: Moving assets between personal wallets or wrapping tokens.
     - 🖼️ **NFT**: Minting, buying, selling, or transfer of collectibles.
   - Highlights classification confidence scores.

5. **Premium Interactive UI**:
   - Sleek dashboard summarizing your portfolio's activity.
   - Real-time classification status updates.
   - Beautiful, responsive glassmorphism timeline with micro-animations.

6. **Tax Export**:
   - Generates and exports a clean CSV report containing the transaction hash, date, plain-English description, category, value, and Etherscan link.

---

## 🚀 Current Project Stage

The project is currently in the **MVP (Minimum Viable Product) / Hackathon Demo Stage**.

### **What's Implemented:**
- [x] Complete frontend UI with glassmorphism layout, animated background glows, and a responsive timeline.
- [x] Etherscan API integration for transaction and token transfer history.
- [x] CoinGecko historical price lookups.
- [x] Gemini 1.5 Flash client-side classification with concurrency limits to prevent rate limit issues.
- [x] CSV report generation and download.
- [x] Standard configuration templates and `.env` setups.

### **Future Roadmap (Planned Enhancements):**
- [ ] **Web3 Wallet Connection**: Connect directly via MetaMask, WalletConnect, or Coinbase Wallet instead of pasting addresses.
- [ ] **Multi-chain Support**: Support L2 networks (Arbitrum, Optimism, Base, Polygon) and EVM chains.
- [ ] **Comprehensive Token Price History**: Support historical pricing for arbitrary ERC-20 tokens (currently focuses on ETH/WETH).
- [ ] **Deeper DEX Liquidity Pool Decoding**: Decipher complex multi-hop trades and LP provision/withdrawal steps.

---

## 🛠️ How to Run Locally

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Setup Environment Variables**:
   Copy `.env.example` to `.env` and fill in your keys:
   ```env
   VITE_ETHERSCAN_API_KEY=your_etherscan_api_key
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```

3. **Start the Development Server**:
   ```bash
   npm run dev
   ```
