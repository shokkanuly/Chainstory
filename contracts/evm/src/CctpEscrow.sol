// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtectedVault} from "./TripwireDemo.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITripwireGuardian} from "./ITripwireGuardian.sol";

// Circle interface/layout pinned in docs/plans/tripwire-cctp.md (ADR-018).
interface ICctpTransmitter {
    function localDomain() external view returns (uint32);
    function version() external view returns (uint32);
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @notice Standard CCTP v2 USDC escrow. Circle authenticates the mint;
/// Tripwire independently gates execution of the resulting immutable credit.
/// No administrator can request a credit or withdraw pooled funds.
contract CctpEscrow is ProtectedVault, ReentrancyGuard {
    struct CctpConfig {
        ICctpTransmitter transmitter;
        address destinationMessenger;
        uint32 sourceDomain;
        address sourceMessenger;
        address sourceToken;
    }
    uint256 public constant CCTP_ESCROW_VERSION = 1;
    bytes32 public constant ESCROW_ID_DOMAIN = keccak256("Tripwire/CCTP/v2/escrow/v1");
    bytes32 public constant BENEFICIARY_HOOK = keccak256("Tripwire/CCTP/v2/USDC/beneficiary/v1");
    ICctpTransmitter public immutable transmitter;
    address public immutable destinationMessenger;
    uint32 public immutable destinationDomain;
    uint32 public immutable sourceDomain;
    address public immutable sourceMessenger;
    address public immutable sourceToken;
    mapping(bytes32 => bool) public usedCctpNonces;
    mapping(bytes32 => bytes32) public fundedMessageHash;

    event CctpEscrowFunded(bytes32 indexed messageId, bytes32 indexed nonce, bytes32 messageHash, uint256 amount);
    error InvalidCctpConfiguration();
    error UnsupportedCctpMessage();
    error InvalidCctpBinding();
    error InvalidCctpAmount();
    error CctpNonceUsed();
    error CctpReceiveFailed();
    error CctpMintMismatch();

    // Self-ownership makes inherited onlyOwner requestRelease unreachable to
    // external actors. The only self-call below supplies authenticated fields.
    constructor(IERC20 token_, ITripwireGuardian guardian_, bytes32 routeId_, CctpConfig memory config)
        ProtectedVault(address(this), token_, guardian_, routeId_)
    {
        if (address(token_).code.length == 0 || address(guardian_).code.length == 0 || routeId_ == bytes32(0) ||
            address(config.transmitter).code.length == 0 || config.destinationMessenger == address(0) ||
            config.sourceMessenger == address(0) || config.sourceToken == address(0)) revert InvalidCctpConfiguration();
        uint32 local = config.transmitter.localDomain();
        if (config.transmitter.version() != 1 || config.sourceDomain == local) revert InvalidCctpConfiguration();
        transmitter = config.transmitter;
        destinationMessenger = config.destinationMessenger;
        destinationDomain = local;
        sourceDomain = config.sourceDomain;
        sourceMessenger = config.sourceMessenger;
        sourceToken = config.sourceToken;
    }

    function releaseId(bytes32 nonce) public view virtual returns (bytes32) {
        return keccak256(abi.encode(ESCROW_ID_DOMAIN, block.chainid, address(this), sourceDomain, nonce));
    }

    /// Permissionless relay, requiring the burn's destinationCaller to be this
    /// escrow. A direct call to Circle cannot consume its nonce and strand mint.
    function receiveCctp(bytes calldata message, bytes calldata attestation) external nonReentrant {
        if (message.length < 376 || uint32(bytes4(message[0:4])) != 1 ||
            uint32(bytes4(message[148:152])) != 1 || uint32(bytes4(message[140:144])) != 2000 ||
            uint32(bytes4(message[144:148])) != 2000) {
            revert UnsupportedCctpMessage();
        }
        if (uint32(bytes4(message[4:8])) != sourceDomain || uint32(bytes4(message[8:12])) != destinationDomain ||
            _address(message, 44) != sourceMessenger || _address(message, 76) != destinationMessenger ||
            _address(message, 108) != address(this) || _address(message, 152) != sourceToken ||
            _address(message, 184) != address(this)) revert InvalidCctpBinding();
        // Canonical EVM padding on the depositor and beneficiary as well.
        _address(message, 248);
        address beneficiary = _beneficiary(message);
        if (beneficiary == address(0) || beneficiary == address(this)) revert InvalidCctpBinding();
        uint256 gross = uint256(bytes32(message[216:248]));
        uint256 maxFee = uint256(bytes32(message[280:312]));
        uint256 fee = uint256(bytes32(message[312:344]));
        uint256 expiration = uint256(bytes32(message[344:376]));
        if (gross == 0 || maxFee >= gross || fee > maxFee || fee >= gross ||
            (expiration != 0 && expiration <= block.number)) revert InvalidCctpAmount();
        bytes32 nonce = bytes32(message[12:44]);
        if (nonce == bytes32(0) || usedCctpNonces[nonce]) revert CctpNonceUsed();
        usedCctpNonces[nonce] = true;
        uint256 net = gross - fee;
        uint256 beforeMint = token.balanceOf(address(this));
        // Signature verification and token minting belong to the pinned Circle
        // contracts. A failed check below rolls back Circle's mint and nonce too.
        if (!transmitter.receiveMessage(message, attestation)) revert CctpReceiveFailed();
        uint256 afterMint = token.balanceOf(address(this));
        if (afterMint < beforeMint || afterMint - beforeMint != net) revert CctpMintMismatch();
        bytes32 id = releaseId(nonce);
        fundedMessageHash[id] = keccak256(message);
        _registerCredit(id, message, net);
        this.requestRelease(id, beneficiary, net);
        emit CctpEscrowFunded(id, nonce, fundedMessageHash[id], net);
    }

    function _beneficiary(bytes calldata message) internal virtual returns (address) {
        // Header 148 + burn body 228 + exactly one 64-byte beneficiary hook.
        if (message.length != 440 || bytes32(message[376:408]) != BENEFICIARY_HOOK) revert UnsupportedCctpMessage();
        return _address(message, 408);
    }

    function _registerCredit(bytes32 id, bytes calldata message, uint256 net) internal virtual {}

    function _address(bytes calldata message, uint256 offset) internal pure returns (address) {
        uint256 word = uint256(bytes32(message[offset:offset + 32]));
        if (word > type(uint160).max) revert InvalidCctpBinding();
        return address(uint160(word));
    }
}
