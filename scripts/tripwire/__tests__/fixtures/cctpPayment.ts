// Synthetic receipt vectors. Not a recorded Circle/testnet transfer.
import { keccak256, toHex } from 'viem';
import { cctpAttestedMessage, cctpPaymentHook, cctpPaymentReleaseId } from '../../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpEscrowAbi, cctpPaymentAbi } from '../../../../src/chains/evm/registry/cctp.js';
import { authenticatedFixture } from './cctpEscrow.js';
import { addressWord, beneficiary, bytesReplace, nonce, sender, vault } from './cctp.js';

export const paymentBindings = { authority: sender, sourceSender: sender, returnRecipient: sender, recoveryDelay: 3600n };
export function paymentFixture() {
  const f = authenticatedFixture();
  const intent = { recipient: beneficiary, returnRecipient: sender, operationId: toHex(1, { size: 32 }), policyHash: toHex(2, { size: 32 }) };
  const hook = cctpPaymentHook(intent);
  const message = bytesReplace(f.message, 376, hook), receivedBody = bytesReplace(f.receivedBody, 228, hook);
  f.replaceMessage(message); f.replaceDeposit({ hookData: hook, destinationCaller: addressWord(vault) }); f.replaceReceive({ caller: vault, messageBody: receivedBody });
  f.release.messageId = cctpPaymentReleaseId(route.destination.chainId, vault, route.source.domain, nonce);
  const bound = { messageId: f.release.messageId, operationId: intent.operationId, returnRecipient: intent.returnRecipient, intentPolicyHash: intent.policyHash };
  const requested = { messageId: f.release.messageId, to: beneficiary, amount: f.release.amount };
  const funded = { messageId: f.release.messageId, nonce, amount: f.release.amount,
    messageHash: keccak256(cctpAttestedMessage(message, nonce, 2000, receivedBody)) };
  f.destinationReceipt.logs.splice(2, 2,
    f.log(cctpPaymentAbi, 'PaymentCreditBound', bound, 7, vault, false),
    f.log(cctpEscrowAbi, 'ReleaseRequested', requested, 8, vault, false),
    f.log(cctpEscrowAbi, 'CctpEscrowFunded', funded, 9, vault, false));
  f.release.origin!.logIndex = 8;
  return { ...f, message, receivedBody, intent,
    replaceBound: (over: Partial<typeof bound>) => { f.destinationReceipt.logs[2] = f.log(cctpPaymentAbi, 'PaymentCreditBound', { ...bound, ...over }, 7, vault, false); },
  };
}
