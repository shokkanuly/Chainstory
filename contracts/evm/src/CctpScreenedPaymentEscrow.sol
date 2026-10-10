// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CctpPaymentEscrow} from "./CctpPaymentEscrow.sol";
import {ITripwireOracle} from "./TripwireDemo.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";

/// Customer payment escrow whose every ALLOW carries an independent issuer's
/// signed screening receipt for that exact payment, verified here when the
/// review lands and again at execution (H4c3a; ADR-045, ADR-047).
/// The reviewer cannot invent a NOT_LISTED result: only the configured issuer's
/// signature over the active list head and this payment's context counts.
/// Local prototype; not deployed or externally audited.
contract CctpScreenedPaymentEscrow is CctpPaymentEscrow {
    enum ExecutionMode { LEGACY_ENFORCED, ADVISORY_V1 }
    struct ScreeningProfile {
        bytes32 providerIdHash;
        bytes32 listIdHash;
        address issuer;
        uint32 maxObservationAgeSeconds;
        uint32 maxSnapshotAgeSeconds;
    }
    struct ScreeningReceipt {
        bytes32 profileHash;
        bytes32 headHash;
        bytes32 paymentContextHash;
        uint8 outcome;
        uint64 checkedAt;
        uint64 validUntil;
    }
    struct Head { bytes32 hash; uint64 revision; uint64 listAsOf; uint64 validUntil; }
    struct Screened { bytes32 receiptHash; bytes32 headHash; uint64 validUntil; }

    uint256 public constant SCREENING_ESCROW_VERSION = 2;
    uint8 public constant NOT_LISTED = 1;
    bytes32 public constant PAYMENT_HOOK_V2 = keccak256("Tripwire/CCTP/v2/USDC/payment/v2");
    bytes32 private constant ID_DOMAIN_V2 = keccak256("Tripwire/CCTP/v2/payment-escrow/v2");
    bytes32 private constant PROFILE_NAMESPACE = keccak256("Tripwire/Screening/profile/v1");
    bytes32 private constant PAYMENT_NAMESPACE = keccak256("Tripwire/Screening/payment/v1");
    bytes32 public constant HEAD_TYPEHASH = keccak256(
        "ScreeningHead(bytes32 profileHash,uint64 revision,bytes32 snapshotDigest,uint64 listAsOf,uint64 validUntil)");
    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "ScreeningReceipt(bytes32 profileHash,bytes32 headHash,bytes32 paymentContextHash,uint8 outcome,uint64 checkedAt,uint64 validUntil)");
    /// Review format 4. A format-3 signature cannot match: the signed type has different fields.
    bytes32 public constant SCREENED_REVIEW_TYPEHASH = keccak256(
        "PaymentReleaseReview(bytes32 releaseHash,uint256 policyVersion,bytes32 policyHash,bytes32 screeningReceiptHash,bytes32 screeningHeadHash,uint64 screeningValidUntil)");

    ScreeningProfile public screeningProfile;
    /// Zero while the customer has revoked screening: nothing can be allowed until a new profile is applied.
    bytes32 public screeningProfileHash;
    ExecutionMode public executionMode;
    Head public activeHead;
    mapping(bytes32 => Screened) public screened;
    // Set only for the duration of one reviewScreenedRelease call.
    bytes32 private transient pendingReceipt;
    bytes32 private transient pendingHead;
    uint64 private transient pendingValidUntil;

    event ScreeningProfileCommitted(bytes32 indexed profileHash, address indexed issuer);
    event ScreeningHeadRegistered(bytes32 indexed headHash, uint64 revision, uint64 listAsOf, uint64 validUntil);
    event ScreeningReceiptAccepted(bytes32 indexed messageId, bytes32 indexed receiptHash, bytes32 headHash, uint64 validUntil);
    error InvalidScreeningProfile();
    error ScreeningRevoked();
    error ScreeningIssuerConflict();
    error InvalidScreeningHead();
    error ScreeningHeadOutOfTime();
    error ScreeningHeadConflict();
    error ScreeningHeadRollback();
    error InvalidIssuerSignature();
    error ScreeningNotActive();
    error ScreeningWrongPayment();
    error ScreeningNotCleared();
    error ScreeningOutOfTime();
    error ReviewOutlivesScreening();
    error ScreeningProofRequired();
    error StaleScreening();

    constructor(IERC20 token_, ITripwireGuardian guardian_, bytes32 routeId_, CctpConfig memory cctp, PaymentConfig memory config,
        ScreeningProfile memory profile)
        CctpPaymentEscrow(token_, guardian_, routeId_, cctp, config)
    {
        _setProfile(profile, address(guardian_), routeId_, address(token_), ITripwireOracle(address(guardian_)).oracle(), config.authority);
        // A new profile starts paused in legacy mode with no usable head; the
        // customer unpauses through the one-day queue once acceptance is done.
        paymentsPaused = true;
        policyHash = keccak256(bytes.concat(
            abi.encode(ID_DOMAIN_V2, block.chainid, address(this), routeId_, address(token_), address(guardian_), config),
            abi.encode(uint8(ExecutionMode.LEGACY_ENFORCED), screeningProfileHash)));
        // Supersedes the version-1 event the base constructor emitted with the v1 namespace.
        emit PolicyCommitted(1, policyHash, keccak256("screening-v1"));
    }

    function REVIEW_FORMAT_VERSION() public pure override returns (uint256) { return 4; }
    function _paymentHook() internal pure override returns (bytes32) { return PAYMENT_HOOK_V2; }

    function releaseId(bytes32 nonce) public view override returns (bytes32) {
        return keccak256(abi.encode(ID_DOMAIN_V2, block.chainid, address(this), sourceDomain, nonce));
    }

    // --- screening profile, mode and list head ---------------------------------

    function _setProfile(ScreeningProfile memory p, address guardian_, bytes32 routeId_, address token_, address oracle_, address authority_) private {
        if (p.providerIdHash == 0 || p.listIdHash == 0 || p.issuer == address(0) || p.issuer == address(this) ||
            p.issuer == oracle_ || p.issuer == authority_ ||
            p.maxObservationAgeSeconds < 30 || p.maxObservationAgeSeconds > 600 ||
            p.maxSnapshotAgeSeconds < p.maxObservationAgeSeconds || p.maxSnapshotAgeSeconds > 86_400) revert InvalidScreeningProfile();
        screeningProfile = p;
        screeningProfileHash = keccak256(bytes.concat(
            abi.encode(PROFILE_NAMESPACE, block.chainid, address(this), guardian_, routeId_, token_),
            abi.encode(p.providerIdHash, p.listIdHash, p.issuer, uint8(0), p.maxObservationAgeSeconds, p.maxSnapshotAgeSeconds)));
        delete activeHead;
        emit ScreeningProfileCommitted(screeningProfileHash, p.issuer);
    }

    /// Tightening is immediate: no receipt is usable until a new profile is applied through the queue.
    function revokeScreeningProfile() external onlyPolicyAuthority {
        screeningProfileHash = 0;
        delete activeHead;
        _commit(keccak256("screening-revoked"));
    }
    function scheduleScreeningProfile(ScreeningProfile calldata p) external onlyPolicyAuthority {
        _queue(keccak256(abi.encode("screening-profile", p)));
    }
    function applyScreeningProfile(ScreeningProfile calldata p) external {
        bytes32 action = keccak256(abi.encode("screening-profile", p));
        _consume(action);
        _setProfile(p, address(guardian), routeId, address(token), ITripwireOracle(address(guardian)).oracle(), policyAuthority);
        _commit(action);
    }
    /// Advisory mode is explicit customer consent, queued for a day; both modes require screening here.
    function scheduleExecutionMode(ExecutionMode mode) external onlyPolicyAuthority {
        _queue(keccak256(abi.encode("execution-mode", mode)));
    }
    function applyExecutionMode(ExecutionMode mode) external {
        bytes32 action = keccak256(abi.encode("execution-mode", mode));
        _consume(action);
        executionMode = mode;
        _commit(action);
    }

    /// Anyone may relay an issuer-signed head; only the issuer chooses its contents.
    function registerScreeningHead(uint64 revision, bytes32 snapshotDigest, uint64 listAsOf, uint64 validUntil, bytes calldata signature)
        external
    {
        bytes32 profileHash = _activeProfile();
        ScreeningProfile memory p = screeningProfile;
        if (revision == 0 || snapshotDigest == 0 || validUntil < listAsOf ||
            validUntil > uint256(listAsOf) + p.maxSnapshotAgeSeconds) revert InvalidScreeningHead();
        bytes32 hash = _screeningDigest(keccak256(abi.encode(HEAD_TYPEHASH, profileHash, revision, snapshotDigest, listAsOf, validUntil)));
        if (ECDSA.recover(hash, signature) != p.issuer) revert InvalidIssuerSignature();
        Head memory current = activeHead;
        if (hash == current.hash) return; // Idempotent: re-registering never extends anything.
        if (block.timestamp < listAsOf || block.timestamp > validUntil) revert ScreeningHeadOutOfTime();
        if (current.hash != 0) {
            if (revision == current.revision) revert ScreeningHeadConflict();
            if (revision < current.revision || listAsOf < current.listAsOf) revert ScreeningHeadRollback();
        }
        activeHead = Head(hash, revision, listAsOf, validUntil);
        emit ScreeningHeadRegistered(hash, revision, listAsOf, validUntil);
    }

    // --- review format 4 -------------------------------------------------------

    /// ALLOW only: verify the receipt, then submit the oracle's review bound to it.
    /// HOLD and REJECT go through reviewRelease with zero screening commitments, so
    /// a provider outage never blocks a revocation.
    function reviewScreenedRelease(bytes32 messageId, ITripwireGuardian.Tier minimumTier, uint256 validUntil, uint256 nonce,
        bytes calldata signature, ScreeningReceipt calldata receipt, bytes calldata receiptSignature) external
    {
        bytes32 receiptHash = _acceptReceipt(messageId, receipt, receiptSignature);
        if (validUntil > receipt.validUntil) revert ReviewOutlivesScreening();
        pendingReceipt = receiptHash; pendingHead = receipt.headHash; pendingValidUntil = receipt.validUntil;
        this.reviewRelease(messageId, ReviewDecision.ALLOW, minimumTier, validUntil, nonce, signature);
        pendingReceipt = 0; pendingHead = 0; pendingValidUntil = 0;
    }

    function hashReleaseReview(bytes32 messageId, ReviewDecision decision, ITripwireGuardian.Tier minimumTier, uint256 validUntil, uint256 nonce)
        public view override returns (bytes32)
    {
        return hashScreenedReleaseReview(messageId, decision, minimumTier, validUntil, nonce, pendingReceipt, pendingHead, pendingValidUntil);
    }

    function hashScreenedReleaseReview(bytes32 messageId, ReviewDecision decision, ITripwireGuardian.Tier minimumTier, uint256 validUntil,
        uint256 nonce, bytes32 receiptHash, bytes32 headHash, uint64 screeningValidUntil) public view returns (bytes32)
    {
        Release storage r = releases[messageId];
        bytes32 releaseHash = keccak256(abi.encode(REVIEW_TYPEHASH, messageId, routeId, address(token),
            r.to, r.amount, uint8(decision), uint8(minimumTier), validUntil, nonce));
        return _hashTypedDataV4(keccak256(abi.encode(SCREENED_REVIEW_TYPEHASH, releaseHash, policyVersion, policyHash,
            receiptHash, headHash, screeningValidUntil)));
    }

    function _beforeReview(bytes32 id, ReviewDecision decision) internal override {
        super._beforeReview(id, decision);
        if (decision != ReviewDecision.ALLOW) { delete screened[id]; return; }
        // A reviewer signature alone can never stand in for the issuer's receipt.
        if (pendingReceipt == 0) revert ScreeningProofRequired();
        screened[id] = Screened(pendingReceipt, pendingHead, pendingValidUntil);
    }

    /// Execution rechecks the evidence: a newer head, a revoked profile, an expired
    /// receipt or an issuer that has become the oracle or the authority all refuse.
    function _beforeExecute(bytes32 id) internal override {
        super._beforeExecute(id);
        Screened memory s = screened[id];
        Head memory head = activeHead;
        if (s.receiptHash == 0 || screeningProfileHash == 0 || s.headHash != head.hash ||
            block.timestamp > s.validUntil || block.timestamp > head.validUntil) revert StaleScreening();
        _requireIndependentIssuer(screeningProfile.issuer);
    }

    // --- receipt verification --------------------------------------------------

    function _acceptReceipt(bytes32 id, ScreeningReceipt calldata receipt, bytes calldata signature) private returns (bytes32 hash) {
        bytes32 profileHash = _activeProfile();
        ScreeningProfile memory p = screeningProfile;
        Head memory head = activeHead;
        if (head.hash == 0 || receipt.headHash != head.hash || receipt.profileHash != profileHash) revert ScreeningNotActive();
        if (receipt.paymentContextHash != paymentContextHash(id)) revert ScreeningWrongPayment();
        if (receipt.outcome != NOT_LISTED) revert ScreeningNotCleared();
        // Original issuer times only; equality at a limit is valid, one second later is not.
        if (receipt.checkedAt < head.listAsOf || receipt.validUntil < receipt.checkedAt ||
            receipt.validUntil > uint256(receipt.checkedAt) + p.maxObservationAgeSeconds || receipt.validUntil > head.validUntil ||
            block.timestamp < receipt.checkedAt || block.timestamp > receipt.validUntil) revert ScreeningOutOfTime();
        hash = _screeningDigest(keccak256(abi.encode(RECEIPT_TYPEHASH, receipt)));
        if (ECDSA.recover(hash, signature) != p.issuer) revert InvalidIssuerSignature();
        emit ScreeningReceiptAccepted(id, hash, head.hash, receipt.validUntil);
    }

    /// The exact payment a receipt speaks for: chain, escrow, route, source, current policy, credit, recipient and net amount.
    function paymentContextHash(bytes32 id) public view returns (bytes32) {
        Release storage r = releases[id];
        Credit storage c = credits[id];
        return keccak256(bytes.concat(
            abi.encode(PAYMENT_NAMESPACE, block.chainid, address(this), address(guardian), routeId, address(token), authorizedSourceSender),
            abi.encode(policyVersion, policyHash, id, c.operationId, r.to, r.amount, c.returnRecipient, c.intentPolicyHash)));
    }

    function _activeProfile() private view returns (bytes32 profileHash) {
        profileHash = screeningProfileHash;
        if (profileHash == 0) revert ScreeningRevoked();
        _requireIndependentIssuer(screeningProfile.issuer);
    }

    /// Rotating the oracle into the issuer (or the issuer into the authority) makes screening unusable until resolved.
    function _requireIndependentIssuer(address issuer) private view {
        if (issuer == ITripwireOracle(address(guardian)).oracle() || issuer == policyAuthority) revert ScreeningIssuerConflict();
    }

    function _screeningDigest(bytes32 structHash) private view returns (bytes32) {
        bytes32 separator = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("TripwireScreening"), keccak256("1"), block.chainid, address(this)));
        return keccak256(abi.encodePacked("\x19\x01", separator, structHash));
    }
}
