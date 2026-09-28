// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITripwireGuardian
/// @notice What a protected bridge or vault integrates against. Identical
///         bytecode is deployed to Ethereum, Arbitrum, Base and Optimism.
interface ITripwireGuardian {
    enum Status {
        ACTIVE,
        RATE_LIMITED,
        PAUSED
    }

    enum Tier {
        NONE,
        THROTTLE,
        DELAY,
        FREEZE
    }

    /// @notice EIP-7265-style outflow hook. Reverts if the route is frozen,
    ///         or if outflow exceeds the current (or throttled) cap.
    function onTokenOutflow(bytes32 routeId, uint256 amount) external;

    /// @notice Submit an EIP-712 attestation signed by the risk oracle.
    ///         Applies graduated response tier:
    ///         - riskScore >= 95: FREEZE (halts route)
    ///         - riskScore >= 85: DELAY (enforces delay window on large transfers)
    ///         - riskScore >= 65: THROTTLE (reduces hourly outflow cap by 50%)
    function submitAttestation(
        bytes32 routeId,
        uint256 riskScore,
        uint256 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external;

    function isPaused(bytes32 routeId) external view returns (bool);

    function routeStatus(bytes32 routeId) external view returns (Status);

    function currentTier(bytes32 routeId) external view returns (Tier);
}
