// scripts/fixtures/zk/generateFixtures.ts
// Fixture generator for ZK Compression transactions on Solana (Light Protocol)
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(process.cwd(), 'src/testing/fixtures/zk');

if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const COUNTERPARTY = '4Nd1mBQtrMJVYVfKf2PJy9NZ2rBlQy2SZVHNxnLkK2s3';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// 1. Compress SOL fixture
const compressSolFixture = {
  slot: 280010000,
  blockTime: 1772539000,
  transaction: {
    signatures: ['compressSolSig1111111111111111111111111111111111111111111111111111111111111111111111111111111111111'],
    message: {
      accountKeys: [
        WALLET,
        'SysProgram1111111111111111111111111111111111',
        'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK',
      ],
      instructions: [
        {
          programId: 'SysProgram1111111111111111111111111111111111',
          data: 'compress',
        },
      ],
    },
  },
  meta: {
    err: null,
    fee: 5000,
    preBalances: [5000000000, 1, 1],
    postBalances: [3999995000, 1, 1], // 1 SOL compressed (1,000,000,000 lamports)
  },
  compressionInfo: {
    opened_accounts: [
      {
        hash: 'compressedAccountHash1111111111111111111111111',
        owner: WALLET,
        lamports: 1000000000,
      },
    ],
    closed_accounts: [],
  },
};

// 2. Decompress SOL fixture
const decompressSolFixture = {
  slot: 280020000,
  blockTime: 1772545000,
  transaction: {
    signatures: ['decompressSolSig2222222222222222222222222222222222222222222222222222222222222222222222222222222222222'],
    message: {
      accountKeys: [
        WALLET,
        'SysProgram1111111111111111111111111111111111',
      ],
      instructions: [
        {
          programId: 'SysProgram1111111111111111111111111111111111',
          data: 'decompress',
        },
      ],
    },
  },
  meta: {
    err: null,
    fee: 5000,
    preBalances: [3999995000, 1],
    postBalances: [4999990000, 1], // 1 SOL decompressed back to standard
  },
  compressionInfo: {
    opened_accounts: [],
    closed_accounts: [
      {
        hash: 'compressedAccountHash1111111111111111111111111',
        owner: WALLET,
        lamports: 1000000000,
      },
    ],
  },
};

// 3. Compressed SPL Token Transfer fixture
const compressedTransferFixture = {
  slot: 280030000,
  blockTime: 1772550000,
  transaction: {
    signatures: ['compressedTransferSig33333333333333333333333333333333333333333333333333333333333333333333333333333333'],
    message: {
      accountKeys: [
        WALLET,
        'cTokenmWWFtJw3MnihCwT7vFaR27vsW4S3NYj2PFBZg',
      ],
      instructions: [
        {
          programId: 'cTokenmWWFtJw3MnihCwT7vFaR27vsW4S3NYj2PFBZg',
          data: 'transfer',
        },
      ],
    },
  },
  meta: {
    err: null,
    fee: 5000,
    preBalances: [4999990000, 1],
    postBalances: [4999985000, 1], // only fee deducted
  },
  compressionInfo: {
    opened_accounts: [
      {
        hash: 'newRecipientCmpAccountHash',
        owner: COUNTERPARTY,
        tokenData: {
          mint: USDC_MINT,
          owner: COUNTERPARTY,
          amount: '100000000', // 100 USDC transferred in compressed state
        },
      },
    ],
    closed_accounts: [
      {
        hash: 'oldSenderCmpAccountHash',
        owner: WALLET,
        tokenData: {
          mint: USDC_MINT,
          owner: WALLET,
          amount: '100000000',
        },
      },
    ],
  },
};

fs.writeFileSync(
  path.join(FIXTURES_DIR, 'compress_sol.json'),
  JSON.stringify(compressSolFixture, null, 2)
);
fs.writeFileSync(
  path.join(FIXTURES_DIR, 'decompress_sol.json'),
  JSON.stringify(decompressSolFixture, null, 2)
);
fs.writeFileSync(
  path.join(FIXTURES_DIR, 'compressed_transfer.json'),
  JSON.stringify(compressedTransferFixture, null, 2)
);

console.log('✅ Successfully generated ZK compression fixtures in src/testing/fixtures/zk/');
