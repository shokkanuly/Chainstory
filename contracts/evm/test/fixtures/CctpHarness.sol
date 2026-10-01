// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoUSDC} from "../../src/TripwireDemo.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Test only: one local attester, not Circle's threshold implementation.
contract CctpHarness {
    uint32 public constant localDomain = 0;
    uint32 public constant version = 1;
    address public immutable attester;
    DemoUSDC public immutable token;
    mapping(bytes32 => uint256) public usedNonces;
    uint256 public fault;
    event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce,
        bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody);

    constructor(address attester_, DemoUSDC token_) { attester = attester_; token = token_; }
    function setFault(uint256 value) external { fault = value; }
    function receiveMessage(bytes calldata message, bytes calldata signature) external returns (bool) {
        require(ECDSA.recover(keccak256(message), signature) == attester, "attestation");
        bytes32 caller = bytes32(message[108:140]);
        require(caller == bytes32(0) || caller == bytes32(uint256(uint160(msg.sender))), "caller");
        bytes32 nonce = bytes32(message[12:44]);
        require(nonce != bytes32(0) && usedNonces[nonce] == 0, "nonce");
        usedNonces[nonce] = 1;
        address recipient = address(uint160(uint256(bytes32(message[184:216]))));
        uint256 net = uint256(bytes32(message[216:248])) - uint256(bytes32(message[312:344]));
        if (fault == 4) {
            (bool success,) = msg.sender.call(abi.encodeWithSignature("receiveCctp(bytes,bytes)", message, signature));
            require(success, "recursive receive");
        }
        if (fault != 1) token.mint(recipient, fault == 2 ? net - 1 : fault == 3 ? net + 1 : net);
        emit MessageReceived(msg.sender, uint32(bytes4(message[4:8])), nonce, bytes32(message[44:76]),
            uint32(bytes4(message[144:148])), message[148:]);
        return fault != 5;
    }
}
