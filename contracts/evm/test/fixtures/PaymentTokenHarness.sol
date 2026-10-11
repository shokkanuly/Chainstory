// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DemoUSDC} from "../../src/TripwireDemo.sol";

// Test-only token. Fault setters deliberately have no access control.
// It is never compiled into a production artifact.
contract PaymentTokenHarness is DemoUSDC {
    bool public failTransfers;
    address public callbackTarget;
    bytes public callbackData;
    bytes4 public callbackError;
    error TestTransferFailure();
    constructor(address owner_) DemoUSDC(owner_) {}
    function setFailure(bool fail) external { failTransfers = fail; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            if (failTransfers) revert TestTransferFailure();
            address target = callbackTarget;
            if (target != address(0)) {
                callbackTarget = address(0);
                (bool ok, bytes memory result) = target.call(callbackData);
                callbackError = ok ? bytes4(0) : bytes4(result);
            }
        }
        super._update(from, to, value);
    }
}
