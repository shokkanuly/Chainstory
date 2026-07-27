// src/services/abiDecoder.ts
//
// Fast local ABI signature matching & parameter extractor for smart contract logs,
// internal transfers, multi-hop DEX swaps, and common EVM function signatures.

export interface DecodedAbiResult {
  signature: string;
  methodName: string;
  categoryHint: string;
  tokenTransfers?: Array<{
    token: string;
    amount: string;
    to: string;
  }>;
}

const KNOWN_FUNCTION_SIGNATURES: Record<string, { name: string; category: string }> = {
  // Uniswap V2 / V3 Router / Universal Router
  '0x7ff36ab5': { name: 'swapExactETHForTokens(uint256,address[],address,uint256)', category: 'trade' },
  '0x38ed1739': { name: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', category: 'trade' },
  '0x18cbafe5': { name: 'swapTokensForExactETH(uint256,uint256,address[],address,uint256)', category: 'trade' },
  '0x5ae401dc': { name: 'multicall(bytes[])', category: 'trade' },
  '0xb6f9de95': { name: 'swap(address,bool,int256,uint160,bytes)', category: 'trade' },
  '0x3593564c': { name: 'execute(bytes,bytes[],uint256)', category: 'trade' },

  // 1inch Router
  '0x12aa3caf': { name: 'swap(address,tuple,bytes)', category: 'trade' },
  '0xe449022e': { name: 'uniswapSwap(uint256,uint256,uint256[])', category: 'trade' },

  // ERC-20 & ERC-721 Token Standard
  '0xa9059cbb': { name: 'transfer(address,uint256)', category: 'transfer' },
  '0x23b872dd': { name: 'transferFrom(address,address,uint256)', category: 'transfer' },
  '0x095ea7b3': { name: 'approve(address,uint256)', category: 'transfer' },
  '0x42842e0e': { name: 'safeTransferFrom(address,address,uint256)', category: 'nft' },

  // Minting & Staking
  '0xa0712d68': { name: 'mint(uint256)', category: 'nft' },
  '0x1249c58b': { name: 'mintNFT(address,string)', category: 'nft' },
  '0x6a627842': { name: 'mintPublic(uint256)', category: 'nft' },
  '0x4e71d92d': { name: 'claimRewards()', category: 'income' },
  '0x3d18b912': { name: 'claimStakingRewards()', category: 'income' },

  // WETH Wrapping
  '0xd0e30db0': { name: 'deposit()', category: 'transfer' },
  '0x2e1a7d4d': { name: 'withdraw(uint256)', category: 'transfer' },

  // Aave & Lending
  '0xe8eda9df': { name: 'deposit(address,uint256,address,uint16)', category: 'trade' },
  '0x69328dec': { name: 'withdraw(address,uint256,address)', category: 'trade' },
  '0x573ade81': { name: 'repay(address,uint256,uint256,address)', category: 'trade' },
};

export function decodeAbiData(inputHex: string): DecodedAbiResult {
  if (!inputHex || inputHex === '0x' || inputHex.length < 10) {
    return {
      signature: '0x',
      methodName: 'Standard Ether Transfer',
      categoryHint: 'transfer',
    };
  }

  const selector = inputHex.slice(0, 10).toLowerCase();
  const known = KNOWN_FUNCTION_SIGNATURES[selector];

  if (known) {
    return {
      signature: selector,
      methodName: known.name,
      categoryHint: known.category,
    };
  }

  return {
    signature: selector,
    methodName: `Contract Call (${selector})`,
    categoryHint: 'unknown',
  };
}

export function parseInternalTransactionLogs(
  logs: any[]
): Array<{ token: string; amount: string; to: string }> {
  if (!Array.isArray(logs)) return [];

  const transfers: Array<{ token: string; amount: string; to: string }> = [];

  for (const log of logs) {
    // ERC-20 / ERC-721 Transfer topic: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
    if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
      const toAddr = log.topics[2] ? '0x' + log.topics[2].slice(-40) : '';
      const amountHex = log.data && log.data !== '0x' ? log.data : '0x0';
      
      transfers.push({
        token: log.address || '',
        amount: amountHex,
        to: toAddr,
      });
    }
  }

  return transfers;
}
