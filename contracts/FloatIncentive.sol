// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FloatIncentive
 * @notice Rewards B2B partners for maintaining a XIDR float in their wallets.
 *
 * Yield mechanics
 * ───────────────
 * - Partners are registered by MANAGER_ROLE.
 * - Yield accrues based on the partner's live on-chain XIDR balance.
 * - If balance drops below minimumFloat, no yield is accrued for that period.
 * - Yield = balance × apyBps × timeElapsed / (10_000 × 365 days)
 *   (integer arithmetic only — no floating point)
 * - Partners call claimYield() to pull earned XIDR from the contract treasury.
 *
 * Reentrancy protection
 * ─────────────────────
 * claimYield() follows checks-effects-interactions strictly:
 *   1. Check: verify balance, compute amount
 *   2. Effects: zero out accruedYield BEFORE transfer
 *   3. Interactions: safeTransfer to partner
 * No reentrancy guard needed — CEI prevents double-claim.
 *
 * Upgrade pattern
 * ───────────────
 * UUPS — same as XIdrToken (Fix 1). Only DEFAULT_ADMIN_ROLE can authorise an upgrade.
 */
contract FloatIncentive is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Roles ──────────────────────────────────────────────────────────────────
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    // ── State ──────────────────────────────────────────────────────────────────
    IERC20 public xidrToken;

    /// @notice Annual percentage yield in basis points (e.g. 350 = 3.50 %).
    uint256 public apyBps;

    /// @notice Minimum XIDR a partner must hold to qualify for any yield.
    uint256 public minimumFloat;

    struct PartnerStake {
        address wallet;        // partner's registered wallet
        uint256 stakedAt;      // timestamp when stake was first recorded
        uint256 lastClaimAt;   // timestamp of last accrual / claim
        uint256 accruedYield;  // XIDR yield accrued but not yet claimed
        bool    isActive;      // false once deregistered
    }

    /// @dev wallet → stake info
    mapping(address => PartnerStake) public stakes;

    /// @dev Enumerable list of all registered partner wallets (active + deregistered).
    address[] public partnerWallets;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant MAX_APY_BPS    = 2_000; // 20 %
    uint256 private constant YEAR_SECONDS  = 365 days;

    // ── Events ─────────────────────────────────────────────────────────────────
    event PartnerRegistered  (address indexed wallet, uint256 timestamp);
    event PartnerDeregistered(address indexed wallet, uint256 timestamp);
    event YieldAccrued       (address indexed wallet, uint256 amount);
    event YieldClaimed       (address indexed wallet, uint256 amount, uint256 timestamp);
    event ApyUpdated         (uint256 oldApyBps, uint256 newApyBps);
    event MinimumFloatUpdated(uint256 oldMin,    uint256 newMin);
    event TreasuryFunded     (uint256 amount,    uint256 newBalance);

    // ── Errors ─────────────────────────────────────────────────────────────────
    error AlreadyRegistered(address wallet);
    error NotRegistered(address wallet);
    error ApyTooHigh(uint256 newApyBps, uint256 maxApyBps);
    error TreasuryUnderfunded(uint256 needed, uint256 available);
    error ZeroAmount();

    // ── Initializer ────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param _xidrToken      Address of the XIDR ERC-20 token.
     * @param _initialApyBps  Initial APY in basis points (e.g. 350 for 3.5 %).
     * @param _initialMinFloat Minimum XIDR float to qualify for yield.
     * @param _admin          Address granted admin + manager + treasury roles.
     */
    function initialize(
        address _xidrToken,
        uint256 _initialApyBps,
        uint256 _initialMinFloat,
        address _admin
    ) external initializer {
        require(_xidrToken != address(0), "FloatIncentive: zero token");
        require(_admin     != address(0), "FloatIncentive: zero admin");
        require(_initialApyBps <= MAX_APY_BPS, "FloatIncentive: APY too high");

        __AccessControl_init();
        __Pausable_init();

        xidrToken    = IERC20(_xidrToken);
        apyBps       = _initialApyBps;
        minimumFloat = _initialMinFloat;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MANAGER_ROLE,       _admin);
        _grantRole(TREASURY_ROLE,      _admin);
    }

    // ── Partner management ──────────────────────────────────────────────────────

    /**
     * @notice Register a wallet as eligible for float yield.
     * @dev Only MANAGER_ROLE. Reverts if wallet already registered.
     */
    function registerPartner(address wallet) external onlyRole(MANAGER_ROLE) {
        if (stakes[wallet].stakedAt != 0) revert AlreadyRegistered(wallet);

        stakes[wallet] = PartnerStake({
            wallet:       wallet,
            stakedAt:     block.timestamp,
            lastClaimAt:  block.timestamp,
            accruedYield: 0,
            isActive:     true
        });
        partnerWallets.push(wallet);

        emit PartnerRegistered(wallet, block.timestamp);
    }

    /**
     * @notice Deregister a partner. Accrues pending yield first so it can still
     *         be claimed. Setting isActive=false prevents future accrual.
     */
    function deregisterPartner(address wallet) external onlyRole(MANAGER_ROLE) {
        if (stakes[wallet].stakedAt == 0) revert NotRegistered(wallet);

        _accrueYield(wallet);
        stakes[wallet].isActive = false;

        emit PartnerDeregistered(wallet, block.timestamp);
    }

    // ── Yield accrual ───────────────────────────────────────────────────────────

    /**
     * @notice Public trigger — anyone can pay gas to accrue yield for a wallet.
     */
    function accrueYield(address wallet) external {
        _accrueYield(wallet);
    }

    /**
     * @notice Accrue all pending yield for every active registered partner.
     *         Used by the keeper bot (runs every 6 h).
     */
    function batchAccrueYield() external onlyRole(MANAGER_ROLE) {
        uint256 len = partnerWallets.length;
        for (uint256 i = 0; i < len; ) {
            address w = partnerWallets[i];
            if (stakes[w].isActive) {
                _accrueYield(w);
            }
            unchecked { ++i; }
        }
    }

    /**
     * @dev Core accrual logic.
     *      yield = balance × apyBps × timeElapsed / (10_000 × YEAR_SECONDS)
     *      Only accrues if balance ≥ minimumFloat.
     */
    function _accrueYield(address wallet) internal {
        PartnerStake storage s = stakes[wallet];
        if (s.stakedAt == 0) return; // unknown wallet — silently skip

        uint256 elapsed = block.timestamp - s.lastClaimAt;
        // Always advance the clock even if no yield earned (prevents double-counting)
        s.lastClaimAt = block.timestamp;

        if (!s.isActive || elapsed == 0) return;

        uint256 balance = xidrToken.balanceOf(wallet);
        if (balance < minimumFloat) return;

        // Integer yield: no floating point
        uint256 yield_ = (balance * apyBps * elapsed) / (10_000 * YEAR_SECONDS);

        if (yield_ == 0) return;

        s.accruedYield += yield_;
        emit YieldAccrued(wallet, yield_);
    }

    // ── Claiming ────────────────────────────────────────────────────────────────

    /**
     * @notice Caller (registered partner) collects their accrued XIDR yield.
     * @dev    Follows CEI strictly — accruedYield zeroed before transfer.
     *         No reentrancy guard needed; CEI prevents any re-entrancy exploit.
     */
    function claimYield() external whenNotPaused {
        PartnerStake storage s = stakes[msg.sender];
        if (s.stakedAt == 0) revert NotRegistered(msg.sender);

        _accrueYield(msg.sender);

        uint256 amount = s.accruedYield;
        if (amount == 0) return;

        uint256 available = xidrToken.balanceOf(address(this));
        if (available < amount) revert TreasuryUnderfunded(amount, available);

        s.accruedYield = 0;
        xidrToken.safeTransfer(msg.sender, amount);

        emit YieldClaimed(msg.sender, amount, block.timestamp);
    }

    // ── Treasury ────────────────────────────────────────────────────────────────

    /**
     * @notice TREASURY_ROLE deposits XIDR to fund future yield payouts.
     *         Caller must have approved this contract first.
     */
    function fundTreasury(uint256 amount) external onlyRole(TREASURY_ROLE) {
        if (amount == 0) revert ZeroAmount();
        xidrToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryFunded(amount, xidrToken.balanceOf(address(this)));
    }

    // ── Configuration ───────────────────────────────────────────────────────────

    /**
     * @notice Update the APY. Accrues ALL existing partners at the old rate first.
     * @dev    Max 20 % (2_000 bps) — reverts above this.
     */
    function setApy(uint256 newApyBps) external onlyRole(MANAGER_ROLE) {
        if (newApyBps > MAX_APY_BPS) revert ApyTooHigh(newApyBps, MAX_APY_BPS);

        // Accrue everyone at the old rate before switching
        uint256 len = partnerWallets.length;
        for (uint256 i = 0; i < len; ) {
            address w = partnerWallets[i];
            if (stakes[w].isActive) _accrueYield(w);
            unchecked { ++i; }
        }

        uint256 old = apyBps;
        apyBps = newApyBps;
        emit ApyUpdated(old, newApyBps);
    }

    /**
     * @notice Update the minimum XIDR float required to earn yield.
     */
    function setMinimumFloat(uint256 newMin) external onlyRole(MANAGER_ROLE) {
        uint256 old = minimumFloat;
        minimumFloat = newMin;
        emit MinimumFloatUpdated(old, newMin);
    }

    // ── Views ───────────────────────────────────────────────────────────────────

    /**
     * @notice Returns total XIDR yield claimable right now (accrued + pending).
     * @dev    Pure view — does not modify state.
     */
    function getClaimableYield(address wallet) external view returns (uint256) {
        PartnerStake storage s = stakes[wallet];
        if (s.stakedAt == 0 || !s.isActive) return s.accruedYield;

        uint256 elapsed = block.timestamp - s.lastClaimAt;
        uint256 balance = xidrToken.balanceOf(wallet);

        if (balance < minimumFloat || elapsed == 0) return s.accruedYield;

        uint256 pending = (balance * apyBps * elapsed) / (10_000 * YEAR_SECONDS);
        return s.accruedYield + pending;
    }

    /// @notice XIDR held in this contract available for yield payouts.
    function getTreasuryBalance() external view returns (uint256) {
        return xidrToken.balanceOf(address(this));
    }

    /// @notice Total number of registered partner wallets (active + deregistered).
    function getPartnerCount() external view returns (uint256) {
        return partnerWallets.length;
    }

    /**
     * @notice Returns stake info for all registered partners.
     * @dev    Restricted to MANAGER_ROLE — partner data is sensitive.
     */
    function getAllPartners()
        external
        view
        onlyRole(MANAGER_ROLE)
        returns (PartnerStake[] memory)
    {
        uint256 len = partnerWallets.length;
        PartnerStake[] memory result = new PartnerStake[](len);
        for (uint256 i = 0; i < len; ) {
            result[i] = stakes[partnerWallets[i]];
            unchecked { ++i; }
        }
        return result;
    }

    // ── Pausable ────────────────────────────────────────────────────────────────

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause();   }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── UUPS ────────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
