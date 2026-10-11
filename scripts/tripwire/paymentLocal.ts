// Synthetic local-chain fixture shared by contract tests and the local payment demo.
// No RPC, public transactions, user keys, or Circle security claims.
import { readFileSync } from 'node:fs';
import solc from 'solc';
import { concatHex, keccak256, toHex, type Hex } from 'viem';
import { standardJsonInput } from '../../contracts/evm/compile.mjs';
import { actors, GuardianVM, LOCAL_CHAIN_ID, type GuardianArtifact } from '../../src/tripwire/guardianVM.js';
import guardian from '../../src/tripwire/guardian.artifact.js';
import demo from './testnet/contracts.artifact.js';
import escrowArtifact from './testnet/cctpPaymentEscrow.artifact.js';
import { cctpAddressWord, cctpPaymentHook, cctpPaymentReleaseId } from '../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../src/chains/evm/registry/cctp.js';
import { ReleaseDecision, signPaymentReleaseReview, type ReleaseReview } from './review.js';
import { ResponseTier } from '../../src/tripwire/onChain.js';

const input = standardJsonInput('TripwireDemo.sol');
input.sources['CctpHarness.sol'] = { content: readFileSync(new URL('../../contracts/evm/test/fixtures/CctpHarness.sol', import.meta.url), 'utf8')
  .replace('../../src/TripwireDemo.sol', 'TripwireDemo.sol') };
input.sources['PaymentTokenHarness.sol'] = { content: readFileSync(new URL('../../contracts/evm/test/fixtures/PaymentTokenHarness.sol', import.meta.url), 'utf8')
  .replace('../../src/TripwireDemo.sol', 'TripwireDemo.sol') };
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
if (compiled.errors?.some((e: { severity: string }) => e.severity === 'error')) throw new Error('Local CCTP harness compilation failed.');
const contract = compiled.contracts['CctpHarness.sol'].CctpHarness;
/** Test-only Circle transmitter stand-in: verifies the relayer's signature and mints the attested amount. */
export const harness: GuardianArtifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
const testToken = compiled.contracts['PaymentTokenHarness.sol'].PaymentTokenHarness;
const faultToken: GuardianArtifact = { abi: testToken.abi, bytecode: `0x${testToken.evm.bytecode.object}` };
export const PAYMENT_ROUTE = keccak256(toHex('local-cctp-payment-policy'));
export const PAYMENT_OPERATION = keccak256(toHex('first-business-operation'));
export const PAYMENT_NONCE = toHex(1n, { size: 32 });
export const PAYMENT_AMOUNT = 1_000_001n;
export const PAYMENT_FEE = 100n;
export const PAYMENT_NET = PAYMENT_AMOUNT - PAYMENT_FEE;
export const LOCAL_PAYMENT_POLICY = { maxPayment: 10_000_000n, manualApprovalAbove: 5_000_000n, delayAbove: 5_000_000n, delaySeconds: 1800n };
export type LocalPaymentPolicy = typeof LOCAL_PAYMENT_POLICY;
type ReleaseTuple = [Hex, bigint, number, bigint, Hex, bigint, number];
const u32 = (n: number) => toHex(n, { size: 4 });
const u256 = (n: bigint) => toHex(n, { size: 32 });

export async function paymentLocalFixture(policy = LOCAL_PAYMENT_POLICY, recipients = [actors.attacker.address], withFaultToken = false) {
  const vm = await GuardianVM.deploy(guardian);
  const token = await vm.deployContract(withFaultToken ? faultToken : demo.DemoUSDC, [actors.owner.address]);
  const transmitter = await vm.deployContract(harness, [actors.relayer.address, token.address]);
  const vault = await vm.deployContract(escrowArtifact, [token.address, vm.address, PAYMENT_ROUTE,
    { transmitter: transmitter.address, destinationMessenger: actors.bridge.address, sourceDomain: 6,
      sourceMessenger: route.source.messenger, sourceToken: route.source.usdc },
    { authority: actors.owner.address, returnRecipient: actors.bridge.address, sourceSender: actors.owner.address, recoveryDelay: 3600n, policy, recipients }]);
  await vm.sendContract(token, actors.owner, 'mint', [vault.address, PAYMENT_NET * 10n]);
  await vm.sendContract(token, actors.owner, 'transferOwnership', [transmitter.address]);
  await vm.send(actors.owner, 'configureRoute', [PAYMENT_ROUTE, 100_000_000n, 3600n]);
  await vm.send(actors.owner, 'setProtected', [vault.address, PAYMENT_ROUTE, true]);
  const intentPolicyHash = await vm.readContract<Hex>(vault, 'policyHash');
  const id = cctpPaymentReleaseId(LOCAL_CHAIN_ID, vault.address, 6, PAYMENT_NONCE);
  const message = (over: Partial<{ nonce: Hex; operationId: Hex; policyHash: Hex; recipient: Hex; returnRecipient: Hex; amount: bigint; fee: bigint }> = {}) => {
    const body = concatHex([u32(1), cctpAddressWord(route.source.usdc), cctpAddressWord(vault.address), u256(over.amount ?? PAYMENT_AMOUNT),
      cctpAddressWord(actors.owner.address), u256(1000n), u256(over.fee ?? PAYMENT_FEE), u256(0n),
      cctpPaymentHook({ recipient: over.recipient ?? actors.attacker.address, returnRecipient: over.returnRecipient ?? actors.bridge.address,
        operationId: over.operationId ?? PAYMENT_OPERATION, policyHash: over.policyHash ?? intentPolicyHash })]);
    return concatHex([u32(1), u32(6), u32(0), over.nonce ?? PAYMENT_NONCE, cctpAddressWord(route.source.messenger),
      cctpAddressWord(actors.bridge.address), cctpAddressWord(vault.address), u32(2000), u32(2000), body]);
  };
  const receive = async (raw = message()) => vm.sendContract(vault, actors.attacker, 'receiveCctp',
    [raw, await actors.relayer.sign({ hash: keccak256(raw) })]);
  const policySnapshot = async () => ({ version: await vm.readContract<bigint>(vault, 'policyVersion'), hash: await vm.readContract<Hex>(vault, 'policyHash') });
  const reviewData = async (messageId = id, over: Partial<ReleaseReview> = {}): Promise<ReleaseReview> => {
    const r = await vm.readContract<ReleaseTuple>(vault, 'releases', [messageId]);
    return { messageId, routeId: PAYMENT_ROUTE, token: token.address, recipient: r[0], amount: r[1],
      decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: r[5] + 1n, ...over };
  };
  const review = async (messageId = id, over: Partial<ReleaseReview> = {}) => {
    const r = await reviewData(messageId, over);
    const signature = await signPaymentReleaseReview(actors.oracle, vault.address, r, await policySnapshot(), LOCAL_CHAIN_ID);
    return vm.sendContract(vault, actors.relayer, 'reviewRelease', [messageId, r.decision, r.minimumTier, r.validUntil, r.nonce, signature]);
  };
  const execute = (messageId = id) => vm.sendContract(vault, actors.relayer, 'executeRelease', [messageId]);
  const requestReturn = (messageId = id) => vm.sendContract(vault, actors.bridge, 'requestReturn', [messageId]);
  const executeReturn = (messageId = id) => vm.sendContract(vault, actors.relayer, 'executeReturn', [messageId]);
  return { vm, token, transmitter, vault, id, message, receive, review, reviewData, policySnapshot, execute, requestReturn, executeReturn };
}
