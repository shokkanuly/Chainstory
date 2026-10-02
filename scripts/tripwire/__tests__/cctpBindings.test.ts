import { describe, expect, it, vi } from 'vitest';
import { cctpEscrowAbi } from '../../../src/chains/evm/registry/cctp.js';
import escrow from '../testnet/cctpEscrow.artifact.js';
import { assertCctpEscrowBindings, cctpBindings } from '../testnet/cctpBindings.js';
import { cctpManifestSchema } from '../testnet/verifyCctp.js';
import { authenticatedFixture } from './fixtures/cctpEscrow.js';
import { sender, vault } from './fixtures/cctp.js';

describe('CCTP deployment boundary', () => {
  it('accepts only the expected version, self-owner and pinned route configuration', async () => {
    const bindings = cctpBindings(vault);
    await expect(assertCctpEscrowBindings(vault, async (name) => bindings[name])).resolves.toBeUndefined();
  });
  it.each(Object.keys(cctpBindings(vault)))('refuses a changed %s binding before starting an operator', async (field) => {
    const bindings = cctpBindings(vault);
    await expect(assertCctpEscrowBindings(vault, async (name) => name === field ?
      (typeof bindings[name] === 'number' ? 9999 : sender) : bindings[name])).rejects.toThrow();
  });
  it('refuses a legacy vault missing the CCTP marker', async () => {
    const read = vi.fn(async () => { throw new Error('Unknown selector'); });
    await expect(assertCctpEscrowBindings(vault, read)).rejects.toThrow();
  });
  it('registers exactly the deployed CCTP functions and events', () => {
    for (const registered of cctpEscrowAbi) {
      const item = escrow.abi.find((entry) => (entry.type === 'event' || entry.type === 'function') && entry.name === registered.name);
      expect(item).toMatchObject(registered);
    }
  });
  it('accepts an explicit authenticated manifest and rejects unknown versions', () => {
    const f = authenticatedFixture(); const manifest = { version: 2, vault, guardian: sender, operator: sender,
      requests: [{ messageId: f.release.messageId, proof: f.locator }] };
    expect(cctpManifestSchema.safeParse(manifest).success).toBe(true);
    expect(cctpManifestSchema.safeParse({ ...manifest, version: 3 }).success).toBe(false);
  });
});
