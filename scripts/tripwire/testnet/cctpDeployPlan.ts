// Reproducible unsigned testnet deployment package. No account keys or RPC writes.
import { encodeDeployData, encodeFunctionData, getContractAddress, keccak256, stringToHex, zeroAddress, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import escrow from './cctpEscrow.artifact.js';
import paymentEscrow from './cctpPaymentEscrow.artifact.js';
import screenedEscrow from './cctpScreenedPaymentEscrow.artifact.js';
import { cctpPaymentBindingsSchema } from '../cctp.js';
import { screeningProfileHash, screeningProfileSchema } from '../../../src/chains/evm/screening.js';

const account = cctpAddressSchema.refine((a) => a !== zeroAddress, 'A nonzero public account is required.');
const deploymentFields = z.object({
  deployer: account, owner: account, oracle: account,
  deployerNonce: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt),
  capBaseUnits: z.string().regex(/^[1-9][0-9]*$/).transform(BigInt).refine((n) => n < (1n << 128n), 'Cap exceeds uint128.'),
  windowSeconds: z.string().regex(/^[1-9][0-9]*$/).transform(BigInt).refine((n) => n < (1n << 64n), 'Window exceeds uint64.'),
}).strict();
const separate = (c: z.infer<typeof deploymentFields>) => c.owner !== c.oracle && c.deployer !== c.oracle;
export const cctpDeploymentConfigSchema = deploymentFields.refine(separate, 'Keep the oracle separate from owner/deployer.');
const units = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt).refine((n) => n < (1n << 256n));
const paymentConfig = cctpPaymentBindingsSchema.extend({ policy: z.object({
  maxPayment: units.refine((n) => n > 0n), manualApprovalAbove: units, delayAbove: units,
  delaySeconds: units.refine((n) => n <= 30n * 86400n),
}).strict().refine((p) => p.manualApprovalAbove <= p.maxPayment && p.delayAbove <= p.maxPayment),
recipients: z.array(account).max(100).refine((list) => new Set(list).size === list.length),
}).strict();
const plainPayment = deploymentFields.extend({ version: z.literal(3), payment: paymentConfig }).strict();
/**
 * Version 4: the screened customer escrow (ADR-047/048) with its exact screening
 * profile (H4c2 transport form). The issuer must be nobody else in the package.
 */
const screenedPayment = deploymentFields.extend({ version: z.literal(4), payment: paymentConfig, screening: screeningProfileSchema }).strict();
export const cctpPaymentDeploymentSchema = plainPayment.refine(separate, 'Keep the oracle separate from owner/deployer.')
  .refine((c) => c.payment.authority !== c.oracle, 'Customer authority must be separate from reviewer.');
export const cctpScreenedDeploymentSchema = screenedPayment.refine(separate, 'Keep the oracle separate from owner/deployer.')
  .refine((c) => c.payment.authority !== c.oracle, 'Customer authority must be separate from reviewer.')
  .refine((c) => ![c.deployer, c.owner, c.oracle, c.payment.authority, c.payment.sourceSender, c.payment.returnRecipient].includes(c.screening.issuer),
    'The screening issuer must be independent of the deployer, owner, oracle and customer roles.');
/** Either customer escrow: version 3 (payment) or 4 (screened). */
export const cctpCustomerDeploymentSchema = z.union([cctpPaymentDeploymentSchema, cctpScreenedDeploymentSchema]);

