import { describe, expect, it } from 'vitest';
import { decodeDeployData, decodeFunctionData, getContractAddress, getAddress, keccak256, zeroAddress, type Hex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import { cctpDeploymentPlan } from '../testnet/cctpDeployPlan.js';
import screened from '../testnet/cctpScreenedPaymentEscrow.artifact.js';
import { operatorManifestSchema } from '../testnet/cctpManifest.js';
import { screeningProfileHash, screeningProfileSchema } from '../../../src/chains/evm/screening.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { screenedInput } from './fixtures/cctpDeployment.js';

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

describe('unsigned screened escrow deployment (ADR-047/048)', () => {
  it('deploys the screened escrow with the exact profile, predicts its profile hash and emits manifest 4', () => {
    const plan = cctpDeploymentPlan(screenedInput);
    expect(plan.version).toBe(3);
    expect(plan.artifactHashes.escrow).toBe(keccak256(screened.bytecode));
    const { args } = decodeDeployData({ abi: screened.abi, bytecode: screened.bytecode, data: plan.transactions[1].data });
    expect(args?.[5]).toEqual({ providerIdHash: screenedInput.screening.providerIdHash, listIdHash: screenedInput.screening.listIdHash,
      issuer: getAddress(screenedInput.screening.issuer), maxObservationAgeSeconds: 300, maxSnapshotAgeSeconds: 3600 });
    expect(plan.screening).toMatchObject({ issuer: screenedInput.screening.issuer.toLowerCase(), startsPaused: true, executionMode: 'legacy', activeHead: null,
      profileHash: screeningProfileHash({ destinationChainId: 11155111n, vault: plan.contracts.vault, guardian: plan.contracts.guardian, routeId: plan.routeId,
        token: route.destination.usdc.toLowerCase() as Hex }, screeningProfileSchema.parse(screenedInput.screening)) });
    expect(operatorManifestSchema.parse(plan.manifest)).toMatchObject({ version: 4, screening: { maxObservationAgeSeconds: 300n } });
    expect(plan.requirements.at(-1)).toContain('starts paused in legacy mode');
  });
  it.each(['deployer', 'owner', 'oracle'] as const)('refuses an issuer who is also the %s', (role) => {
    expect(() => cctpDeploymentPlan({ ...screenedInput, screening: { ...screenedInput.screening, issuer: screenedInput[role] } })).toThrow();
  });
  it.each(['authority', 'sourceSender', 'returnRecipient'] as const)('refuses an issuer who is also the customer %s', (role) => {
    expect(() => cctpDeploymentPlan({ ...screenedInput, screening: { ...screenedInput.screening, issuer: screenedInput.payment[role] } })).toThrow();
  });
  it('refuses an issuer who would be the escrow itself, and loose profile fields', () => {
    const vault = cctpDeploymentPlan(screenedInput).contracts.vault;
    expect(() => cctpDeploymentPlan({ ...screenedInput, screening: { ...screenedInput.screening, issuer: vault } })).toThrow('own screening issuer');
    expect(() => cctpDeploymentPlan({ ...screenedInput, screening: { ...screenedInput.screening, maxObservationAgeSeconds: '601' } })).toThrow();
    expect(() => cctpDeploymentPlan({ ...screenedInput, screening: { ...screenedInput.screening, maxSnapshotAgeSeconds: 3600 } })).toThrow();
  });
});
