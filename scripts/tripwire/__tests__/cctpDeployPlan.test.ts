import { describe, expect, it } from 'vitest';
import { decodeFunctionData, getContractAddress, getAddress, zeroAddress } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import { cctpDeploymentPlan } from '../testnet/cctpDeployPlan.js';

const config = { deployer: actors.owner.address, owner: actors.bridge.address, oracle: actors.oracle.address,
  deployerNonce: '12', capBaseUnits: '100000000', windowSeconds: '3600' };
describe('unsigned CCTP pilot deployment', () => {
  it('binds immutable escrow and scoped route grants to sequential predicted deployments', () => {
    const plan = cctpDeploymentPlan(config);
    expect(plan.chainId).toBe(11155111);
    expect(plan.contracts.guardian).toBe(getContractAddress({ from: actors.owner.address, nonce: 12n }).toLowerCase());
    expect(plan.contracts.vault).toBe(getContractAddress({ from: actors.owner.address, nonce: 13n }).toLowerCase());
    const cap = decodeFunctionData({ abi: guardian.abi, data: plan.transactions[2].data });
    expect(cap).toMatchObject({ functionName: 'configureRoute', args: [plan.routeId, 100000000n, 3600n] });
    const grant = decodeFunctionData({ abi: guardian.abi, data: plan.transactions[3].data });
    expect(grant).toMatchObject({ functionName: 'setProtected', args: [getAddress(plan.contracts.vault), plan.routeId, true] });
    expect(plan.transactions[2].from).toBe(config.owner.toLowerCase());
    expect(plan.manifest).toMatchObject({ version: 2, operator: config.oracle.toLowerCase(), requests: [] });
  });
  it('changes escrow initcode when the deployment nonce or oracle changes', () => {
    const first = cctpDeploymentPlan(config);
    const second = cctpDeploymentPlan({ ...config, deployerNonce: '13' });
    expect(first.transactions[1].data).not.toBe(second.transactions[1].data);
    expect(first.transactions[0].data).not.toBe(cctpDeploymentPlan({ ...config, oracle: actors.relayer.address }).transactions[0].data);
  });
  it.each([{ owner: config.oracle }, { deployer: config.oracle }, { owner: zeroAddress },
    { capBaseUnits: '0' }, { capBaseUnits: String(1n << 128n) }, { windowSeconds: '0' }, { deployerNonce: '-1' }])('rejects unsafe configuration %j', (change) => {
    expect(() => cctpDeploymentPlan({ ...config, ...change })).toThrow();
  });
});
