// scripts/tripwire/events.ts
//
// What the watcher reads: burns on the source chain (ingress) and releases the
// destination bridge is about to pay out (egress), paired by message id.
//
// A feed is anything that can be polled for new events since the last poll.
// Locally that is an in-memory log the attack script writes to; on a testnet
// it is eth_getLogs with a block cursor. The watcher cannot tell the two apart.

import type { Hex } from 'viem';
import { z } from 'zod';

const messageIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Hex);
const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const burnEventSchema = z.object({
  messageId: messageIdSchema, amount: z.bigint().positive(), timestamp: timestampSchema,
});
export const releaseEventSchema = z.object({
  messageId: messageIdSchema, recipient: addressSchema, amount: z.bigint().positive(), timestamp: timestampSchema,
});

/** Source chain: tokens burned (or locked) to bridge out. */
export interface BurnEvent {
  messageId: Hex;
  /** Token base units. */
  amount: bigint;
  timestamp: number;
}

/** Destination chain: a release the bridge is about to pay out — scored before it executes. */
export interface ReleaseEvent {
  messageId: Hex;
  recipient: Hex;
  /** Token base units. */
  amount: bigint;
  timestamp: number;
}

export interface LogFeed<E> {
  /** Events emitted since the previous poll, oldest first. */
  poll(): Promise<E[]>;
}

/** An in-memory log with a read cursor: the local stand-in for eth_getLogs. */
export class MemoryFeed<E> implements LogFeed<E> {
  private log: E[] = [];
  private cursor = 0;

  emit(event: E): void {
    this.log.push(event);
  }

  async poll(): Promise<E[]> {
    const fresh = this.log.slice(this.cursor);
    this.cursor = this.log.length;
    return fresh;
  }
}
