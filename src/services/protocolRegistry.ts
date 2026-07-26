// src/services/protocolRegistry.ts
//
// Static registry mapping known contract addresses to protocol type + group.
// Deliberately incomplete — "unknown_contract" is a first-class, expected
// value. The ML model must be able to classify unknown-contract transactions
// using direction/value/gas features, not just protocol lookup — that's the
// entire point of training a model instead of just extending this table.

const KNOWN_PROTOCOLS: Record<string, string> = {
  // DEX — Uniswap
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'uniswap_v2_router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'uniswap_v3_router',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'uniswap_v3_router2',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'uniswap_universal_router',

  // DEX — Other
  '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch_router',
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': 'sushiswap_router',
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x_exchange',

  // Staking / Liquid Staking / AMM pools
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': 'lido_steth',
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'curve_crv',
  '0xba100000625a3754423978a60c9317c58a424e3d': 'balancer',

  // Lending
  '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9': 'aave_v2_pool',
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': 'aave_v3_pool',
  '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b': 'compound_comptroller',

  // NFT Marketplaces
  '0x00000000006c3852cbef3e08e8df289169ede581': 'seaport',
  '0x00000000000001ad428e4906ae43d8f9852d0dd6': 'seaport_1_4',
  '0x74312363e45dcaba76c59ec49a7aa8a65a67eed3': 'x2y2',
  '0x59728544b08ab483533076417fbbb2fd0b17ce3a': 'looksrare',

  // WETH
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'weth',

  // Bridges
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': 'optimism_bridge',
  '0x4dbd4fc535ac27206064b68ffcf827b0a60bab3f': 'arbitrum_bridge',
};

export function getProtocolType(address: string): string {
  if (!address) return 'unknown';
  return KNOWN_PROTOCOLS[address.toLowerCase()] || 'unknown_contract';
}

// Higher-level grouping — this is the actual XGBoost feature. Keeping it
// coarse (7 buckets + unknown) avoids one-hot-encoding blowup and keeps
// "unknown" a meaningful, common bucket rather than a rare edge case.
export function getProtocolGroup(address: string): string {
  const protocol = getProtocolType(address);
  if (['uniswap_v2_router', 'uniswap_v3_router', 'uniswap_v3_router2',
       'uniswap_universal_router', '1inch_router', 'sushiswap_router',
       '0x_exchange'].includes(protocol)) return 'dex';
  if (['lido_steth', 'curve_crv', 'balancer'].includes(protocol)) return 'staking_defi';
  if (['aave_v2_pool', 'aave_v3_pool', 'compound_comptroller'].includes(protocol)) return 'lending';
  if (['seaport', 'seaport_1_4', 'x2y2', 'looksrare'].includes(protocol)) return 'nft_marketplace';
  if (protocol === 'weth') return 'wrapper';
  if (['optimism_bridge', 'arbitrum_bridge'].includes(protocol)) return 'bridge';
  return 'unknown';
}

// Whether this address is in our known registry at all — used as a
// feature AND as a signal for oversampling "hard" unknown-contract cases
// during training data collection.
export function isKnownContract(address: string): boolean {
  return getProtocolType(address) !== 'unknown_contract' && getProtocolType(address) !== 'unknown';
}
