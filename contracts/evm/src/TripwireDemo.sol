// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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
contract ProtectedVault is Ownable {
    struct Release {
        address to;
        uint256 amount;
        bool executed;
    }

    IERC20 public immutable token;
    ITripwireGuardian public immutable guardian;
    bytes32 public immutable routeId;

    mapping(bytes32 messageId => Release) public releases;

    event ReleaseRequested(bytes32 indexed messageId, address indexed to, uint256 amount);
    event ReleaseExecuted(bytes32 indexed messageId, address indexed to, uint256 amount);

    error UnknownRelease(bytes32 messageId);
    error AlreadyRequested(bytes32 messageId);
    error AlreadyExecuted(bytes32 messageId);

    constructor(address owner_, IERC20 token_, ITripwireGuardian guardian_, bytes32 routeId_) Ownable(owner_) {
        token = token_;
        guardian = guardian_;
        routeId = routeId_;
    }

    /// @notice The relayer delivers a cross-chain message. In an exploit, this
    ///         is where a forged message arrives.
    function requestRelease(bytes32 messageId, address to, uint256 amount) external onlyOwner {
        if (releases[messageId].to != address(0)) revert AlreadyRequested(messageId);
        releases[messageId] = Release(to, amount, false);
        emit ReleaseRequested(messageId, to, amount);
    }

    function executeRelease(bytes32 messageId) external {
        Release storage r = releases[messageId];
        if (r.to == address(0)) revert UnknownRelease(messageId);
        if (r.executed) revert AlreadyExecuted(messageId);
        r.executed = true;
        guardian.onTokenOutflow(routeId, r.amount);
        token.transfer(r.to, r.amount);
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
