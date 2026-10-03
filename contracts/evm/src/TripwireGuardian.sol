// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";

/// @title TripwireGuardian
/// @notice A per-route circuit breaker: an EIP-7265-style rolling outflow cap,
///         plus oracle-driven pausing for the transfers a volume cap cannot see.
///
/// @dev Invariants, and the attack each one closes:
///
///      - The oracle can tighten a route and nothing else. It cannot move
///        funds, raise a cap, loosen a tier, or resume a route. A stolen oracle key is a denial of service on
///        the routes it attests against, never a theft.
///
///      - The oracle alone cannot hold a route indefinitely. One span of
///        oracle protection lasts at most MAX_ORACLE_PROTECTION (72 hours) from
///        its first attestation, however often it is refreshed, and a new span
///        starts only after a PROTECTION_COOLDOWN (24 hours) clear gap. Longer
///        protection is a human decision: the owner re-arms the route
///        (`rearmProtection`) or lowers its cap. A stolen oracle key therefore
///        denies service for at most 72 hours at a time, and `disableOracle`
///        ends that at once.
///
///      - Replacing the oracle is time-locked: `proposeOracle`, then
///        `acceptOracle` once ORACLE_ROTATION_DELAY (2 days) has passed. Every
///        gated vault trusts this guardian's oracle for release reviews, so an
///        instant swap would let whoever holds the owner key approve payouts;
///        the delay gives users and monitors public notice first. Removing the
///        oracle is instant (`disableOracle`): with no oracle nothing can be
///        attested or reviewed, so every gated payout fails closed.
///
///      - While a route is under protection its cap can be lowered, never
///        raised. Raising it again takes an explicit `resume` first.
///
///      - Response is graduated, and each tier is at least as strict as the
///        one below it: THROTTLE halves the window cap; DELAY keeps that cap
///        and also holds outflows for a review window once they pass 10% of
///        the cap in total, so splitting one large payout into small ones
///        is held all the same; FREEZE stops all outflow. A higher risk
///        score can never produce a looser limit.
///
///      - A tier only escalates while active. A lower-score attestation arriving
///        during a harder tier is ignored, so it cannot be used to weaken one.
///
///      - Every tier expires on its own, at most 24 hours after the attestation
///        that set it. Only the owner lifts a tier early, and only through
///        `resume` — reconfiguring a route's cap leaves its protection in place.
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
///      - The oracle may be one key or a contract. A contract oracle (for
///        example TripwireQuorum, ADR-021) is asked through ERC-1271, so a
///        k-of-n attestor set replaces the single key without changing any
///        rule above: no quorum can do more than one oracle key could.
///
///      - An unconfigured route rejects outflows. Failing closed on a route the
///        guardian knows nothing about is the only safe default for a breaker.
contract TripwireGuardian is ITripwireGuardian, Ownable2Step, EIP712 {
    /// @dev Storage for route parameters and graduated defensive state.
    struct Route {
        uint128 cap;
        /// Inspection field, calculated by getRoute rather than stored usage.
        uint128 outflowInWindow;
        /// Initial configuration time; never resets the rolling budget.
        uint64 windowStart;
        uint64 windowSeconds;
        /// FREEZE clock: all outflow reverts until this time.
        uint64 pausedUntil;
        Tier tier;
        uint64 tierExpiresAt;
        /// DELAY clock: large outflows are held until this time.
        uint64 delayUntil;
        /// Start of the current span of oracle protection (0: none yet).
        uint64 protectionSince;
        /// Outflow paid since the DELAY review window opened, against its 10% budget.
        uint128 delayedOutflow;
    }

    uint256 public constant MAX_SCORE = 100;
    uint256 public constant GUARDIAN_POLICY_VERSION = 4;
    uint256 public constant ROLLING_BUCKETS = 17;
    struct Bucket { uint128 amount; uint64 lastOutflow; }
    mapping(bytes32 routeId => Bucket[17]) private _outflows;
    
    /// @notice Scores at or above each threshold apply that tier. Inclusive, to
    ///         match the oracle's own `score >= threshold` rule.
    uint256 public constant THROTTLE_THRESHOLD = 65;
    uint256 public constant DELAY_THRESHOLD = 85;
    uint256 public constant FREEZE_THRESHOLD = 95;

    /// @notice Under DELAY, how long outflows above 10% of the cap are held
    ///         for human review. A time-lock, not a queue: the transfer reverts
    ///         and can be retried once the window has passed.
    uint64 public constant DELAY_WINDOW = 30 minutes;

    uint64 public constant PAUSE_DURATION = 24 hours;
    uint256 public constant MAX_ATTESTATION_TTL = 10 minutes;

    /// @notice Notice period before a proposed oracle can be installed.
    uint64 public constant ORACLE_ROTATION_DELAY = 2 days;
    /// @notice Longest the oracle alone may keep a route under protection.
    uint64 public constant MAX_ORACLE_PROTECTION = 72 hours;
    /// @notice Clear gap after a span before the oracle may open a new one.
    uint64 public constant PROTECTION_COOLDOWN = 24 hours;

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 routeId,uint256 riskScore,uint256 validUntil,uint256 nonce)"
    );

    address public oracle;
    /// @notice An oracle the owner has proposed; anyone may install it once `pendingOracleAt` has passed.
    address public pendingOracle;
    uint64 public pendingOracleAt;

    mapping(bytes32 routeId => Route) private _routes;
    /// @notice Contracts permitted to report outflows. Without this an
    ///         unrelated caller could inflate a route's usage to force it shut.
    mapping(address caller => mapping(bytes32 routeId => bool)) public isProtected;
    mapping(uint256 nonce => bool) public usedNonces;

    event RouteConfigured(bytes32 indexed routeId, uint128 cap, uint64 windowSeconds);
    event OutflowRecorded(bytes32 indexed routeId, uint256 amount, uint256 windowTotal);
    event AttestationAccepted(bytes32 indexed routeId, uint256 riskScore, uint256 nonce, uint64 expiresAt, Tier tier);
    event RouteResumed(bytes32 indexed routeId);
    event OracleUpdated(address indexed previous, address indexed next);
    event OracleRotationProposed(address indexed next, uint64 readyAt);
    event OracleRotationCancelled(address indexed next);
    event ProtectionRearmed(bytes32 indexed routeId, uint64 since);
    event ProtectedSet(address indexed caller, bytes32 indexed routeId, bool allowed);

    error ZeroAddress();
    error InvalidRouteConfig();
    error WindowChangeNotAllowed();
    error InvalidOutflow();
    error NotProtected(address caller);
    error RouteNotConfigured(bytes32 routeId);
    error RoutePaused(bytes32 routeId, uint64 pausedUntil);
    error RateLimited(bytes32 routeId, uint256 attempted, uint256 cap);
    error OutflowDelayed(bytes32 routeId, uint256 amount, uint64 releaseAt);
    error InvalidScore(uint256 riskScore);
    error ScoreBelowThreshold(uint256 riskScore);
    error AttestationExpired(uint256 validUntil);
    error AttestationTtlTooLong(uint256 validUntil);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidSigner(address recovered);
    error NoPendingOracle();
    error RotationNotReady(uint64 readyAt);
    error RaiseDuringProtection(bytes32 routeId);
    error ProtectionSpanExhausted(bytes32 routeId);

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
        // Changing bucket width would reinterpret or discard spending history.
        if (r.windowSeconds != 0 && r.windowSeconds != windowSeconds) revert WindowChangeNotAllowed();
        // Under protection the owner may tighten a route, never loosen it.
        if (r.windowSeconds != 0 && cap > r.cap && currentTier(routeId) != Tier.NONE) revert RaiseDuringProtection(routeId);
        if (r.windowSeconds == 0) r.windowStart = uint64(block.timestamp);
        r.cap = cap;
        r.windowSeconds = windowSeconds;
        emit RouteConfigured(routeId, cap, windowSeconds);
    }

    function setProtected(address caller, bytes32 routeId, bool allowed) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        isProtected[caller][routeId] = allowed;
        emit ProtectedSet(caller, routeId, allowed);
    }

    /// @notice Kill switch, for a compromised or misbehaving oracle. Instant:
    ///         with no oracle no attestation or release review verifies
    ///         (ECDSA recovery never yields the zero address), so every gated
    ///         payout fails closed until a replacement is accepted.
    function disableOracle() external onlyOwner {
        emit OracleUpdated(oracle, address(0));
        oracle = address(0);
    }

    /// @notice Start the notice period for a new oracle. Proposing again restarts it.
    function proposeOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOracle = next;
        pendingOracleAt = uint64(block.timestamp) + ORACLE_ROTATION_DELAY;
        emit OracleRotationProposed(next, pendingOracleAt);
    }

    function cancelOracleRotation() external onlyOwner {
        address next = pendingOracle;
        if (next == address(0)) revert NoPendingOracle();
        pendingOracle = address(0);
        pendingOracleAt = 0;
        emit OracleRotationCancelled(next);
    }

    /// @notice Install the proposed oracle once its notice period has passed.
    ///         Permissionless: the owner already decided, this only executes it.
    function acceptOracle() external {
        address next = pendingOracle;
        if (next == address(0)) revert NoPendingOracle();
        if (block.timestamp < pendingOracleAt) revert RotationNotReady(pendingOracleAt);
        pendingOracle = address(0);
        pendingOracleAt = 0;
        emit OracleUpdated(oracle, next);
        oracle = next;
    }

    /// @notice A human extends oracle protection through a real incident:
    ///         a fresh 72-hour span starts now, cooldown or not.
    function rearmProtection(bytes32 routeId) external onlyOwner {
        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) revert RouteNotConfigured(routeId);
        r.protectionSince = uint64(block.timestamp);
        emit ProtectionRearmed(routeId, r.protectionSince);
    }

    /// @notice Lift any tier or pause early, once a human review has cleared the route.
    function resume(bytes32 routeId) external onlyOwner {
        Route storage r = _routes[routeId];
        r.pausedUntil = 0;
        r.tier = Tier.NONE;
        r.tierExpiresAt = 0;
        r.delayUntil = 0;
        r.delayedOutflow = 0;
        // A cleared incident ends the span: the next one gets full protection.
        r.protectionSince = 0;
        emit RouteResumed(routeId);
    }

    // --- EIP-7265-style outflow hook with tiered response -------------------

    /// @inheritdoc ITripwireGuardian
    function onTokenOutflow(bytes32 routeId, uint256 amount) external {
        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) revert RouteNotConfigured(routeId);
        if (!isProtected[msg.sender][routeId]) revert NotProtected(msg.sender);
        if (amount == 0) revert InvalidOutflow();
        if (isPaused(routeId)) revert RoutePaused(routeId, r.pausedUntil);

        Tier tier = currentTier(routeId);
        if (tier == Tier.DELAY && block.timestamp < r.delayUntil) {
            // Counted in total, not per transfer: a large payout split into
            // pieces of 10% or less is held the same as the payout itself.
            uint256 held = uint256(r.delayedOutflow) + amount;
            if (held > r.cap / 10) revert OutflowDelayed(routeId, amount, r.delayUntil);
            r.delayedOutflow = uint128(held);
        }

        uint256 effectiveCap = _effectiveCap(r.cap, tier);

        uint256 total = rollingUsage(routeId) + amount;
        if (total > effectiveCap) revert RateLimited(routeId, total, effectiveCap);
        uint256 width = (uint256(r.windowSeconds) + 15) / 16;
        Bucket storage bucket = _outflows[routeId][(block.timestamp / width) % ROLLING_BUCKETS];
        // A ring slot is reused only after more than a full window has passed.
        if (uint256(bucket.lastOutflow) + r.windowSeconds <= block.timestamp) bucket.amount = 0;
        bucket.amount += uint128(amount);
        bucket.lastOutflow = uint64(block.timestamp);
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
        if (riskScore < THROTTLE_THRESHOLD) revert ScoreBelowThreshold(riskScore);
        if (block.timestamp > validUntil) revert AttestationExpired(validUntil);
        if (validUntil > block.timestamp + MAX_ATTESTATION_TTL) revert AttestationTtlTooLong(validUntil);
        if (usedNonces[nonce]) revert NonceAlreadyUsed(nonce);

        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) revert RouteNotConfigured(routeId);

        _requireOracleSignature(hashAttestation(routeId, riskScore, validUntil, nonce), signature);

        usedNonces[nonce] = true;

        Tier incoming = riskScore >= FREEZE_THRESHOLD
            ? Tier.FREEZE
            : riskScore >= DELAY_THRESHOLD ? Tier.DELAY : Tier.THROTTLE;
        Tier active = currentTier(routeId);

        // Escalate or refresh; never downgrade an active tier.
        if (incoming >= active) {
            if (_newSpanAllowed(r, active)) r.protectionSince = uint64(block.timestamp);
            uint64 until = uint64(block.timestamp) + PAUSE_DURATION;
            // However often it refreshes, the oracle alone cannot hold the route past its span.
            uint64 limit = r.protectionSince + MAX_ORACLE_PROTECTION;
            if (until > limit) until = limit;
            if (until <= block.timestamp) revert ProtectionSpanExhausted(routeId);
            // A new review window opens only on entering DELAY, not on refresh.
            if (incoming == Tier.DELAY && active != Tier.DELAY) {
                r.delayUntil = uint64(block.timestamp) + DELAY_WINDOW;
                r.delayedOutflow = 0;
            }
            if (incoming == Tier.FREEZE) r.pausedUntil = until;
            r.tier = incoming;
            r.tierExpiresAt = until;
        }

        emit AttestationAccepted(routeId, riskScore, nonce, r.tierExpiresAt, currentTier(routeId));
    }

    /// @dev A new span may open only once the last one has run its course and a
    ///      full cooldown has passed with no tier active.
    function _newSpanAllowed(Route storage r, Tier active) private view returns (bool) {
        return active == Tier.NONE &&
            block.timestamp >= uint256(r.protectionSince) + MAX_ORACLE_PROTECTION + PROTECTION_COOLDOWN;
    }

    /// @dev One key: recover and compare. A contract oracle: ERC-1271, which a
    ///      TripwireQuorum answers only for a threshold of distinct attestors.
    function _requireOracleSignature(bytes32 digest, bytes calldata signature) private view {
        address current = oracle;
        if (current.code.length == 0) {
            address signer = ECDSA.recover(digest, signature);
            if (signer != current) revert InvalidSigner(signer);
        } else if (!SignatureChecker.isValidERC1271SignatureNowCalldata(current, digest, signature)) {
            revert InvalidSigner(current);
        }
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
    function currentTier(bytes32 routeId) public view returns (Tier) {
        Route storage r = _routes[routeId];
        if (block.timestamp >= r.tierExpiresAt) return Tier.NONE;
        return r.tier;
    }

    /// @inheritdoc ITripwireGuardian
    function routeStatus(bytes32 routeId) external view returns (Status) {
        if (isPaused(routeId)) return Status.PAUSED;
        Route storage r = _routes[routeId];
        if (r.windowSeconds == 0) return Status.RATE_LIMITED;
        uint256 effectiveCap = _effectiveCap(r.cap, currentTier(routeId));
        if (rollingUsage(routeId) >= effectiveCap) return Status.RATE_LIMITED;
        return Status.ACTIVE;
    }

    /// @notice Conservative rolling usage: a bucket expires one full window
    /// after its last outflow. Nothing spent in the last window is omitted;
    /// older spends can stay counted for at most ceil(windowSeconds / 16) - 1
    /// extra seconds. Work/storage are bounded regardless of transfer count.
    function rollingUsage(bytes32 routeId) public view returns (uint256 total) {
        uint256 window = _routes[routeId].windowSeconds;
        for (uint256 i; i < ROLLING_BUCKETS; ++i) {
            Bucket storage bucket = _outflows[routeId][i];
            if (uint256(bucket.lastOutflow) + window > block.timestamp) total += bucket.amount;
        }
    }

    /// @inheritdoc ITripwireGuardian
    function outflowDelay(bytes32 routeId, uint256 amount) external view returns (uint256) {
        if (currentTier(routeId) != Tier.DELAY) return 0;
        Route storage r = _routes[routeId];
        if (amount > r.cap / 10) return DELAY_WINDOW;
        // A small request too, once the review window's 10% budget is spent.
        return block.timestamp < r.delayUntil && uint256(r.delayedOutflow) + amount > r.cap / 10 ? DELAY_WINDOW : 0;
    }

    /// @notice Until when the oracle may hold this route if it attested now.
    ///         A value at or before `block.timestamp` means the span is spent:
    ///         attestations revert ProtectionSpanExhausted until the cooldown
    ///         ends or the owner re-arms the route.
    function protectionLimit(bytes32 routeId) external view returns (uint64) {
        Route storage r = _routes[routeId];
        if (_newSpanAllowed(r, currentTier(routeId))) return uint64(block.timestamp) + MAX_ORACLE_PROTECTION;
        return r.protectionSince + MAX_ORACLE_PROTECTION;
    }

    /// @dev One definition of each tier's cap, shared by the hook and the view.
    ///      DELAY is at least as strict as THROTTLE.
    function _effectiveCap(uint128 cap, Tier tier) private pure returns (uint256) {
        return tier == Tier.THROTTLE || tier == Tier.DELAY ? uint256(cap) / 2 : cap;
    }

    /// @notice Route state for the dashboard's route matrix.
    function getRoute(bytes32 routeId) external view returns (Route memory) {
        Route memory r = _routes[routeId];
        r.outflowInWindow = uint128(rollingUsage(routeId));
        return r;
    }
}