export function cctpDeploymentPlan(input: unknown) {
  const config = z.union([cctpDeploymentConfigSchema, cctpPaymentDeploymentSchema, cctpScreenedDeploymentSchema]).parse(input);
  const routeId = keccak256(stringToHex(route.id));
  const guardianAddress = getContractAddress({ from: config.deployer, nonce: config.deployerNonce }).toLowerCase() as Hex;
  const vault = getContractAddress({ from: config.deployer, nonce: config.deployerNonce + 1n }).toLowerCase() as Hex;
  const guardianData = encodeDeployData({ abi: guardian.abi, bytecode: guardian.bytecode, args: [config.owner, config.oracle] });
  const cctp = { transmitter: route.destination.transmitter, destinationMessenger: route.destination.messenger,
    sourceDomain: route.source.domain, sourceMessenger: route.source.messenger, sourceToken: route.source.usdc };
  const payment = 'payment' in config ? config.payment : undefined;
  const profile = 'screening' in config ? config.screening : undefined;
  if (payment && [payment.authority, payment.returnRecipient, ...payment.recipients].includes(vault)) throw new Error('Escrow cannot be a customer role or payout recipient.');
  if (profile && profile.issuer === vault) throw new Error('The escrow cannot be its own screening issuer.');
  const artifact = profile ? screenedEscrow : payment ? paymentEscrow : escrow;
  const escrowData = profile && payment ? encodeDeployData({ abi: screenedEscrow.abi, bytecode: screenedEscrow.bytecode,
    args: [route.destination.usdc, guardianAddress, routeId, cctp, payment, { providerIdHash: profile.providerIdHash, listIdHash: profile.listIdHash,
      issuer: profile.issuer, maxObservationAgeSeconds: Number(profile.maxObservationAgeSeconds), maxSnapshotAgeSeconds: Number(profile.maxSnapshotAgeSeconds) }] })
    : payment ? encodeDeployData({ abi: paymentEscrow.abi, bytecode: paymentEscrow.bytecode,
      args: [route.destination.usdc, guardianAddress, routeId, cctp, payment] }) :
      encodeDeployData({ abi: escrow.abi, bytecode: escrow.bytecode, args: [route.destination.usdc, guardianAddress, routeId, cctp] });
  const customer = payment && { authority: payment.authority, sourceSender: payment.sourceSender, returnRecipient: payment.returnRecipient, recoveryDelay: payment.recoveryDelay };
  const screening = profile && { profileHash: screeningProfileHash({ destinationChainId: BigInt(route.destination.chainId), vault, guardian: guardianAddress,
    routeId, token: route.destination.usdc.toLowerCase() as Hex }, profile), issuer: profile.issuer, startsPaused: true, executionMode: 'legacy', activeHead: null };
  return { version: profile ? 3 : payment ? 2 : 1, chainId: route.destination.chainId, route: route.id, routeId, config,
    contracts: { guardian: guardianAddress, vault },
    artifactHashes: { guardian: keccak256(guardian.bytecode), escrow: keccak256(artifact.bytecode) },
    transactions: [
      { step: 1, purpose: 'Deploy guardian with separate owner/oracle', from: config.deployer, nonce: config.deployerNonce, data: guardianData, value: '0' },
      { step: 2, purpose: profile ? 'Deploy screened customer payment USDC escrow (paused, legacy mode, no list head)' : payment ? 'Deploy customer payment USDC escrow' : 'Deploy authenticated USDC escrow', from: config.deployer, nonce: config.deployerNonce + 1n, data: escrowData, value: '0' },
      { step: 3, purpose: 'Configure rolling route budget', from: config.owner, to: guardianAddress,
        data: encodeFunctionData({ abi: guardian.abi, functionName: 'configureRoute', args: [routeId, config.capBaseUnits, config.windowSeconds] }), value: '0' },
      { step: 4, purpose: 'Grant only this escrow permission for this route', from: config.owner, to: guardianAddress,
        data: encodeFunctionData({ abi: guardian.abi, functionName: 'setProtected', args: [vault, routeId, true] }), value: '0' },
    ],
    ...(screening ? { screening } : {}),
    manifest: profile && customer ? { version: 4, vault, guardian: guardianAddress, operator: config.oracle, payment: customer,
      screening: { ...profile, maxObservationAgeSeconds: profile.maxObservationAgeSeconds.toString(), maxSnapshotAgeSeconds: profile.maxSnapshotAgeSeconds.toString() }, requests: [] }
      : customer ? { version: 3, vault, guardian: guardianAddress, operator: config.oracle, payment: customer, requests: [] } :
        { version: 2, vault, guardian: guardianAddress, operator: config.oracle, requests: [] },
    requirements: ['Confirm the pending deployer nonce immediately before sending. Any intervening deployment changes predicted addresses.',
      'Execute steps in order and confirm deployment/configuration receipts; do not burn USDC before validating the live bindings.',
      'Fund the deployer and owner with testnet ETH. The observer requires no key or gas.',
      'This package is for Ethereum Sepolia only; it contains no signatures and sends no transactions.',
      ...(profile ? ['The screened escrow starts paused in legacy mode with no list head. The customer authority schedules the unpause (one-day queue) only after deployment acceptance; advisory mode needs its own queued consent and an independent review first.'] : [])],
  };
}
