// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";
// Compiled alongside: the attacker's receiving contract is deployed behind it.
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// The testnet stage around TripwireGuardian: a bridge's two ends and the
// attacker's receiving contract. Demo contracts, deployed by
// scripts/tripwire/testnet/deploy.ts. Only TripwireGuardian is the product.

/// @notice A stand-in stablecoin for the protected vault to pay out. 6 decimals, like USDC.
contract DemoUSDC is ERC20, Ownable {
    constructor(address owner_) ERC20("Tripwire Demo USD", "tdUSDC") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

/// @notice The bridge's source end (ingress). It only records burns: what
///         Tripwire's watcher needs from the source chain is proof that a
///         payout on the destination is backed by one.
contract MockSourceBridge {
    event Burned(bytes32 indexed messageId, address indexed sender, uint256 amount);

    function burn(bytes32 messageId, uint256 amount) external {
        emit Burned(messageId, msg.sender, amount);
    }
}

/// @notice The bridge's destination end (egress), protected by the guardian.
///         A release is requested first and executed later, so the watcher
///         can score it before any money moves. Execution asks the guardian,
///         and a guardian revert (RoutePaused, OutflowDelayed, RateLimited)
///         reverts the payout with it.
interface ITripwireOracle {
    function oracle() external view returns (address);
}

contract ProtectedVault is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    enum ReleaseState { PENDING, VERIFIED, HELD, REJECTED, EXECUTED }
    enum ReviewDecision { ALLOW, HOLD, REJECT }

    struct Release {
        address to;
        uint256 amount;
        ReleaseState state;
        uint256 reviewedUntil;
        address reviewer;
        uint256 reviewNonce;
        ITripwireGuardian.Tier minimumTier;
    }

    IERC20 public immutable token;
    ITripwireGuardian public immutable guardian;
    bytes32 public immutable routeId;

    mapping(bytes32 messageId => Release) public releases;
    mapping(bytes32 messageId => uint256) public releaseDelayUntil;

    uint256 public constant RELEASE_POLICY_VERSION = 2;
    uint256 public constant MAX_REVIEW_TTL = 10 minutes;
    bytes32 public constant REVIEW_TYPEHASH = keccak256(
        "ReleaseReview(bytes32 messageId,bytes32 routeId,address token,address recipient,uint256 amount,uint8 decision,uint8 minimumTier,uint256 validUntil,uint256 nonce)"
    );

    event ReleaseRequested(bytes32 indexed messageId, address indexed to, uint256 amount);
    event ReleaseExecuted(bytes32 indexed messageId, address indexed to, uint256 amount);
    event ReleaseReviewed(bytes32 indexed messageId, ReviewDecision decision, uint256 validUntil, uint256 nonce);

    error UnknownRelease(bytes32 messageId);
    error AlreadyRequested(bytes32 messageId);
    error AlreadyExecuted(bytes32 messageId);
    error InvalidRelease();
    error ReleaseNotReviewed(bytes32 messageId);
    error ReleaseHeld(bytes32 messageId);
    error ReleaseRejected(bytes32 messageId);
    error ReviewExpired(uint256 validUntil);
    error ReviewTtlTooLong(uint256 validUntil);
    error ReviewNonceAlreadyUsed(uint256 nonce);
    error InvalidReviewer(address recovered);
    error RequiredProtectionMissing(bytes32 routeId, ITripwireGuardian.Tier minimumTier);
    error ReleaseDelayed(bytes32 messageId, uint256 releaseAt);
    error RequestDelayNotStarted(bytes32 messageId);

    constructor(address owner_, IERC20 token_, ITripwireGuardian guardian_, bytes32 routeId_)
        Ownable(owner_) EIP712("TripwireProtectedVault", "2")
    {
        token = token_;
        guardian = guardian_;
        routeId = routeId_;
    }

    /// Signing startup must distinguish extensions with a different review type.
    function REVIEW_FORMAT_VERSION() public pure virtual returns (uint256) { return 2; }

    function _beforeReview(bytes32 messageId, ReviewDecision decision) internal virtual {}
    function _beforeExecute(bytes32 messageId) internal virtual {}

    /// @notice The relayer delivers a cross-chain message. In an exploit, this
    ///         is where a forged message arrives.
    function requestRelease(bytes32 messageId, address to, uint256 amount) external onlyOwner {
        if (to == address(0) || amount == 0) revert InvalidRelease();
        if (releases[messageId].to != address(0)) revert AlreadyRequested(messageId);
        releases[messageId] = Release(to, amount, ReleaseState.PENDING, 0, address(0), 0, ITripwireGuardian.Tier.NONE);
        emit ReleaseRequested(messageId, to, amount);
    }

    /// @notice A fresh, single-use review is bound to this vault and every payout field.
    /// Bridge message authentication remains the bridge's responsibility; this is an additional risk gate.
    function reviewRelease(
        bytes32 messageId, ReviewDecision decision, ITripwireGuardian.Tier minimumTier,
        uint256 validUntil, uint256 nonce, bytes calldata signature
    ) external {
        Release storage r = releases[messageId];
        if (r.to == address(0)) revert UnknownRelease(messageId);
        if (r.state == ReleaseState.EXECUTED) revert AlreadyExecuted(messageId);
        if (r.state == ReleaseState.REJECTED) revert ReleaseRejected(messageId);
        if (block.timestamp > validUntil) revert ReviewExpired(validUntil);
        if (validUntil > block.timestamp + MAX_REVIEW_TTL) revert ReviewTtlTooLong(validUntil);
        // Per-release monotonically increasing nonces also reject an older ALLOW
        // signature arriving after a newer HOLD. Random single-use nonces do not.
        if (nonce <= r.reviewNonce) revert ReviewNonceAlreadyUsed(nonce);
        address reviewer = ECDSA.recover(hashReleaseReview(messageId, decision, minimumTier, validUntil, nonce), signature);
        if (reviewer != ITripwireOracle(address(guardian)).oracle()) revert InvalidReviewer(reviewer);
        _beforeReview(messageId, decision);
        r.reviewNonce = nonce;
        r.state = decision == ReviewDecision.ALLOW
            ? ReleaseState.VERIFIED : decision == ReviewDecision.HOLD ? ReleaseState.HELD : ReleaseState.REJECTED;
        r.reviewedUntil = validUntil;
        r.reviewer = reviewer;
        r.minimumTier = minimumTier;
        if (decision == ReviewDecision.ALLOW && releaseDelayUntil[messageId] == 0) {
            uint256 delay = guardian.outflowDelay(routeId, r.amount);
            if (delay > 0) releaseDelayUntil[messageId] = block.timestamp + delay;
        }
        emit ReleaseReviewed(messageId, decision, validUntil, nonce);
    }

    function hashReleaseReview(bytes32 messageId, ReviewDecision decision, ITripwireGuardian.Tier minimumTier, uint256 validUntil, uint256 nonce)
        public view virtual returns (bytes32)
    {
        Release storage r = releases[messageId];
        return _hashTypedDataV4(keccak256(abi.encode(
            REVIEW_TYPEHASH, messageId, routeId, address(token), r.to, r.amount, uint8(decision), uint8(minimumTier), validUntil, nonce
        )));
    }

    function executeRelease(bytes32 messageId) external virtual { _executeRelease(messageId); }

    function _executeRelease(bytes32 messageId) internal {
        Release storage r = releases[messageId];
        if (r.to == address(0)) revert UnknownRelease(messageId);
        if (r.state == ReleaseState.EXECUTED) revert AlreadyExecuted(messageId);
        if (r.state == ReleaseState.REJECTED) revert ReleaseRejected(messageId);
        if (r.state == ReleaseState.HELD) revert ReleaseHeld(messageId);
        if (r.state != ReleaseState.VERIFIED) revert ReleaseNotReviewed(messageId);
        if (block.timestamp > r.reviewedUntil) revert ReviewExpired(r.reviewedUntil);
        if (r.reviewer != ITripwireOracle(address(guardian)).oracle()) revert InvalidReviewer(r.reviewer);
        if (guardian.currentTier(routeId) < r.minimumTier) revert RequiredProtectionMissing(routeId, r.minimumTier);
        uint256 releaseAt = releaseDelayUntil[messageId];
        if (releaseAt == 0 && guardian.outflowDelay(routeId, r.amount) > 0) revert RequestDelayNotStarted(messageId);
        if (block.timestamp < releaseAt) revert ReleaseDelayed(messageId, releaseAt);
        _beforeExecute(messageId);
        r.state = ReleaseState.EXECUTED;
        guardian.onTokenOutflow(routeId, r.amount);
        token.safeTransfer(r.to, r.amount);
        emit ReleaseExecuted(messageId, r.to, r.amount);
    }
}

/// @notice The attacker's receiving contract, deployed behind an ERC-1967
///         proxy so its code can be replaced, and never verified. Holds
///         whatever it is sent.
contract DrainReceiver {
    /// @dev OpenZeppelin's ERC1967Proxy refuses empty initialisation data, so
    ///      the proxy is deployed with a call to this.
    function initialize() external {}
}
