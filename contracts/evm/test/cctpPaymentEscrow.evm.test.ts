import { describe, expect, it } from 'vitest';
import { concatHex, encodeFunctionData, hashStruct, hashTypedData, keccak256, toHex, zeroAddress, type Hex } from 'viem';
import { paymentLocalFixture, LOCAL_PAYMENT_POLICY, PAYMENT_NET, PAYMENT_NONCE, PAYMENT_ROUTE } from '../../../scripts/tripwire/paymentLocal.js';
import { actors, LOCAL_CHAIN_ID } from '../../../src/tripwire/guardianVM.js';
import { cctpAddressWord, cctpBeneficiaryHook, cctpPaymentReleaseId } from '../../../src/chains/evm/cctp.js';
import { PAYMENT_RELEASE_REVIEW_TYPES, RELEASE_REVIEW_TYPES, ReleaseDecision, signPaymentReleaseReview, signReleaseReview } from '../../../scripts/tripwire/review.js';
import { ResponseTier, signAttestation } from '../../../src/tripwire/onChain.js';
import escrowArtifact from '../../../scripts/tripwire/testnet/cctpPaymentEscrow.artifact.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';

type Fixture = Awaited<ReturnType<typeof paymentLocalFixture>>;
const replace = (raw: Hex, offset: number, value: Hex): Hex =>
  `0x${raw.slice(2, 2 + offset * 2)}${value.slice(2)}${raw.slice(2 + offset * 2 + value.length - 2)}`;
async function funded(policy = LOCAL_PAYMENT_POLICY, recipients = [actors.attacker.address]) {
  const f = await paymentLocalFixture(policy, recipients);
  expect((await f.receive()).ok).toBe(true);
  return f;
}
async function accounting(f: Fixture, paid = 0n, returned = 0n, credited = PAYMENT_NET) {
  expect(await f.vm.readContract(f.vault, 'totalCredited')).toBe(credited);
  expect(await f.vm.readContract(f.vault, 'totalPaid')).toBe(paid);
  expect(await f.vm.readContract(f.vault, 'totalReturned')).toBe(returned);
  expect(await f.vm.readContract(f.vault, 'outstandingCredit')).toBe(credited - paid - returned);
}

