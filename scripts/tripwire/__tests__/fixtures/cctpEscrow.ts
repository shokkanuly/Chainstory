import { keccak256 } from 'viem';
import { cctpAddressWord, cctpAttestedMessage, cctpEscrowReleaseId } from '../../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpEscrowAbi } from '../../../../src/chains/evm/registry/cctp.js';
import { bytesReplace, fixture, nonce, vault } from './cctp.js';

export function authenticatedFixture() {
  const f = fixture();
  const message = bytesReplace(f.message, 108, cctpAddressWord(vault));
  f.replaceMessage(message); f.replaceDeposit({ destinationCaller: cctpAddressWord(vault) }); f.replaceReceive({ caller: vault });
  f.release.messageId = cctpEscrowReleaseId(route.destination.chainId, vault, route.source.domain, nonce);
  const requested = { messageId: f.release.messageId, to: f.release.recipient, amount: f.release.amount };
  const funded = { messageId: f.release.messageId, nonce,
    messageHash: keccak256(cctpAttestedMessage(message, nonce, 2000, f.receivedBody)), amount: f.release.amount };
  const requestLog = f.log(cctpEscrowAbi, 'ReleaseRequested', requested, 7, vault, false);
  f.destinationReceipt.logs.push(requestLog, f.log(cctpEscrowAbi, 'CctpEscrowFunded', funded, 8, vault, false));
  f.release.origin = { chainId: route.destination.chainId, address: vault, blockNumber: requestLog.blockNumber,
    blockHash: requestLog.blockHash, transactionHash: requestLog.transactionHash, logIndex: 7 };
  return { ...f, message, funded,
    replaceFunded: (over: Partial<typeof funded>) => { f.destinationReceipt.logs[3] = f.log(cctpEscrowAbi, 'CctpEscrowFunded', { ...funded, ...over }, 8, vault, false); },
    replaceRequested: (over: Partial<typeof requested>) => { f.destinationReceipt.logs[2] = f.log(cctpEscrowAbi, 'ReleaseRequested', { ...requested, ...over }, 7, vault, false); },
  };
}
