// Test-side glue for the guardian. The EVM wrapper itself lives in
// src/tripwire/guardianVM.ts, because the dashboard runs the same code.
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID, type GuardianArtifact } from '../../../src/tripwire/guardianVM.js';
import { signAttestation as sign, type Attestation } from '../../../src/tripwire/onChain.js';
import type { Hex, LocalAccount } from 'viem';

export const artifact: GuardianArtifact = guardianArtifact;
export const { owner, oracle, bridge, relayer, attacker } = actors;
export const CHAIN_ID = LOCAL_CHAIN_ID;
export type { Attestation };

export const deployGuardian = (oracleAddress?: Hex) => GuardianVM.deploy(artifact, { oracle: oracleAddress });

export const signAttestation = (signer: LocalAccount, verifyingContract: Hex, a: Attestation, chainId = CHAIN_ID) =>
  sign(signer, verifyingContract, a, chainId);