describe('CCTP customer payment policy', () => {
  it.each(['zero authority', 'oracle authority', 'zero return', 'zero source', 'short recovery', 'long recovery',
    'zero maximum', 'approval above maximum', 'delay above maximum', 'excessive delay', 'zero recipient', 'duplicate recipient'])
    ('refuses an unsafe deployment: %s', async (kind) => {
      const f = await paymentLocalFixture();
      const config = { authority: actors.owner.address as Hex, returnRecipient: actors.bridge.address as Hex,
        sourceSender: actors.owner.address as Hex, recoveryDelay: 3600n, policy: { ...LOCAL_PAYMENT_POLICY }, recipients: [actors.attacker.address as Hex] };
      if (kind === 'zero authority') config.authority = zeroAddress;
      if (kind === 'oracle authority') config.authority = actors.oracle.address;
      if (kind === 'zero return') config.returnRecipient = zeroAddress;
      if (kind === 'zero source') config.sourceSender = zeroAddress;
      if (kind === 'short recovery') config.recoveryDelay = 3599n;
      if (kind === 'long recovery') config.recoveryDelay = 30n * 86400n + 1n;
      if (kind === 'zero maximum') config.policy.maxPayment = 0n;
      if (kind === 'approval above maximum') config.policy.manualApprovalAbove = config.policy.maxPayment + 1n;
      if (kind === 'delay above maximum') config.policy.delayAbove = config.policy.maxPayment + 1n;
      if (kind === 'excessive delay') config.policy.delaySeconds = 30n * 86400n + 1n;
      if (kind === 'zero recipient') config.recipients = [zeroAddress];
      if (kind === 'duplicate recipient') config.recipients.push(actors.attacker.address);
      await expect(f.vm.deployContract(escrowArtifact, [f.token.address, f.vm.address, PAYMENT_ROUTE,
        { transmitter: f.transmitter.address, destinationMessenger: actors.bridge.address, sourceDomain: 6,
          sourceMessenger: route.source.messenger, sourceToken: route.source.usdc }, config])).rejects.toThrow('InvalidPaymentPolicy');
    });
  it('authenticates immutable intent, exact credit and the new review digest, then pays once', async () => {
    const f = await funded();
    expect(await f.vm.readContract(f.vault, 'REVIEW_FORMAT_VERSION')).toBe(3n);
    expect(await f.vm.readContract(f.vault, 'releaseId', [PAYMENT_NONCE])).toBe(f.id);
    const r = await f.reviewData(); const p = await f.policySnapshot();
    const releaseHash = hashStruct({ types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', data: r });
    expect(await f.vm.readContract(f.vault, 'hashReleaseReview', [f.id, r.decision, r.minimumTier, r.validUntil, r.nonce])).toBe(hashTypedData({
      domain: { name: 'TripwireProtectedVault', version: '2', chainId: LOCAL_CHAIN_ID, verifyingContract: f.vault.address },
      types: PAYMENT_RELEASE_REVIEW_TYPES, primaryType: 'PaymentReleaseReview', message: { releaseHash, policyVersion: p.version, policyHash: p.hash },
    }));
    expect(await f.vm.readContract(f.vault, 'credits', [f.id])).toEqual([
      actors.bridge.address, keccak256(toHex('first-business-operation')), p.hash, 0n, false,
    ]);
    expect((await f.execute()).error).toBe('ReleaseNotReviewed');
    expect((await f.review()).ok).toBe(true);
    expect((await f.execute()).ok).toBe(true);
    expect((await f.execute()).error).toBe('AlreadyExecuted');
    expect((await f.requestReturn()).error).toBe('AlreadyExecuted');
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(PAYMENT_NET);
    await accounting(f, PAYMENT_NET);
  });

  it.each(['maxPayment', 'recipient', 'approval', 'pause'] as const)('a valid oracle cannot bypass the customer %s rule', async (rule) => {
    const policy = { ...LOCAL_PAYMENT_POLICY,
      maxPayment: rule === 'maxPayment' ? PAYMENT_NET - 1n : LOCAL_PAYMENT_POLICY.maxPayment,
      manualApprovalAbove: rule === 'maxPayment' || rule === 'approval' ? 0n : LOCAL_PAYMENT_POLICY.manualApprovalAbove,
      delayAbove: rule === 'maxPayment' ? 0n : LOCAL_PAYMENT_POLICY.delayAbove, delaySeconds: 0n };
    const f = await funded(policy, rule === 'recipient' ? [] : [actors.attacker.address]);
    if (rule === 'pause') await f.vm.sendContract(f.vault, actors.owner, 'pausePayments', []);
    await f.review();
    expect((await f.execute()).error).toBe({ maxPayment: 'PaymentLimitExceeded', recipient: 'RecipientNotPermitted', approval: 'CustomerApprovalRequired', pause: 'PaymentsPaused' }[rule]);
    await accounting(f);
  });

  it('only customer authority can approve; approvals are for the current policy version', async () => {
    const f = await funded({ ...LOCAL_PAYMENT_POLICY, manualApprovalAbove: 0n });
    expect((await f.vm.sendContract(f.vault, actors.oracle, 'approvePayment', [f.id])).error).toBe('OnlyPolicyAuthority');
    expect((await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id])).ok).toBe(true);
    await f.review(); expect((await f.execute()).ok).toBe(true);
  });

  it('retries cannot shorten or restart the customer delay; expiry still requires a fresh review', async () => {
    const f = await funded({ ...LOCAL_PAYMENT_POLICY, delayAbove: 0n });
    await f.review(); const ready = await f.vm.readContract<bigint>(f.vault, 'paymentDelayUntil', [f.id]);
    f.vm.warp(300n); await f.review();
    expect(await f.vm.readContract(f.vault, 'paymentDelayUntil', [f.id])).toBe(ready);
    expect((await f.execute()).error).toBe('PaymentDelayActive');
    f.vm.warp(1500n); expect((await f.execute()).error).toBe('ReviewExpired');
    await f.review(); expect((await f.execute()).ok).toBe(true);
  });

  it('rejects an old review type and a new review for another vault, chain or policy', async () => {
    const f = await funded(); const r = await f.reviewData(); const p = await f.policySnapshot();
    const signatures = [
      await signReleaseReview(actors.oracle, f.vault.address, r, LOCAL_CHAIN_ID),
      await signPaymentReleaseReview(actors.oracle, actors.owner.address, r, p, LOCAL_CHAIN_ID),
      await signPaymentReleaseReview(actors.oracle, f.vault.address, r, p, LOCAL_CHAIN_ID + 1),
      await signPaymentReleaseReview(actors.oracle, f.vault.address, r, { ...p, version: p.version + 1n }, LOCAL_CHAIN_ID),
    ];
    for (const signature of signatures) expect((await f.vm.sendContract(f.vault, actors.relayer, 'reviewRelease',
      [f.id, r.decision, r.minimumTier, r.validUntil, r.nonce, signature])).error).toBe('InvalidReviewer');
  });

  it('policy changes invalidate signatures, existing ALLOWs and customer approvals', async () => {
    const f = await funded({ ...LOCAL_PAYMENT_POLICY, manualApprovalAbove: 0n });
    const original = await f.policySnapshot();
    await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id]); await f.review();
    const next = { ...LOCAL_PAYMENT_POLICY, manualApprovalAbove: 0n, maxPayment: 11_000_000n };
    await f.vm.sendContract(f.vault, actors.owner, 'schedulePolicy', [next]);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'applyPolicy', [next])).error).toBe('PolicyChangeNotReady');
    f.vm.warp(86400n);
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'applyPolicy', [{ ...next, maxPayment: 12_000_000n }])).error).toBe('PolicyChangeNotReady');
    expect((await f.vm.sendContract(f.vault, actors.attacker, 'applyPolicy', [next])).ok).toBe(true);
    const current = await f.policySnapshot(); expect(current.version).toBe(original.version + 1n); expect(current.hash).not.toBe(original.hash);
    const r = await f.reviewData();
    const staleSig = await signPaymentReleaseReview(actors.oracle, f.vault.address, r, original, LOCAL_CHAIN_ID);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'reviewRelease', [f.id, r.decision, r.minimumTier, r.validUntil, r.nonce, staleSig])).error).toBe('InvalidReviewer');
    // Restore a long-lived-enough fresh review at the current version, then change policy immediately.
    await f.review();
    await f.vm.sendContract(f.vault, actors.owner, 'revokeRecipient', [actors.relayer.address]);
    expect((await f.execute()).error).toBe('StalePaymentReview');
    await f.review(); expect((await f.execute()).error).toBe('CustomerApprovalRequired');
    await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id]);
    expect((await f.execute()).ok).toBe(true);
  });

  it('an older source policy intent requires customer consent even below the manual threshold', async () => {
    const f = await paymentLocalFixture();
    expect((await f.receive(f.message({ policyHash: keccak256(toHex('old-intent-policy')) }))).ok).toBe(true);
    await f.review(); expect((await f.execute()).error).toBe('CustomerApprovalRequired');
    await f.vm.sendContract(f.vault, actors.owner, 'approvePayment', [f.id]); expect((await f.execute()).ok).toBe(true);
  });

  it('recipient grants and unpause wait one day; emergency revocation cancels a queued change', async () => {
    const f = await funded(LOCAL_PAYMENT_POLICY, []);
    await f.vm.sendContract(f.vault, actors.owner, 'scheduleRecipient', [actors.attacker.address]);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyRecipient', [actors.attacker.address])).error).toBe('PolicyChangeNotReady');
    f.vm.warp(86400n); expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyRecipient', [actors.attacker.address])).ok).toBe(true);
    await f.vm.sendContract(f.vault, actors.owner, 'pausePayments', []);
    await f.vm.sendContract(f.vault, actors.owner, 'scheduleUnpause', []);
    await f.vm.sendContract(f.vault, actors.owner, 'revokeRecipient', [actors.attacker.address]);
    f.vm.warp(86400n); expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyUnpause', [])).error).toBe('PolicyChangeNotReady');
    await f.vm.sendContract(f.vault, actors.owner, 'scheduleUnpause', []);
    expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyUnpause', [])).error).toBe('PolicyChangeNotReady');
    f.vm.warp(86400n); expect((await f.vm.sendContract(f.vault, actors.relayer, 'applyUnpause', [])).ok).toBe(true);
    await f.review(); expect((await f.execute()).error).toBe('RecipientNotPermitted');
  });

  it.each(['schedulePolicy', 'scheduleRecipient', 'revokeRecipient', 'pausePayments', 'scheduleUnpause'] as const)('reviewer cannot call %s', async (name) => {
    const f = await funded(); const args = name === 'schedulePolicy' ? [LOCAL_PAYMENT_POLICY] :
      name === 'scheduleRecipient' || name === 'revokeRecipient' ? [actors.attacker.address] : [];
    expect((await f.vm.sendContract(f.vault, actors.oracle, name, args)).error).toBe('OnlyPolicyAuthority');
  });
});

