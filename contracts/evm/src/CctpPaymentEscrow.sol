// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CctpEscrow} from "./CctpEscrow.sol";
import {ITripwireOracle} from "./TripwireDemo.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";

/// Authenticated funded credits, customer constraints and delayed destination returns.
/// Local prototype; the legacy operator must not sign for review format 3.
contract CctpPaymentEscrow is CctpEscrow {
    using SafeERC20 for IERC20;

    struct PaymentPolicy {
        uint256 maxPayment;
        uint256 manualApprovalAbove;
        uint256 delayAbove;
        uint256 delaySeconds;
    }
    struct PaymentConfig {
        address authority;
        address returnRecipient;
        address sourceSender;
        uint256 recoveryDelay;
        PaymentPolicy policy;
        address[] recipients;
    }
    struct Credit {
        address returnRecipient;
        bytes32 operationId;
        bytes32 intentPolicyHash;
        uint256 returnAt;
        bool returned;
    }

    uint256 public constant PAYMENT_ESCROW_VERSION = 1;
    uint256 public constant POLICY_CHANGE_DELAY = 1 days;
    bytes32 public constant PAYMENT_HOOK = keccak256("Tripwire/CCTP/v2/USDC/payment/v1");
    bytes32 public constant PAYMENT_REVIEW_TYPEHASH = keccak256(
        "PaymentReleaseReview(bytes32 releaseHash,uint256 policyVersion,bytes32 policyHash)"
    );
    bytes32 private constant PAYMENT_ID_DOMAIN = keccak256("Tripwire/CCTP/v2/payment-escrow/v1");
    address public immutable policyAuthority;
    address public immutable recoveryRecipient;
    address public immutable authorizedSourceSender;
    uint256 public immutable recoveryDelay;
    PaymentPolicy public paymentPolicy;
    bool public paymentsPaused;
    uint256 public policyVersion = 1;
    bytes32 public policyHash;
    bytes32 public queuedChange;
    uint256 public queuedChangeAt;
    mapping(address => bool) public permittedRecipients;
    mapping(bytes32 => bool) public usedOperations;
    mapping(bytes32 => Credit) public credits;
    mapping(bytes32 => uint256) public approvedPolicyVersion;
    mapping(bytes32 => uint256) public reviewedPolicyVersion;
    mapping(bytes32 => uint256) public paymentDelayUntil;
    uint256 public totalCredited;
    uint256 public totalPaid;
    uint256 public totalReturned;

    event PaymentCreditBound(bytes32 indexed messageId, bytes32 indexed operationId, address indexed returnRecipient, bytes32 intentPolicyHash);
    event PolicyChangeQueued(bytes32 indexed change, uint256 readyAt);
    event PolicyChangeCancelled(bytes32 indexed change);
    event PolicyCommitted(uint256 indexed version, bytes32 policyHash, bytes32 action);
    event PaymentApproved(bytes32 indexed messageId, uint256 indexed version);
    event ReturnRequested(bytes32 indexed messageId, address indexed recipient, uint256 readyAt);
    event CreditReturned(bytes32 indexed messageId, address indexed recipient, uint256 amount);
    error OnlyPolicyAuthority();
    error InvalidPaymentPolicy();
    error PolicyChangeNotReady();
    error OperationAlreadyFunded();
    error PaymentsPaused();
    error RecipientNotPermitted();
    error PaymentLimitExceeded();
    error CustomerApprovalRequired();
    error StalePaymentReview();
    error PaymentDelayActive(uint256 readyAt);
    error ReturnInProgress();
    error OnlyReturnRecipient();
    error ReturnAlreadyRequested();
    error ReturnNotReady();
    error CreditAlreadyReturned();

    modifier onlyPolicyAuthority() {
        if (msg.sender != policyAuthority) revert OnlyPolicyAuthority();
        _;
    }

    constructor(IERC20 token_, ITripwireGuardian guardian_, bytes32 routeId_, CctpConfig memory cctp, PaymentConfig memory config)
        CctpEscrow(token_, guardian_, routeId_, cctp)
    {
        if (config.authority == address(0) || config.authority == address(this) ||
            config.authority == ITripwireOracle(address(guardian_)).oracle() ||
            config.returnRecipient == address(0) || config.returnRecipient == address(this) ||
            config.sourceSender == address(0) ||
            config.recoveryDelay < 1 hours || config.recoveryDelay > 30 days ||
            config.recipients.length > 100) revert InvalidPaymentPolicy();
        _validatePolicy(config.policy);
        policyAuthority = config.authority;
        recoveryRecipient = config.returnRecipient;
        authorizedSourceSender = config.sourceSender;
        recoveryDelay = config.recoveryDelay;
        paymentPolicy = config.policy;
        for (uint256 i; i < config.recipients.length; ++i) {
            address recipient = config.recipients[i];
            if (recipient == address(0) || recipient == address(this) || permittedRecipients[recipient]) revert InvalidPaymentPolicy();
            permittedRecipients[recipient] = true;
        }
        policyHash = keccak256(abi.encode(PAYMENT_ID_DOMAIN, block.chainid, address(this), routeId_,
            address(token_), address(guardian_), config));
        emit PolicyCommitted(1, policyHash, bytes32(0));
    }

    function REVIEW_FORMAT_VERSION() public pure override returns (uint256) { return 3; }

    function releaseId(bytes32 nonce) public view override returns (bytes32) {
        return keccak256(abi.encode(PAYMENT_ID_DOMAIN, block.chainid, address(this), sourceDomain, nonce));
    }

    function _beneficiary(bytes calldata message) internal override returns (address) {
        // Header/body 376 + 5 application words: tag, payout, return, operation, policy hash.
        if (message.length != 536 || bytes32(message[376:408]) != PAYMENT_HOOK) revert UnsupportedCctpMessage();
        if (_address(message, 248) != authorizedSourceSender) revert InvalidCctpBinding();
        address recipient = _address(message, 408);
        address returnRecipient = _address(message, 440);
        bytes32 operationId = bytes32(message[472:504]);
        if (returnRecipient != recoveryRecipient || operationId == bytes32(0) ||
            bytes32(message[504:536]) == bytes32(0)) revert InvalidCctpBinding();
        if (usedOperations[operationId]) revert OperationAlreadyFunded();
        return recipient;
    }

    function _registerCredit(bytes32 id, bytes calldata message, uint256 net) internal override {
        bytes32 operationId = bytes32(message[472:504]);
        usedOperations[operationId] = true;
        credits[id] = Credit(_address(message, 440), operationId, bytes32(message[504:536]), 0, false);
        totalCredited += net;
        emit PaymentCreditBound(id, operationId, credits[id].returnRecipient, credits[id].intentPolicyHash);
    }

    function hashReleaseReview(bytes32 messageId, ReviewDecision decision, ITripwireGuardian.Tier minimumTier, uint256 validUntil, uint256 nonce)
        public view override returns (bytes32)
    {
        Release storage r = releases[messageId];
        bytes32 releaseHash = keccak256(abi.encode(REVIEW_TYPEHASH, messageId, routeId, address(token),
            r.to, r.amount, uint8(decision), uint8(minimumTier), validUntil, nonce));
        return _hashTypedDataV4(keccak256(abi.encode(PAYMENT_REVIEW_TYPEHASH, releaseHash, policyVersion, policyHash)));
    }

    function _beforeReview(bytes32 id, ReviewDecision decision) internal override {
        // Policy v4 lets a plain vault re-review a REJECT after its cooldown so a
        // backed credit is never stranded. Here the customer's fixed return is
        // that path, so a rejected payout stays rejected (ADR-028).
        if (releases[id].state == ReleaseState.REJECTED) revert ReleaseRejected(id);
        if (credits[id].returnAt != 0) revert ReturnInProgress();
        if (decision == ReviewDecision.ALLOW) {
            // A fresh policy version can add a delay, never shorten an existing clock.
            if (reviewedPolicyVersion[id] != policyVersion && releases[id].amount > paymentPolicy.delayAbove) {
                uint256 candidate = block.timestamp + paymentPolicy.delaySeconds;
                if (candidate > paymentDelayUntil[id]) paymentDelayUntil[id] = candidate;
            }
            reviewedPolicyVersion[id] = policyVersion;
        }
    }

    function executeRelease(bytes32 id) external override nonReentrant { _executeRelease(id); }

    function _beforeExecute(bytes32 id) internal override {
        if (credits[id].returnAt != 0) revert ReturnInProgress();
        if (reviewedPolicyVersion[id] != policyVersion) revert StalePaymentReview();
        if (paymentsPaused) revert PaymentsPaused();
        Release storage r = releases[id];
        if (!permittedRecipients[r.to]) revert RecipientNotPermitted();
        if (r.amount > paymentPolicy.maxPayment) revert PaymentLimitExceeded();
        if ((r.amount > paymentPolicy.manualApprovalAbove || credits[id].intentPolicyHash != policyHash) &&
            approvedPolicyVersion[id] != policyVersion) revert CustomerApprovalRequired();
        if (block.timestamp < paymentDelayUntil[id]) revert PaymentDelayActive(paymentDelayUntil[id]);
        totalPaid += r.amount; // Base execution changes state before transfer; any revert rolls back both.
    }

    function approvePayment(bytes32 id) external onlyPolicyAuthority {
        Release storage r = releases[id];
        if (r.to == address(0)) revert UnknownRelease(id);
        if (r.state == ReleaseState.EXECUTED) revert AlreadyExecuted(id);
        if (r.state == ReleaseState.REJECTED) revert ReleaseRejected(id);
        if (credits[id].returnAt != 0) revert ReturnInProgress();
        approvedPolicyVersion[id] = policyVersion;
        emit PaymentApproved(id, policyVersion);
    }

    function pausePayments() external onlyPolicyAuthority {
        paymentsPaused = true;
        _commit(keccak256(abi.encode("pause", true)));
    }

    function revokeRecipient(address recipient) external onlyPolicyAuthority {
        permittedRecipients[recipient] = false;
        _commit(keccak256(abi.encode("recipient", recipient, false)));
    }

    function schedulePolicy(PaymentPolicy calldata next) external onlyPolicyAuthority {
        _validatePolicy(next);
        _queue(keccak256(abi.encode("policy", next)));
    }
    function applyPolicy(PaymentPolicy calldata next) external {
        _validatePolicy(next);
        bytes32 action = keccak256(abi.encode("policy", next));
        _consume(action);
        paymentPolicy = next;
        _commit(action);
    }
    function scheduleRecipient(address recipient) external onlyPolicyAuthority {
        if (recipient == address(0) || recipient == address(this)) revert InvalidPaymentPolicy();
        _queue(keccak256(abi.encode("recipient", recipient, true)));
    }
    function applyRecipient(address recipient) external {
        bytes32 action = keccak256(abi.encode("recipient", recipient, true));
        _consume(action);
        permittedRecipients[recipient] = true;
        _commit(action);
    }
    function scheduleUnpause() external onlyPolicyAuthority { _queue(keccak256(abi.encode("pause", false))); }
    function applyUnpause() external {
        bytes32 action = keccak256(abi.encode("pause", false));
        _consume(action);
        paymentsPaused = false;
        _commit(action);
    }

    function _queue(bytes32 action) private {
        if (queuedChange != bytes32(0)) emit PolicyChangeCancelled(queuedChange);
        queuedChange = keccak256(abi.encode(policyVersion, action));
        queuedChangeAt = block.timestamp + POLICY_CHANGE_DELAY;
        emit PolicyChangeQueued(queuedChange, queuedChangeAt);
    }
    function _consume(bytes32 action) private {
        if (queuedChangeAt == 0 || block.timestamp < queuedChangeAt ||
            queuedChange != keccak256(abi.encode(policyVersion, action))) revert PolicyChangeNotReady();
        delete queuedChange;
        delete queuedChangeAt;
    }
    function _commit(bytes32 action) private {
        ++policyVersion;
        policyHash = keccak256(abi.encode(policyHash, policyVersion, action));
        if (queuedChange != bytes32(0)) emit PolicyChangeCancelled(queuedChange);
        delete queuedChange;
        delete queuedChangeAt;
        emit PolicyCommitted(policyVersion, policyHash, action);
    }
    function _validatePolicy(PaymentPolicy memory policy) private pure {
        if (policy.maxPayment == 0 || policy.manualApprovalAbove > policy.maxPayment ||
            policy.delayAbove > policy.maxPayment || policy.delaySeconds > 30 days) revert InvalidPaymentPolicy();
    }

    function requestReturn(bytes32 id) external nonReentrant {
        Release storage r = releases[id];
        Credit storage c = credits[id];
        if (r.to == address(0)) revert UnknownRelease(id);
        if (r.state == ReleaseState.EXECUTED) revert AlreadyExecuted(id);
        if (c.returned) revert CreditAlreadyReturned();
        if (msg.sender != c.returnRecipient) revert OnlyReturnRecipient();
        if (c.returnAt != 0) revert ReturnAlreadyRequested();
        c.returnAt = block.timestamp + recoveryDelay;
        emit ReturnRequested(id, c.returnRecipient, c.returnAt);
    }

    function executeReturn(bytes32 id) external nonReentrant {
        Release storage r = releases[id];
        Credit storage c = credits[id];
        if (r.to == address(0)) revert UnknownRelease(id);
        if (r.state == ReleaseState.EXECUTED) revert AlreadyExecuted(id);
        if (c.returned) revert CreditAlreadyReturned();
        if (c.returnAt == 0 || block.timestamp < c.returnAt) revert ReturnNotReady();
        c.returned = true;
        r.state = ReleaseState.REJECTED;
        totalReturned += r.amount;
        token.safeTransfer(c.returnRecipient, r.amount);
        emit CreditReturned(id, c.returnRecipient, r.amount);
    }

    function outstandingCredit() external view returns (uint256) {
        return totalCredited - totalPaid - totalReturned;
    }
}
