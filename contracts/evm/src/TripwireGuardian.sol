// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";

/// @title TripwireGuardian
/// @notice A per-route circuit breaker: an EIP-7265-style rolling outflow cap,
///         plus oracle-driven pausing for the transfers a volume cap cannot see.
///
/// @dev Invariants, and the attack each one closes:
///
///      - The oracle can pause and nothing else. It cannot move funds, raise a
///        cap, or resume a route. A stolen oracle key is a denial of service on
///        the routes it attests against, never a theft.
///
///      - Every pause expires on its own. HIGH risk buys a 4-hour review
///        cooldown, CRITICAL a 24-hour lockdown; neither can brick the route.
///        The owner can resume early, and can rotate a compromised oracle.
///
///      - A pause only ever moves forward. A HIGH attestation arriving during a
///        CRITICAL lockdown cannot shorten it, so an attacker holding a
///        low-score attestation cannot use it to lift a harder pause.
///
///      - Attestations are EIP-712 typed data. The domain binds chain id and
///        this contract's address, so a signature for Base cannot be replayed
///        against the identical bytecode on Arbitrum; OpenZeppelin's EIP712
///        rebuilds the separator if the chain id changes under a fork.
///
///      - Each nonce is single-use, and an attestation is valid for at most
///        MAX_ATTESTATION_TTL. A signed-but-unsubmitted attestation cannot be
///        held back and fired days later.
///
///      - An unconfigured route rejects outflows. Failing closed on a route the
///        guardian knows nothing about is the only safe default for a breaker.
contract TripwireGuardian is ITripwireGuardian, Ownable2Step, EIP712 {
    enum Tier {
        NONE,
        HIGH,
        CRITICAL
    }

    /// @dev Two storage slots. Slot 0: cap, outflowInWindow. Slot 1: the rest.
    struct Route {
        uint128 cap;
        uint128 outflowInWindow;
        uint64 windowStart;
        uint64 windowSeconds;
        uint64 pausedUntil;
        Tier tier;
    }

    uint256 public constant MAX_SCORE = 100;
    /// @notice Scores strictly above this pause the route.
    uint256 public constant HIGH_RISK_THRESHOLD = 75;
    /// @notice Scores strictly above this escalate to a lockdown.
    uint256 public constant CRITICAL_RISK_THRESHOLD = 90;

    uint64 public constant HIGH_RISK_COOLDOWN = 4 hours;
    uint64 public constant CRITICAL_LOCKDOWN = 24 hours;
    uint256 public constant MAX_ATTESTATION_TTL = 10 minutes;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 routeId,uint256 riskScore,uint256 validUntil,uint256 nonce)"
    );

    address public oracle;

    mapping(bytes32 routeId => Route) private _routes;
    /// @notice Contracts permitted to report outflows. Without this an
    ///         unrelated caller could inflate a route's usage to force it shut.
    mapping(address caller => bool) public isProtected;
    mapping(uint256 nonce => bool) public usedNonces;

    event RouteConfigured(bytes32 indexed routeId, uint128 cap, uint64 windowSeconds);
    event OutflowRecorded(bytes32 indexed routeId, uint256 amount, uint256 windowTotal);
    event AttestationAccepted(
        bytes32 indexed routeId,
        Tier tier,
        uint256 riskScore,
        uint256 nonce,
        uint64 pausedUntil
    );
    event RouteResumed(bytes32 indexed routeId);
    event OracleUpdated(address indexed previous, address indexed next);
    event ProtectedSet(address indexed caller, bool allowed);

    error ZeroAddress();
    error InvalidRouteConfig();
    error NotProtected(address caller);
    error RouteNotConfigured(bytes32 routeId);
    error RoutePaused(bytes32 routeId, uint64 pausedUntil);
    error RateLimited(bytes32 routeId, uint256 attempted, uint256 cap);
    error InvalidScore(uint256 riskScore);
    error ScoreBelowThreshold(uint256 riskScore);
    error AttestationExpired(uint256 validUntil);
    error AttestationTtlTooLong(uint256 validUntil);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidSigner(address recovered);

    constructor(address initialOwner, address oracle_)
        Ownable(initialOwner)
        EIP712("TripwireGuardian", "1")
    {
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleUpdated(address(0), oracle_);
    }

    // --- administration --------------------------------------------------

    function configureRoute(bytes32 routeId, uint128 cap, uint64 windowSeconds) external onlyOwner {
        if (cap == 0 || windowSeconds == 0) revert InvalidRouteConfig();
        Route storage r = _routes[routeId];
        r.cap = cap;
        r.windowSeconds = windowSeconds;
        r.windowStart = uint64(block.timestamp);
        r.outflowInWindow = 0;
        emit RouteConfigured(routeId, cap, windowSeconds);
    }

    function setProtected(address caller, bool allowed) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        isProtected[caller] = allowed;
        emit ProtectedSet(caller, allowed);
    }

    /// @notice Rotate the oracle key — the escape hatch if it is compromised.
    function setOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, next);
        oracle = next;
    }

    /// @notice Lift a pause early, once a human review has cleared the route.
    function resume(bytes32 routeId) external onlyOwner {
        Route storage r = _routes[routeId];
        r.pausedUntil = 0;
        r.tier = Tier.NONE;
        emit RouteResumed(routeId);
    }

    // --- EIP-7265-style outflow hook --------------------------------------

    /// @inheritdoc ITripwireGuardian
    function onTokenOutflow(bytes32 routeId, uint256 amount) external {
        if (!isProtected[msg.sender]) revert NotProtected(msg.sender);

        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) revert RouteNotConfigured(routeId);
        if (block.timestamp < r.pausedUntil) revert RoutePaused(routeId, r.pausedUntil);

        if (block.timestamp >= uint256(r.windowStart) + r.windowSeconds) {
            r.windowStart = uint64(block.timestamp);
            r.outflowInWindow = 0;
        }

        uint256 total = uint256(r.outflowInWindow) + amount;
        if (total > r.cap) revert RateLimited(routeId, total, r.cap);

        // Safe: total <= cap, and cap is a uint128.
        r.outflowInWindow = uint128(total);
        emit OutflowRecorded(routeId, amount, total);
    }

    // --- the oracle extension ----------------------------------------------

    /// @inheritdoc ITripwireGuardian
    function submitAttestation(
        bytes32 routeId,
        uint256 riskScore,
        uint256 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external {
        if (riskScore > MAX_SCORE) revert InvalidScore(riskScore);
        if (riskScore <= HIGH_RISK_THRESHOLD) revert ScoreBelowThreshold(riskScore);
        if (block.timestamp > validUntil) revert AttestationExpired(validUntil);
        if (validUntil > block.timestamp + MAX_ATTESTATION_TTL) revert AttestationTtlTooLong(validUntil);
        if (usedNonces[nonce]) revert NonceAlreadyUsed(nonce);

        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) revert RouteNotConfigured(routeId);

        address signer = ECDSA.recover(hashAttestation(routeId, riskScore, validUntil, nonce), signature);
        if (signer != oracle) revert InvalidSigner(signer);

        usedNonces[nonce] = true;

        (Tier tier, uint64 duration) = riskScore > CRITICAL_RISK_THRESHOLD
            ? (Tier.CRITICAL, CRITICAL_LOCKDOWN)
            : (Tier.HIGH, HIGH_RISK_COOLDOWN);

        uint64 until = uint64(block.timestamp) + duration;
        if (until > r.pausedUntil) {
            r.pausedUntil = until;
            r.tier = tier;
        }

        emit AttestationAccepted(routeId, r.tier, riskScore, nonce, r.pausedUntil);
    }

    // --- views ---------------------------------------------------------------

    /// @notice The EIP-712 digest the oracle signs. Exposed so the off-chain
    ///         signer and the tests share one encoding instead of two.
    function hashAttestation(bytes32 routeId, uint256 riskScore, uint256 validUntil, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, routeId, riskScore, validUntil, nonce)));
    }

    /// @inheritdoc ITripwireGuardian
    function isPaused(bytes32 routeId) public view returns (bool) {
        return block.timestamp < _routes[routeId].pausedUntil;
    }

    /// @inheritdoc ITripwireGuardian
    function routeStatus(bytes32 routeId) external view returns (Status) {
        if (isPaused(routeId)) return Status.PAUSED;
        Route storage r = _routes[routeId];
        bool windowLive = block.timestamp < uint256(r.windowStart) + r.windowSeconds;
        if (windowLive && r.outflowInWindow >= r.cap && r.cap != 0) return Status.RATE_LIMITED;
        return Status.ACTIVE;
    }

    /// @notice Route state for the dashboard's route matrix.
    function getRoute(bytes32 routeId) external view returns (Route memory) {
        return _routes[routeId];
    }
}
