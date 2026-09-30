import { describe, expect, it, vi } from 'vitest';
import { parseAbi, type Hex } from 'viem';
import { ContractEventFeed, runTestnetDemo, type Clients, type Deployment, type TestnetConfig } from '../testnet/sepolia.js';

describe('event feed cursor', () => {
  it('retries the same range when resolving a block fails after logs were fetched', async () => {
    const getBlock = vi.fn().mockRejectedValueOnce(new Error('RPC timeout')).mockResolvedValue({ timestamp: 100n });
    const getContractEvents = vi.fn().mockResolvedValue([{ blockNumber: 10n, args: { amount: 5n } }]);
    const clients = { pub: { getBlockNumber: async () => 10n, getContractEvents, getBlock } } as unknown as Clients;
    const feed = new ContractEventFeed(clients, `0x${'1'.repeat(40)}` as Hex, parseAbi(['event Burned(uint256 amount)']), 'Burned', 10n, (args) => args.amount);
    await expect(feed.poll()).rejects.toThrow('RPC timeout');
    expect(await feed.poll()).toEqual([5n]);
    expect(getContractEvents).toHaveBeenCalledTimes(2);
  });

  it('does not advance the cursor when event validation fails', async () => {
    const map = vi.fn().mockImplementationOnce(() => { throw new Error('Invalid event payload'); }).mockReturnValue(5n);
    const getContractEvents = vi.fn().mockResolvedValue([{ blockNumber: 10n, args: { amount: 5n } }]);
    const clients = { pub: { getBlockNumber: async () => 10n, getContractEvents, getBlock: async () => ({ timestamp: 100n }) } } as unknown as Clients;
    const feed = new ContractEventFeed(clients, `0x${'1'.repeat(40)}` as Hex, parseAbi(['event Burned(uint256 amount)']), 'Burned', 10n, map);
    await expect(feed.poll()).rejects.toThrow('Invalid event payload');
    expect(await feed.poll()).toEqual([5n]);
    expect(getContractEvents).toHaveBeenCalledTimes(2);
  });

  it('refuses an old testnet vault before sending any reset or payout transaction', async () => {
    const writeContract = vi.fn();
    const clients = { pub: { readContract: vi.fn().mockRejectedValue(new Error('Unknown selector')) }, wallet: { writeContract } } as unknown as Clients;
    const contract = { address: `0x${'1'.repeat(40)}` as Hex };
    const deployment = { contracts: { TripwireGuardian: contract, ProtectedVault: contract, MockSourceBridge: contract, DrainProxy: contract } } as unknown as Deployment;
    await expect(runTestnetDemo({} as TestnetConfig, clients, deployment, { contractFacts: async () => null })).rejects.toThrow('no release-review gate');
    expect(writeContract).not.toHaveBeenCalled();
  });
});
