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
    ///         if outflow exceeds the tier's cap, or if a large outflow falls
    ///         inside a DELAY review window.
    function onTokenOutflow(bytes32 routeId, uint256 amount) external;

    /// @notice Hold duration for a newly reviewed request under the active tier.
    /// Vaults must keep a per-request clock in addition to the route-wide hook.
    function outflowDelay(bytes32 routeId, uint256 amount) external view returns (uint256);

    /// @notice Submit an EIP-712 attestation signed by the risk oracle.
    ///         Applies a graduated tier for 24h, escalate-only while active:
    ///         - riskScore >= 95: FREEZE   — every outflow reverts
    ///         - riskScore >= 85: DELAY    — cap halved, and outflows above 10%
    ///                                       of the cap held for 30 minutes
    ///         - riskScore >= 65: THROTTLE — cap halved
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
