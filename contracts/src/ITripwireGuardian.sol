// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITripwireGuardian
/// @notice The interface a protected bridge or vault integrates against.
/// @dev Identical bytecode is deployed to Ethereum, Arbitrum, Base and
///      Optimism. Solana has no equivalent to extend, so it gets a native
///      Anchor program implementing the same state machine.
interface ITripwireGuardian {
    /// @notice EIP-7265-style hook. The protected contract calls this after it
    ///         moves tokens, and the call reverts if the route is paused or the
    ///         outflow would exceed the rolling window cap.
    /// @param route Opaque id for the (source, destination, asset) triple.
    /// @param amount Outflow size, in the route's accounting unit.
    function onTokenOutflow(bytes32 route, uint256 amount) external;

    /// @notice The extension over the base standard: the off-chain risk oracle
    ///         pauses a route on evidence that has nothing to do with raw
    ///         outflow volume — a proof/payout mismatch, a flagged
    ///         counterparty, an abnormal pattern under the dollar cap.
    function submitAttestation(
        bytes32 route,
        uint256 riskScore,
        uint256 expiry,
        uint256 nonce,
        bytes calldata signature
    ) external;

    function isPaused(bytes32 route) external view returns (bool);
}
