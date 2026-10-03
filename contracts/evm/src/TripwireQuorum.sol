// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title TripwireQuorum
/// @notice A k-of-n attestor set that stands in for the single oracle key
///         (ADR-021). Install it as the guardian's `oracle`: the guardian and
///         every gated vault then accept a route attestation or release review
///         only when `threshold` distinct attestors signed the exact digest.
///
/// @dev Invariants, and the attack each one closes:
///
///      - No single key attests. A signature is `threshold` or more 65-byte
///        ECDSA signatures over the caller's own EIP-712 digest, concatenated
///        in strictly ascending signer order. Ascending order makes a repeated
///        signer impossible, so one stolen key counts once.
///
///      - The quorum is an honest majority: `2 * threshold > n`. Two disjoint
///        groups can never both reach threshold, and 1-of-n is refused.
///
///      - No owner. Membership changes only by a quorum of the current set
///        signing `UpdateSigners`, bound to this contract, chain and `epoch`;
///        each change bumps the epoch, so an approved update cannot be replayed.
///        If the set is lost, the guardian owner disables the oracle at once
///        (`disableOracle`), which also invalidates every outstanding release
///        review, and installs a new quorum through the 2-day
///        `proposeOracle` / `acceptOracle` rotation.
///
///      - The quorum signs digests that already bind their verifying contract,
///        chain, route and nonce, so it adds no replay surface of its own.
///
///      - Verification never reverts on bad input: a malformed or short
///        signature returns the ERC-1271 failure value and the caller rejects.
contract TripwireQuorum is IERC1271, EIP712 {
    uint256 public constant QUORUM_VERSION = 1;
    uint256 public constant MAX_SIGNERS = 16;
    uint256 private constant SIGNATURE_BYTES = 65;

    bytes32 public constant UPDATE_TYPEHASH =
        keccak256("UpdateSigners(address[] signers,uint256 threshold,uint256 epoch)");

    address[] private _signers;
    mapping(address signer => bool) public isSigner;
    uint256 public threshold;
    /// @notice Incremented by every membership change; signed into each update.
    uint256 public epoch;

    event SignersUpdated(uint256 indexed epoch, address[] signers, uint256 threshold);

    error InvalidQuorum();
    error QuorumNotMet();

    constructor(address[] memory signers_, uint256 threshold_) EIP712("TripwireQuorum", "1") {
        _install(signers_, threshold_);
    }

    /// @notice The current attestor set, ascending.
    function signers() external view returns (address[] memory) {
        return _signers;
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return _quorumSigned(hash, signature) ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    /// @notice Replace the attestor set. Authorized by a quorum of the current set.
    function updateSigners(address[] calldata next, uint256 nextThreshold, bytes calldata signature) external {
        if (!_quorumSigned(hashUpdate(next, nextThreshold, epoch), signature)) revert QuorumNotMet();
        ++epoch;
        _install(next, nextThreshold);
    }

    /// @notice The EIP-712 digest the current set signs to approve `next`.
    function hashUpdate(address[] calldata next, uint256 nextThreshold, uint256 epoch_) public view returns (bytes32) {
        // EIP-712 encodes address[] as the hash of its 32-byte-padded elements,
        // which is exactly abi.encodePacked for an address array.
        return _hashTypedDataV4(keccak256(abi.encode(UPDATE_TYPEHASH, keccak256(abi.encodePacked(next)), nextThreshold, epoch_)));
    }

    function _quorumSigned(bytes32 hash, bytes calldata signature) private view returns (bool) {
        uint256 count = signature.length / SIGNATURE_BYTES;
        if (signature.length % SIGNATURE_BYTES != 0 || count < threshold || count > MAX_SIGNERS) return false;
        address previous;
        for (uint256 i; i < count; ++i) {
            (address signer, ECDSA.RecoverError err, ) =
                ECDSA.tryRecoverCalldata(hash, signature[i * SIGNATURE_BYTES:(i + 1) * SIGNATURE_BYTES]);
            // Strictly ascending: no signer counts twice, and address(0) never counts.
            if (err != ECDSA.RecoverError.NoError || signer <= previous || !isSigner[signer]) return false;
            previous = signer;
        }
        return true;
    }

    function _install(address[] memory next, uint256 nextThreshold) private {
        uint256 n = next.length;
        if (n == 0 || n > MAX_SIGNERS || nextThreshold == 0 || nextThreshold > n || nextThreshold * 2 <= n) {
            revert InvalidQuorum();
        }
        for (uint256 i; i < _signers.length; ++i) isSigner[_signers[i]] = false;
        address previous;
        for (uint256 i; i < n; ++i) {
            if (next[i] <= previous) revert InvalidQuorum();
            isSigner[next[i]] = true;
            previous = next[i];
        }
        _signers = next;
        threshold = nextThreshold;
        emit SignersUpdated(epoch, next, nextThreshold);
    }
}
