// Circle CCTP v2, checked 2026-09-30. Only this testnet route is supported.
// Addresses/domains: https://developers.circle.com/cctp/references/contract-addresses
// Tokens: https://developers.circle.com/stablecoins/usdc-contract-addresses
// ABI/layout: circlefin/evm-cctp-contracts@a92a2b4e7e6ef99bf0b05dca71780f5ec190e729
// src/v2/{MessageTransmitterV2,TokenMessengerV2,BaseTokenMessenger}.sol
// src/messages/v2/{MessageV2,BurnMessageV2}.sol
import { parseAbi } from 'viem';

export const CCTP_BASE_SEPOLIA_TO_SEPOLIA = {
  id: 'cctp-v2:base-sepolia:ethereum-sepolia:USDC',
  source: { chainId: 84532, domain: 6, usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    transmitter: '0xe737e5cebeeba77efe34d4aa090756590b1ce275', messenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa' },
  destination: { chainId: 11155111, domain: 0, usdc: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    transmitter: '0xe737e5cebeeba77efe34d4aa090756590b1ce275', messenger: '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa' },
  decimals: 6,
} as const;
export const CCTP_STANDARD_FINALITY = 2000;
export const cctpTransmitterAbi = parseAbi([
  'event MessageSent(bytes message)',
  'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
]);
export const cctpMessengerAbi = parseAbi([
  'event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)',
  'event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken, uint256 feeCollected)',
]);

// Our adapter's ABI; protocol fields above remain sourced from Circle.
export const cctpEscrowAbi = parseAbi([
  'event ReleaseRequested(bytes32 indexed messageId, address indexed to, uint256 amount)',
  'event CctpEscrowFunded(bytes32 indexed messageId, bytes32 indexed nonce, bytes32 messageHash, uint256 amount)',
  'function CCTP_ESCROW_VERSION() view returns (uint256)',
  'function owner() view returns (address)',
  'function transmitter() view returns (address)',
  'function destinationMessenger() view returns (address)',
  'function destinationDomain() view returns (uint32)',
  'function sourceDomain() view returns (uint32)',
  'function sourceMessenger() view returns (address)',
  'function sourceToken() view returns (address)',
]);
