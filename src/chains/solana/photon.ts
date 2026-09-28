// src/chains/solana/photon.ts
// Typed client for Photon ZK Compression Indexer RPC methods

import { z } from 'zod';
import { fetchWithBackoff } from '../http';

// -------------------------------------------------------------------
// Zod Schemas for Photon Payloads
// -------------------------------------------------------------------

export const CompressedAccountDataSchema = z.object({
  hash: z.string(),
  owner: z.string(),
  lamports: z.union([z.number(), z.string()]).optional(),
  tokenData: z.object({
    mint: z.string(),
    owner: z.string(),
    amount: z.union([z.number(), z.string()]),
  }).optional(),
  data: z.object({
    data: z.string(),
    discriminator: z.array(z.number()).optional(),
  }).optional(),
});
export type CompressedAccountData = z.infer<typeof CompressedAccountDataSchema>;

export const CompressionInfoSchema = z.object({
  opened_accounts: z.array(CompressedAccountDataSchema).default([]),
  closed_accounts: z.array(CompressedAccountDataSchema).default([]),
});
export type CompressionInfo = z.infer<typeof CompressionInfoSchema>;

export const PhotonSignatureItemSchema = z.object({
  signature: z.string(),
  slot: z.number().int(),
  blockTime: z.number().int().nullable().optional(),
  err: z.any().nullable().optional(),
});
export type PhotonSignatureItem = z.infer<typeof PhotonSignatureItemSchema>;

export const PhotonTxWithCompressionSchema = z.object({
  slot: z.number().int(),
  blockTime: z.number().int().nullable(),
  transaction: z.object({
    signatures: z.array(z.string()),
    message: z.object({
      accountKeys: z.array(z.union([z.string(), z.object({ pubkey: z.string() })])),
      instructions: z.array(z.object({
        programId: z.string().optional(),
        programIdIndex: z.number().optional(),
        data: z.string().optional(),
      })),
    }),
  }),
  meta: z.object({
    err: z.any().nullable(),
    fee: z.number(),
    preBalances: z.array(z.number()),
    postBalances: z.array(z.number()),
    preTokenBalances: z.array(z.any()).optional(),
    postTokenBalances: z.array(z.any()).optional(),
    innerInstructions: z.array(z.any()).optional(),
  }).nullable(),
  compressionInfo: CompressionInfoSchema.optional(),
});
export type PhotonTxWithCompression = z.infer<typeof PhotonTxWithCompressionSchema>;

// -------------------------------------------------------------------
// Photon Client Implementation
// -------------------------------------------------------------------

export class PhotonClient {
  private endpoint: string;

  constructor(endpoint: string = 'https://mainnet.helius-rpc.com') {
    this.endpoint = endpoint;
  }

  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  private async callRpc<T>(method: string, params: any[] = []): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: `photon-${Date.now()}`,
      method,
      params,
    };

    const res = await fetchWithBackoff<{ result?: T; error?: { message: string; code: number } }>(
      this.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    if (res.error) {
      throw new Error(`Photon RPC Error [${res.error.code}]: ${res.error.message}`);
    }

    return res.result as T;
  }

  async getIndexerSlot(): Promise<number> {
    const slot = await this.callRpc<number>('getIndexerSlot');
    return slot;
  }

  async getIndexerHealth(): Promise<string> {
    const health = await this.callRpc<string>('getIndexerHealth');
    return health;
  }

  async getCompressionSignaturesForOwner(
    owner: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<PhotonSignatureItem[]> {
    const raw = await this.callRpc<any[]>('getCompressionSignaturesForOwner', [owner, options]);
    return z.array(PhotonSignatureItemSchema).parse(raw || []);
  }

  async getCompressionSignaturesForTokenOwner(
    owner: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<PhotonSignatureItem[]> {
    const raw = await this.callRpc<any[]>('getCompressionSignaturesForTokenOwner', [owner, options]);
    return z.array(PhotonSignatureItemSchema).parse(raw || []);
  }

  async getTransactionWithCompressionInfo(signature: string): Promise<PhotonTxWithCompression> {
    const raw = await this.callRpc<any>('getTransactionWithCompressionInfo', [signature]);
    return PhotonTxWithCompressionSchema.parse(raw);
  }

  async getCompressedBalanceByOwner(owner: string): Promise<bigint> {
    const res = await this.callRpc<{ value: number | string }>('getCompressedBalanceByOwner', [owner]);
    return BigInt(res?.value ?? 0);
  }
}

export const defaultPhotonClient = new PhotonClient();
