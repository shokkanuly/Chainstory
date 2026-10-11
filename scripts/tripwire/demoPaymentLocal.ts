// Local-only demonstration. Synthetic CCTP harness; no public-network calls.
import assert from 'node:assert/strict';
import { formatUnits, keccak256, toHex } from 'viem';
import { actors, LOCAL_CHAIN_ID, type CallResult } from '../../src/tripwire/guardianVM.js';
import { cctpPaymentReleaseId } from '../../src/chains/evm/cctp.js';
import { paymentLocalFixture, PAYMENT_NET } from './paymentLocal.js';

const ok = (result: CallResult) => assert.equal(result.ok, true, result.error ?? 'Transaction failed');
const blocked = (result: CallResult, reason: string) => { assert.equal(result.ok, false); assert.equal(result.error, reason); };
const f = await paymentLocalFixture();
ok(await f.receive()); ok(await f.review()); ok(await f.execute());
console.log(`[1] Authenticated ordinary payment: ${formatUnits(PAYMENT_NET, 6)} USDC paid once.`);
blocked(await f.execute(), 'AlreadyExecuted');

const secondNonce = toHex(2n, { size: 32 });
const second = cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, secondNonce);
ok(await f.receive(f.message({ nonce: secondNonce, operationId: keccak256(toHex('manual-payment')), amount: 6_000_100n })));
ok(await f.review(second)); blocked(await f.execute(second), 'CustomerApprovalRequired');
ok(await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [second]));
blocked(await f.execute(second), 'PaymentDelayActive');
f.vm.warp(1800n); ok(await f.review(second)); ok(await f.execute(second));
console.log('[2] Large payment: oracle approval alone blocked; customer approval + matured delay + fresh review paid 6 USDC.');

const thirdNonce = toHex(3n, { size: 32 });
const third = cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, thirdNonce);
ok(await f.receive(f.message({ nonce: thirdNonce, operationId: keccak256(toHex('return-payment')), recipient: actors.owner.address })));
ok(await f.review(third)); blocked(await f.execute(third), 'RecipientNotPermitted');
ok(await f.requestReturn(third)); blocked(await f.execute(third), 'ReturnInProgress');
blocked(await f.executeReturn(third), 'ReturnNotReady');
f.vm.warp(3600n); ok(await f.executeReturn(third)); blocked(await f.executeReturn(third), 'CreditAlreadyReturned');
console.log(`[3] Unpermitted recipient: ${formatUnits(PAYMENT_NET, 6)} USDC returned once to the source-authenticated destination address.`);

const fourthNonce = toHex(4n, { size: 32 });
const fourth = cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, fourthNonce);
ok(await f.receive(f.message({ nonce: fourthNonce, operationId: keccak256(toHex('policy-change')) })));
ok(await f.review(fourth));
ok(await f.vm.sendContract(f.vault, actors.owner, 'revokeRecipient', [actors.attacker.address]));
blocked(await f.execute(fourth), 'StalePaymentReview');
console.log('[4] Customer policy version changed: existing ALLOW stopped at execution.');
const credited = await f.vm.readContract<bigint>(f.vault, 'totalCredited');
const paid = await f.vm.readContract<bigint>(f.vault, 'totalPaid');
const returned = await f.vm.readContract<bigint>(f.vault, 'totalReturned');
const outstanding = await f.vm.readContract<bigint>(f.vault, 'outstandingCredit');
assert.equal(credited, paid + returned + outstanding);
console.log(`Accounting in exact base units: ${credited} credited = ${paid} paid + ${returned} returned + ${outstanding} outstanding.`);
console.log('Synthetic local workflow complete. No public transaction sent.');
