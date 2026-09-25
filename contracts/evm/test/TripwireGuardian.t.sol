// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {TripwireGuardian} from "../src/TripwireGuardian.sol";
import {ITripwireGuardian} from "../src/ITripwireGuardian.sol";

/// @notice Foundry suite for the guardian. Mirrors TripwireGuardian.evm.test.ts,
///         whose assertions have been executed against the compiled bytecode
///         and mutation-tested (12/12 mutants killed). Adds fuzzing, which
///         only Foundry does well.
///
///         forge install foundry-rs/forge-std && forge test -vv
contract TripwireGuardianTest is Test {
    TripwireGuardian internal g;

    uint256 internal constant ORACLE_PK = 0xA11CE;
    uint256 internal constant ATTACKER_PK = 0xBAD;
    address internal oracle;
    address internal attacker;
    address internal owner = makeAddr("owner");
    address internal bridge = makeAddr("bridge");
    address internal relayer = makeAddr("relayer");

    bytes32 internal constant ROUTE = keccak256("eth:arb:USDC");
    bytes32 internal constant OTHER_ROUTE = keccak256("base:op:WETH");
    uint128 internal constant CAP = 1_000_000;
    uint64 internal constant WINDOW = 1 hours;

    /// secp256k1 group order, for the malleability test.
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 internal nonce;

    function setUp() public {
        vm.warp(1_780_000_000);
        oracle = vm.addr(ORACLE_PK);
        attacker = vm.addr(ATTACKER_PK);
        g = new TripwireGuardian(owner, oracle);
        vm.startPrank(owner);
        g.configureRoute(ROUTE, CAP, WINDOW);
        g.setProtected(bridge, true);
        vm.stopPrank();
    }

    // --- helpers -------------------------------------------------------------

    function _sign(uint256 pk, bytes32 routeId, uint256 score, uint256 validUntil, uint256 n)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, g.hashAttestation(routeId, score, validUntil, n));
        return abi.encodePacked(r, s, v);
    }

    function _attest(uint256 score) internal returns (uint256 n) {
        n = ++nonce;
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, score, validUntil, n);
        vm.prank(relayer);
        g.submitAttestation(ROUTE, score, validUntil, n, sig);
    }

    function _route() internal view returns (TripwireGuardian.Route memory) {
        return g.getRoute(ROUTE);
    }

    // --- deployment ------------------------------------------------------------

    function test_RevertWhen_DeployedWithZeroOracle() public {
        vm.expectRevert(TripwireGuardian.ZeroAddress.selector);
        new TripwireGuardian(owner, address(0));
    }

    // --- EIP-7265 outflow cap --------------------------------------------------

    function test_OutflowUpToCapThenRejects() public {
        vm.startPrank(bridge);
        g.onTokenOutflow(ROUTE, 600_000);
        g.onTokenOutflow(ROUTE, 400_000);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.RateLimited.selector, ROUTE, CAP + 1, CAP));
        g.onTokenOutflow(ROUTE, 1);
        vm.stopPrank();
    }

    function test_WindowRollResetsUsage() public {
        vm.prank(bridge);
        g.onTokenOutflow(ROUTE, CAP);
        assertEq(uint8(g.routeStatus(ROUTE)), uint8(ITripwireGuardian.Status.RATE_LIMITED));
        vm.warp(block.timestamp + WINDOW);
        assertEq(uint8(g.routeStatus(ROUTE)), uint8(ITripwireGuardian.Status.ACTIVE));
        vm.prank(bridge);
        g.onTokenOutflow(ROUTE, CAP);
    }

    function test_RevertWhen_CallerNotProtected() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.NotProtected.selector, attacker));
        g.onTokenOutflow(ROUTE, 1);
    }

    function test_RevertWhen_RouteNotConfigured() public {
        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.RouteNotConfigured.selector, OTHER_ROUTE));
        g.onTokenOutflow(OTHER_ROUTE, 1);
    }

    function test_RevertWhen_ConfiguredWithZeroCapOrWindow() public {
        vm.startPrank(owner);
        vm.expectRevert(TripwireGuardian.InvalidRouteConfig.selector);
        g.configureRoute(OTHER_ROUTE, 0, WINDOW);
        vm.expectRevert(TripwireGuardian.InvalidRouteConfig.selector);
        g.configureRoute(OTHER_ROUTE, CAP, 0);
        vm.stopPrank();
    }

    // --- tiered pausing --------------------------------------------------------

    function test_HighRiskPausesForFourHours() public {
        _attest(80);
        assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.HIGH));
        assertEq(_route().pausedUntil, block.timestamp + 4 hours);
        assertTrue(g.isPaused(ROUTE));
        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(TripwireGuardian.RoutePaused.selector, ROUTE, uint64(block.timestamp + 4 hours))
        );
        g.onTokenOutflow(ROUTE, 1);
    }

    function test_CriticalRiskLocksDownForTwentyFourHours() public {
        _attest(95);
        assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.CRITICAL));
        assertEq(_route().pausedUntil, block.timestamp + 24 hours);
    }

    function test_PausesOnlyTheAttestedRoute() public {
        vm.prank(owner);
        g.configureRoute(OTHER_ROUTE, CAP, WINDOW);
        _attest(80);
        assertTrue(g.isPaused(ROUTE));
        assertFalse(g.isPaused(OTHER_ROUTE));
        vm.prank(bridge);
        g.onTokenOutflow(OTHER_ROUTE, 1);
    }

    /// Every score in [0, 200]: out-of-range and at-or-below-75 revert, 76-90
    /// is HIGH, 91-100 is CRITICAL. Pins the strict thresholds exhaustively.
    function testFuzz_ScoreTiers(uint256 score) public {
        score = bound(score, 0, 200);
        uint256 n = ++nonce;
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, score, validUntil, n);

        if (score > 100) {
            vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.InvalidScore.selector, score));
        } else if (score <= 75) {
            vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.ScoreBelowThreshold.selector, score));
        }
        g.submitAttestation(ROUTE, score, validUntil, n, sig);

        if (score > 90 && score <= 100) {
            assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.CRITICAL));
        } else if (score > 75 && score <= 90) {
            assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.HIGH));
        }
    }

    // --- pause monotonicity ----------------------------------------------------

    function test_HighCannotShortenCriticalLockdown() public {
        _attest(95);
        uint64 lockdownEnd = _route().pausedUntil;
        vm.warp(block.timestamp + 1 hours);
        _attest(80);
        assertEq(_route().pausedUntil, lockdownEnd);
        assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.CRITICAL));
    }

    function test_CriticalEscalatesHighPause() public {
        _attest(80);
        vm.warp(block.timestamp + 1 hours);
        _attest(95);
        assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.CRITICAL));
        assertEq(_route().pausedUntil, block.timestamp + 24 hours);
    }

    // --- expiry and escape hatches ---------------------------------------------

    function test_PauseExpiresOnItsOwn() public {
        _attest(80);
        vm.warp(block.timestamp + 4 hours - 1);
        assertTrue(g.isPaused(ROUTE));
        vm.warp(block.timestamp + 1);
        assertFalse(g.isPaused(ROUTE));
        vm.prank(bridge);
        g.onTokenOutflow(ROUTE, 1);
    }

    function test_OwnerCanResumeEarly() public {
        _attest(95);
        vm.prank(owner);
        g.resume(ROUTE);
        assertFalse(g.isPaused(ROUTE));
        assertEq(uint8(_route().tier), uint8(TripwireGuardian.Tier.NONE));
    }

    function test_RotatedOracleKeyCannotPause() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory oldSig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 1);
        vm.prank(owner);
        g.setOracle(attacker);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.InvalidSigner.selector, oracle));
        g.submitAttestation(ROUTE, 80, validUntil, 1, oldSig);
    }

    function test_RevertWhen_NonOwnerAdministers() public {
        vm.startPrank(attacker);
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker);
        vm.expectRevert(unauthorized);
        g.configureRoute(OTHER_ROUTE, CAP, WINDOW);
        vm.expectRevert(unauthorized);
        g.setProtected(attacker, true);
        vm.expectRevert(unauthorized);
        g.setOracle(attacker);
        vm.expectRevert(unauthorized);
        g.resume(ROUTE);
        vm.stopPrank();
    }

    // --- replay protection -------------------------------------------------------

    function test_RevertWhen_NonceReused() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 7);
        g.submitAttestation(ROUTE, 80, validUntil, 7, sig);
        vm.prank(owner);
        g.resume(ROUTE);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.NonceAlreadyUsed.selector, 7));
        g.submitAttestation(ROUTE, 80, validUntil, 7, sig);
    }

    /// Identical bytecode runs on four chains. A signature made while the
    /// guardian sat on chain 1 must not verify once the chain id differs.
    function test_RevertWhen_SignatureFromAnotherChain() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory mainnetSig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 1);
        vm.chainId(42161);
        vm.expectRevert();
        g.submitAttestation(ROUTE, 80, validUntil, 1, mainnetSig);
    }

    function test_RevertWhen_SignedByNonOracle() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory sig = _sign(ATTACKER_PK, ROUTE, 80, validUntil, 1);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.InvalidSigner.selector, attacker));
        g.submitAttestation(ROUTE, 80, validUntil, 1, sig);
    }

    function test_RevertWhen_ScoreTamperedAfterSigning() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 1);
        vm.expectRevert();
        g.submitAttestation(ROUTE, 99, validUntil, 1, sig);
    }

    function test_RevertWhen_Expired() public {
        uint256 validUntil = block.timestamp + 60;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 1);
        vm.warp(block.timestamp + 61);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.AttestationExpired.selector, validUntil));
        g.submitAttestation(ROUTE, 80, validUntil, 1, sig);
    }

    function test_RevertWhen_TtlTooLong() public {
        uint256 validUntil = block.timestamp + 10 minutes + 1;
        bytes memory sig = _sign(ORACLE_PK, ROUTE, 80, validUntil, 1);
        vm.expectRevert(abi.encodeWithSelector(TripwireGuardian.AttestationTtlTooLong.selector, validUntil));
        g.submitAttestation(ROUTE, 80, validUntil, 1, sig);
    }

    function test_RevertWhen_SignatureMalleated() public {
        uint256 validUntil = block.timestamp + 5 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK, g.hashAttestation(ROUTE, 80, validUntil, 1));
        bytes memory malleated = abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, bytes32(N - uint256(s))));
        g.submitAttestation(ROUTE, 80, validUntil, 1, malleated);
    }

    function test_RevertWhen_SignatureMalformed() public {
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 2));
        g.submitAttestation(ROUTE, 80, block.timestamp + 5 minutes, 1, hex"1234");
    }

    // --- route status ------------------------------------------------------------

    function test_StatusCyclesActiveRateLimitedPaused() public {
        assertEq(uint8(g.routeStatus(ROUTE)), uint8(ITripwireGuardian.Status.ACTIVE));
        vm.prank(bridge);
        g.onTokenOutflow(ROUTE, CAP);
        assertEq(uint8(g.routeStatus(ROUTE)), uint8(ITripwireGuardian.Status.RATE_LIMITED));
        _attest(80);
        assertEq(uint8(g.routeStatus(ROUTE)), uint8(ITripwireGuardian.Status.PAUSED));
    }

    /// Cumulative outflow never exceeds the cap within a window, whatever the
    /// sequence of amounts.
    function testFuzz_CapHoldsForAnySequence(uint96[8] calldata amounts) public {
        uint256 total;
        vm.startPrank(bridge);
        for (uint256 i; i < amounts.length; ++i) {
            uint256 a = bound(amounts[i], 1, CAP);
            if (total + a > CAP) {
                vm.expectRevert(
                    abi.encodeWithSelector(TripwireGuardian.RateLimited.selector, ROUTE, total + a, CAP)
                );
                g.onTokenOutflow(ROUTE, a);
            } else {
                g.onTokenOutflow(ROUTE, a);
                total += a;
            }
        }
        vm.stopPrank();
        assertLe(_route().outflowInWindow, CAP);
    }

    // --- gas -------------------------------------------------------------------

    function test_GasHotPath() public {
        vm.startPrank(bridge);
        g.onTokenOutflow(ROUTE, 1); // warm the slots
        uint256 before = gasleft();
        g.onTokenOutflow(ROUTE, 1);
        uint256 outflowGas = before - gasleft();
        vm.stopPrank();
        // Execution gas only; the EVM suite's 34,104 includes the 21k base tx cost.
        assertLt(outflowGas, 20_000);
    }
}
