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

    /// @notice EIP-7265-style outflow hook. Reverts if the route is paused, or
    ///         if the outflow would take the rolling window past its cap.
    function onTokenOutflow(bytes32 routeId, uint256 amount) external;

    /// @notice Pause a route on an EIP-712 attestation signed by the risk
    ///         oracle. Permissionless to relay; the signature is the authority.
    function submitAttestation(
        bytes32 routeId,
        uint256 riskScore,
        uint256 validUntil,
        uint256 nonce,
        bytes calldata signature
    ) external;

    function isPaused(bytes32 routeId) external view returns (bool);

    function routeStatus(bytes32 routeId) external view returns (Status);
}