describe('funded credit recovery', () => {
  it('source sender cannot use an unapproved return address to bypass customer payout permissions', async () => {
    const f = await paymentLocalFixture();
    expect((await f.receive(f.message({ returnRecipient: actors.attacker.address }))).error).toBe('InvalidCctpBinding');
    await accounting(f, 0n, 0n, 0n);
  });

  it('an unrelated depositor cannot reserve a customer business-operation ID', async () => {
    const f = await paymentLocalFixture();
    expect((await f.receive(replace(f.message(), 248, cctpAddressWord(actors.attacker.address)))).error).toBe('InvalidCctpBinding');
    await accounting(f, 0n, 0n, 0n);
  });
  it.each(['payout', 'return'] as const)('a failed %s transfer rolls back credit state, totals and guardian spend', async (action) => {
    const f = await paymentLocalFixture(LOCAL_PAYMENT_POLICY, [actors.attacker.address], true); await f.receive();
    if (action === 'payout') await f.review();
    else { await f.requestReturn(); f.vm.warp(3600n); }
    await f.vm.sendContract(f.token, actors.owner, 'setFailure', [true]);
    expect((action === 'payout' ? await f.execute() : await f.executeReturn()).ok).toBe(false);
    await accounting(f);
    expect(await f.vm.read('rollingUsage', [PAYMENT_ROUTE])).toBe(0n);
    const credit = await f.vm.readContract<readonly [Hex, Hex, Hex, bigint, boolean]>(f.vault, 'credits', [f.id]);
    expect(credit[4]).toBe(false);
    await f.vm.sendContract(f.token, actors.owner, 'setFailure', [false]);
    expect((action === 'payout' ? await f.execute() : await f.executeReturn()).ok).toBe(true);
    await accounting(f, action === 'payout' ? PAYMENT_NET : 0n, action === 'return' ? PAYMENT_NET : 0n);
  });

  it.each(['payout', 'return'] as const)('%s rejects token reentrancy and still completes one exact transfer', async (action) => {
    const f = await paymentLocalFixture(LOCAL_PAYMENT_POLICY, [actors.attacker.address], true); await f.receive();
    if (action === 'payout') await f.review();
    else { await f.requestReturn(); f.vm.warp(3600n); }
    await f.vm.sendContract(f.token, actors.owner, 'setCallback', [f.vault.address,
      encodeFunctionData({ abi: f.vault.abi, functionName: 'executeReturn', args: [f.id] })]);
    expect((action === 'payout' ? await f.execute() : await f.executeReturn()).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'callbackError')).toBe(keccak256(toHex('ReentrancyGuardReentrantCall()')).slice(0, 10));
    await accounting(f, action === 'payout' ? PAYMENT_NET : 0n, action === 'return' ? PAYMENT_NET : 0n);
  });
  it('return intent locks payout immediately; exact net returns once at the delay boundary', async () => {
    const f = await funded(); await f.review(); await accounting(f);
    expect((await f.requestReturn()).ok).toBe(true);
    expect((await f.requestReturn()).error).toBe('ReturnAlreadyRequested');
    expect((await f.execute()).error).toBe('ReturnInProgress');
    expect((await f.review()).error).toBe('ReturnInProgress');
    f.vm.warp(3599n); expect((await f.executeReturn()).error).toBe('ReturnNotReady');
    f.vm.warp(1n); expect((await f.executeReturn()).ok).toBe(true);
    expect((await f.executeReturn()).error).toBe('CreditAlreadyReturned');
    expect((await f.execute()).error).toBe('ReleaseRejected');
    expect((await f.review()).error).toBe('ReleaseRejected');
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.bridge.address])).toBe(PAYMENT_NET);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(PAYMENT_NET * 10n);
    await accounting(f, 0n, PAYMENT_NET);
  });

  it.each(['owner', 'oracle', 'attacker'] as const)('%s cannot request a return or redirect its recipient', async (actor) => {
    const f = await funded();
    expect((await f.vm.sendContract(f.vault, actors[actor], 'requestReturn', [f.id])).error).toBe('OnlyReturnRecipient');
    expect((await f.executeReturn()).error).toBe('ReturnNotReady');
    await accounting(f);
  });

  it.each([ReleaseDecision.HOLD, ReleaseDecision.REJECT])('returns a funded %s request during customer pause and guardian FREEZE', async (decision) => {
    const f = await funded(); await f.review(f.id, { decision });
    await f.vm.sendContract(f.vault, actors.owner, 'pausePayments', []);
    const a = { routeId: PAYMENT_ROUTE, riskScore: 100n, validUntil: f.vm.now + 300n, nonce: 1n };
    await f.vm.send(actors.relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce,
      await signAttestation(actors.oracle, f.vm.address, a, LOCAL_CHAIN_ID)]);
    await f.requestReturn(); f.vm.warp(3600n); expect((await f.executeReturn()).ok).toBe(true);
    expect(await f.vm.read('currentTier', [PAYMENT_ROUTE])).toBe(ResponseTier.FREEZE);
    await accounting(f, 0n, PAYMENT_NET);
  });

  it('separate credits cannot spend one another or donations, and duplicate operations do not mint', async () => {
    const f = await funded();
    const nonce = toHex(2n, { size: 32 }); const id = cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, nonce);
    expect((await f.receive(f.message({ nonce }))).error).toBe('OperationAlreadyFunded');
    expect(await f.vm.readContract(f.transmitter, 'usedNonces', [nonce])).toBe(0n);
    expect((await f.receive(f.message({ nonce, operationId: keccak256(toHex('second-operation')) }))).ok).toBe(true);
    await f.review(); await f.execute(); await f.requestReturn(id); f.vm.warp(3600n); await f.executeReturn(id);
    await accounting(f, PAYMENT_NET, PAYMENT_NET, PAYMENT_NET * 2n);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(PAYMENT_NET * 10n);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'requestReturn', [keccak256(toHex('donation'))])).error).toBe('UnknownRelease');
  });

  it('return cannot succeed before it is requested or after execution', async () => {
    const f = await funded(); expect((await f.executeReturn()).error).toBe('ReturnNotReady');
    await f.review(); await f.execute(); expect((await f.executeReturn()).error).toBe('AlreadyExecuted');
  });

  it.each([
    [440, cctpAddressWord(zeroAddress)], [440, `0x01${'00'.repeat(31)}` as Hex],
    [472, toHex(0n, { size: 32 })], [504, toHex(0n, { size: 32 })],
  ])('malformed return/operation/policy binding at offset %s creates no credit', async (offset, value) => {
    const f = await paymentLocalFixture(); expect((await f.receive(replace(f.message(), offset as number, value as Hex))).ok).toBe(false);
    await accounting(f, 0n, 0n, 0n);
    expect(await f.vm.readContract(f.transmitter, 'usedNonces', [PAYMENT_NONCE])).toBe(0n);
  });

  it('refuses the legacy hook and extra application words', async () => {
    const f = await paymentLocalFixture(); const raw = f.message();
    const legacy = concatHex([`0x${raw.slice(2, 2 + 376 * 2)}`, cctpBeneficiaryHook(actors.attacker.address)]);
    expect((await f.receive(legacy)).error).toBe('UnsupportedCctpMessage');
    expect((await f.receive(concatHex([raw, '0x00']))).error).toBe('UnsupportedCctpMessage');
    await accounting(f, 0n, 0n, 0n);
  });
});
