// src/prototype/sampleData.ts
//
// Sample data for the v2 shell. Real protocol addresses and realistic, uneven
// figures, because round numbers make a financial UI look fake. Nothing here is
// fetched: the prototype renders the demo state on purpose, and the shell
// labels it as demo exactly the way the live app does.

export type Chain = 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon';
export type Category = 'trade' | 'income' | 'transfer' | 'nft' | 'approve';

export interface ChainMeta {
  id: Chain;
  label: string;
  short: string;
  icon: string;
}

export const CHAINS: ChainMeta[] = [
  { id: 'ethereum', label: 'Ethereum', short: 'ETH', icon: 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg' },
  { id: 'arbitrum', label: 'Arbitrum', short: 'ARB', icon: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg' },
  { id: 'base', label: 'Base', short: 'BASE', icon: 'https://icons.llamao.fi/icons/chains/rsz_base.jpg' },
  { id: 'optimism', label: 'Optimism', short: 'OP', icon: 'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg' },
  { id: 'polygon', label: 'Polygon', short: 'POL', icon: 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg' },
];

export const CATEGORY_LABEL: Record<Category, string> = {
  trade: 'Trade',
  income: 'Income',
  transfer: 'Transfer',
  nft: 'NFT',
  approve: 'Approval',
};

export interface Activity {
  hash: string;
  chain: Chain;
  category: Category;
  /** The plain-English line. This is the product. */
  story: string;
  counterparty: string;
  counterpartyAddress: string;
  date: Date;
  assetSymbol: string;
  assetAmount: number;
  usdValue: number | null;
  gasUsd: number;
  direction: 'in' | 'out';
  /** Realized gain or loss in USD, when this disposal closed a lot. */
  realizedUsd?: number;
  flagged?: { label: string; severity: 'warn' | 'danger' };
}

const d = (iso: string) => new Date(iso);

export const ACTIVITY: Activity[] = [
  {
    hash: '0x4e1f8a27c93b0d6e5a4f2c81b7d39e04a6c5218f3b9de70241c8a5f6b3e29d04',
    chain: 'ethereum',
    category: 'trade',
    story: 'Swapped 2.41 ETH for 8,214 USDC on Uniswap V3',
    counterparty: 'Uniswap V3 Router',
    counterpartyAddress: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    date: d('2026-09-19T14:22:00Z'),
    assetSymbol: 'ETH',
    assetAmount: 2.4137,
    usdValue: 8214.62,
    gasUsd: 4.83,
    direction: 'out',
    realizedUsd: 1247.31,
  },
  {
    hash: '0x91c4b7e2038da65f4b1e9c7208df3a61b85c40e29f7d1a638b04c2e75f9a31bd',
    chain: 'ethereum',
    category: 'approve',
    story: 'Granted unlimited USDC spending permission to Uniswap V3',
    counterparty: 'Uniswap V3 Router',
    counterpartyAddress: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    date: d('2026-09-19T14:19:00Z'),
    assetSymbol: 'USDC',
    assetAmount: 0,
    usdValue: null,
    gasUsd: 1.27,
    direction: 'out',
    flagged: { label: 'Unlimited allowance', severity: 'warn' },
  },
  {
    hash: '0x7a3e05d1b94c26f8e0a7d3512c94b6e08f1a2d735c69b0e4a1f8c3b27d95e610',
    chain: 'base',
    category: 'income',
    story: 'Claimed 0.0842 ETH in staking rewards from Lido',
    counterparty: 'Lido stETH',
    counterpartyAddress: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
    date: d('2026-09-17T08:41:00Z'),
    assetSymbol: 'ETH',
    assetAmount: 0.0842,
    usdValue: 286.74,
    gasUsd: 0.09,
    direction: 'in',
  },
  {
    hash: '0x2d8f61a07e35c4b9028da71f6c3e59b40817d2a6f94c03e1b5872da4c60f9e37',
    chain: 'arbitrum',
    category: 'transfer',
    story: 'Sent 1,500 USDC to a wallet you have transacted with 14 times',
    counterparty: 'Frequent counterparty',
    counterpartyAddress: '0x3c7b19a052d4f6081ce9b3a72f5d841e06b2c9f8',
    date: d('2026-09-15T19:03:00Z'),
    assetSymbol: 'USDC',
    assetAmount: 1500,
    usdValue: 1499.82,
    gasUsd: 0.04,
    direction: 'out',
  },
  {
    hash: '0x6b902fc4a71e38d05c2b8f6a19347de205c8b1f603a9e7d24c18b05f3a26e9c1',
    chain: 'ethereum',
    category: 'transfer',
    story: 'Deposited 4.0 ETH into Tornado Cash',
    counterparty: 'Tornado Cash Router',
    counterpartyAddress: '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
    date: d('2026-09-11T02:17:00Z'),
    assetSymbol: 'ETH',
    assetAmount: 4,
    usdValue: 13_602.4,
    gasUsd: 9.16,
    direction: 'out',
    flagged: { label: 'Sanctioned mixer', severity: 'danger' },
  },
  {
    hash: '0x08e5d3b716af429c05ab61e97f2a68c31db904e5f7a26c1803bd9e4f6a2c75d1',
    chain: 'ethereum',
    category: 'nft',
    story: 'Bought Pudgy Penguin #4417 for 11.7 ETH on Blur',
    counterparty: 'Blur Marketplace',
    counterpartyAddress: '0x000000000000ad05ccc4f10045630fb830b95127',
    date: d('2026-09-04T21:55:00Z'),
    assetSymbol: 'ETH',
    assetAmount: 11.7,
    usdValue: 39_784.5,
    gasUsd: 12.4,
    direction: 'out',
  },
  {
    hash: '0x5f21c87ae06b3d94f1027ce5a83b6d40197e2fa8c3d7ba05b61e9f7c204a3801',
    chain: 'optimism',
    category: 'trade',
    story: 'Swapped 3,200 USDC for 0.94 WBTC on Velodrome',
    counterparty: 'Velodrome Router',
    counterpartyAddress: '0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858',
    date: d('2026-08-28T11:08:00Z'),
    assetSymbol: 'USDC',
    assetAmount: 3200,
    usdValue: 3199.04,
    gasUsd: 0.07,
    direction: 'out',
    realizedUsd: -184.26,
  },
];

export interface Allowance {
  token: string;
  tokenAddress: string;
  spender: string;
  spenderAddress: string;
  chain: Chain;
  unlimited: boolean;
  amountText: string;
  grantedAt: Date;
  /** USD exposed if the spender were compromised right now. */
  atRiskUsd: number | null;
}

export const ALLOWANCES: Allowance[] = [
  {
    token: 'USDC',
    tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    spender: 'Uniswap V3 Router',
    spenderAddress: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
    chain: 'ethereum',
    unlimited: true,
    amountText: 'Unlimited',
    grantedAt: d('2026-09-19T14:19:00Z'),
    atRiskUsd: 8214.62,
  },
  {
    token: 'WETH',
    tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    spender: 'Blur Marketplace',
    spenderAddress: '0x000000000000ad05ccc4f10045630fb830b95127',
    chain: 'ethereum',
    unlimited: true,
    amountText: 'Unlimited',
    grantedAt: d('2026-09-04T21:52:00Z'),
    atRiskUsd: 21_407.18,
  },
  {
    token: 'USDT',
    tokenAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    spender: 'Aave V3 Pool',
    spenderAddress: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    chain: 'arbitrum',
    unlimited: false,
    amountText: '5,000.00 USDT',
    grantedAt: d('2026-07-22T16:30:00Z'),
    atRiskUsd: 5000,
  },
];

export interface TaxLine {
  label: string;
  value: string;
  tone?: 'gain' | 'loss' | 'neutral';
  note?: string;
}

export const TAX_LINES: TaxLine[] = [
  { label: 'Proceeds', value: '$54,617.28', note: '9 disposals' },
  { label: 'Cost basis', value: '$53,554.23', note: 'FIFO, matched' },
  { label: 'Short-term gain', value: '+$1,247.31', tone: 'gain', note: 'held under 1 year' },
  { label: 'Long-term gain', value: '+$0.00', tone: 'neutral', note: 'no lots over 1 year' },
  { label: 'Realized loss', value: '-$184.26', tone: 'loss', note: '1 disposal' },
  { label: 'Gas expense', value: '-$27.86', tone: 'loss', note: 'deductible in some jurisdictions' },
];

export const WALLET = {
  ens: 'kyzen.eth',
  address: '0x7d4Ba61c5Ef91a08e3d5b72fC0e4919ad8B2A6f3',
  ageDays: 1247,
  firstSeen: d('2023-04-24T00:00:00Z'),
  txCount: 412,
  protocolCount: 23,
  portfolioUsd: 84_219.47,
  portfolioChangePct: 3.82,
  reputation: 'Established',
  reputationNote: 'Active across 23 protocols since April 2023',
  riskFlags: 1,
};
