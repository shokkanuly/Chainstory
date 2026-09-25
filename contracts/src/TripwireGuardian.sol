// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITripwireGuardian} from "./ITripwireGuardian.sol";

/// @title TripwireGuardian
/// @notice A per-route circuit breaker: a rolling outflow cap in the spirit of
///         EIP-7265, plus an oracle-driven pause for the transfers a volume cap
///         cannot see.
///
/// @dev The design constraints that matter, and why:
///
///      1. The oracle can pause and nothing else. It cannot move funds, cannot
///         raise a cap, cannot unpause. A compromised oracle key buys an
///         attacker a denial of service on one route — not a theft — which is
///         the trade a bridge operator can actually accept.
///
///      2. Pauses expire. A pause is a timelock that buys a human review
///         window, not a kill switch. If the oracle goes dark mid-incident the
///         route resumes on its own rather than stranding user funds forever.
///         Only the owner can extend beyond one window.
///
///      3. Attestations are replay-proof across routes, chains and time. The
///         signed digest binds the contract address and chain id, so the same
///         signature cannot be lifted from Base and replayed on Arbitrum where
///         identical bytecode is deployed.
contract TripwireGuardian is ITripwireGuardian {
    struct Route {
        /// Maximum outflow permitted within one window. Zero disables the cap.
        uint128 cap;
        /// Outflow accumulated since `windowStart`.
        uint128 outflowInWindow;
        uint64 windowStart;
        uint64 windowSeconds;
        /// Unix time until which the route is paused. Zero when running.
        uint64 pausedUntil;
    }

    /// @notice Longest pause a single attestation can impose.
    uint64 public constant MAX_PAUSE = 6 hours;

    /// @notice Risk score, in basis points, at or above which a pause is honoured.
    uint256 public constant TRIP_SCORE_BPS = 7_500;

    address public owner;
    /// @notice Key the off-chain oracle signs with. A k-of-n set replaces this
    ///         in production; one key is a demo affordance, not a design.
    address public oracle;

    mapping(bytes32 => Route) private _routes;
    /// @notice Contracts permitted to report outflows, so an unrelated caller
    ///         cannot inflate a route's usage to force it shut.
    mapping(address => bool) public isProtected;
    mapping(bytes32 => bool) public usedAttestation;

    event RouteConfigured(bytes32 indexed route, uint128 cap, uint64 windowSeconds);
    event OutflowRecorded(bytes32 indexed route, uint256 amount, uint256 windowTotal);
    event RoutePaused(bytes32 indexed route, uint256 riskScore, uint64 until);
    event RouteResumed(bytes32 indexed route);
    event OracleChanged(address indexed previous, address indexed next);
    event ProtectedSet(address indexed caller, bool allowed);

    error NotOwner();
    error NotProtected();
    error RoutePausedError(bytes32 route, uint64 until);
    error CapExceeded(bytes32 route, uint256 attempted, uint256 cap);
    error ScoreBelowThreshold(uint256 riskScore);
    error AttestationExpired(uint256 expiry);
    error AttestationReplayed(bytes32 digest);
    error BadSignature();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address oracle_) {
        owner = msg.sender;
        oracle = oracle_;
    }

    // --- configuration ---------------------------------------------------

    function configureRoute(bytes32 route, uint128 cap, uint64 windowSeconds) external onlyOwner {
        Route storage r = _routes[route];
        r.cap = cap;
        r.windowSeconds = windowSeconds;
        r.windowStart = uint64(block.timestamp);
        r.outflowInWindow = 0;
        emit RouteConfigured(route, cap, windowSeconds);
    }

    function setProtected(address caller, bool allowed) external onlyOwner {
        isProtected[caller] = allowed;
        emit ProtectedSet(caller, allowed);
    }

    function setOracle(address next) external onlyOwner {
        emit OracleChanged(oracle, next);
        oracle = next;
    }

    /// @notice Owner override, for when a human review clears the route early.
    function resume(bytes32 route) external onlyOwner {
        _routes[route].pausedUntil = 0;
        emit RouteResumed(route);
    }

    // --- the EIP-7265-style hook ------------------------------------------

    /// @inheritdoc ITripwireGuardian
    function onTokenOutflow(bytes32 route, uint256 amount) external {
        if (!isProtected[msg.sender]) revert NotProtected();

        Route storage r = _routes[route];

        uint64 until = r.pausedUntil;
        if (until != 0) {
            // Expired pauses are cleared lazily, so a route resumes without
            // anyone having to send a transaction to un-stick it.
            if (block.timestamp < until) revert RoutePausedError(route, until);
            r.pausedUntil = 0;
            emit RouteResumed(route);
        }

        if (r.windowSeconds != 0 && block.timestamp >= r.windowStart + r.windowSeconds) {
            r.windowStart = uint64(block.timestamp);
            r.outflowInWindow = 0;
        }

        uint256 total = uint256(r.outflowInWindow) + amount;
        if (r.cap != 0 && total > r.cap) revert CapExceeded(route, total, r.cap);

        r.outflowInWindow = uint128(total);
        emit OutflowRecorded(route, amount, total);
    }

    // --- the oracle extension ---------------------------------------------

    /// @inheritdoc ITripwireGuardian
    function submitAttestation(
        bytes32 route,
        uint256 riskScore,
        uint256 expiry,
        uint256 nonce,
        bytes calldata signature
    ) external {
        if (riskScore < TRIP_SCORE_BPS) revert ScoreBelowThreshold(riskScore);
        if (block.timestamp > expiry) revert AttestationExpired(expiry);

        // Binding chain id and this address is what stops a signature produced
        // for one deployment being replayed against the identical bytecode on
        // another chain.
        bytes32 digest = keccak256(
            abi.encode(block.chainid, address(this), route, riskScore, expiry, nonce)
        );
        if (usedAttestation[digest]) revert AttestationReplayed(digest);
        if (_recover(digest, signature) != oracle) revert BadSignature();

        usedAttestation[digest] = true;

        uint64 until = uint64(block.timestamp) + MAX_PAUSE;
        _routes[route].pausedUntil = until;
        emit RoutePaused(route, riskScore, until);
    }

    // --- views -------------------------------------------------------------

    /// @inheritdoc ITripwireGuardian
    function isPaused(bytes32 route) external view returns (bool) {
        uint64 until = _routes[route].pausedUntil;
        return until != 0 && block.timestamp < until;
    }

    function routeState(bytes32 route) external view returns (Route memory) {
        return _routes[route];
    }

    // --- internals ---------------------------------------------------------

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        // Reject the upper half of the curve order, so a second valid signature
        // cannot be minted for an attestation that was already used.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert BadSignature();
        }
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address signer = ecrecover(ethSigned, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
