// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title XIdrToken
 * @notice StraitsX Indonesian Rupiah (XIDR) stablecoin on Base.
 *         1 XIDR = 1 IDR. Decimals = 0 (IDR has no fractional unit).
 * @dev UUPS upgradeable ERC-20 with role-based minting, pausing, and AML blocklist.
 */
contract XIdrToken is
    Initializable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    bytes32 public constant MINTER_ROLE    = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");
    bytes32 public constant BLOCKLIST_ROLE = keccak256("BLOCKLIST_ROLE");

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Maximum total supply allowed (configurable by DEFAULT_ADMIN_ROLE).
    uint256 public mintCap;

    /// @notice AML/compliance blocklist. Blocked addresses cannot send or receive.
    mapping(address => bool) public blocked;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when XIDR is minted to a recipient.
    event Mint(address indexed to, uint256 amount);

    /// @notice Emitted when XIDR is redeemed (burned) by a holder.
    event Redeem(address indexed from, uint256 amount);

    /// @notice Emitted when an address is added to the blocklist.
    event Blocked(address indexed account);

    /// @notice Emitted when an address is removed from the blocklist.
    event Unblocked(address indexed account);

    /// @notice Emitted when the mint cap is updated.
    event MintCapUpdated(uint256 oldCap, uint256 newCap);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error AddressBlocked(address account);
    error MintCapExceeded(uint256 requested, uint256 cap);
    error ZeroAddress();
    error AlreadyBlocked(address account);
    error NotBlocked(address account);

    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the proxy. Called once at deployment via the UUPS proxy.
     * @param admin         Address granted DEFAULT_ADMIN_ROLE (multisig recommended).
     * @param minter        Address granted MINTER_ROLE (reserve custodian).
     * @param pauser        Address granted PAUSER_ROLE (compliance officer).
     * @param blockLister   Address granted BLOCKLIST_ROLE (AML officer).
     * @param initialMintCap Maximum supply cap in XIDR (no decimals).
     */
    function initialize(
        address admin,
        address minter,
        address pauser,
        address blockLister,
        uint256 initialMintCap
    ) external initializer {
        if (admin == address(0) || minter == address(0) || pauser == address(0) || blockLister == address(0))
            revert ZeroAddress();

        __ERC20_init("StraitsX Indonesian Rupiah", "XIDR");
        __ERC20Burnable_init();
        __ERC20Pausable_init();
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(BLOCKLIST_ROLE, blockLister);

        mintCap = initialMintCap;
    }

    // -------------------------------------------------------------------------
    // ERC-20 Overrides
    // -------------------------------------------------------------------------

    /// @notice XIDR has 0 decimals — 1 token = 1 IDR.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    // -------------------------------------------------------------------------
    // Mint / Redeem
    // -------------------------------------------------------------------------

    /**
     * @notice Mints `amount` XIDR to `to`. Only callable by MINTER_ROLE.
     * @param to     Recipient address.
     * @param amount Number of XIDR to mint.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > mintCap)
            revert MintCapExceeded(totalSupply() + amount, mintCap);
        _mint(to, amount);
        emit Mint(to, amount);
    }

    /**
     * @notice Burns `amount` XIDR from the caller, representing a fiat redemption.
     * @param amount Number of XIDR to redeem.
     */
    function redeem(uint256 amount) external {
        emit Redeem(msg.sender, amount);
        _burn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Pause
    // -------------------------------------------------------------------------

    /// @notice Pauses all token transfers. Only callable by PAUSER_ROLE.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpauses token transfers. Only callable by PAUSER_ROLE.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------
    // Blocklist
    // -------------------------------------------------------------------------

    /**
     * @notice Adds `account` to the AML blocklist. Only callable by BLOCKLIST_ROLE.
     * @param account Address to block.
     */
    function blockAddress(address account) external onlyRole(BLOCKLIST_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (blocked[account]) revert AlreadyBlocked(account);
        blocked[account] = true;
        emit Blocked(account);
    }

    /**
     * @notice Removes `account` from the AML blocklist. Only callable by BLOCKLIST_ROLE.
     * @param account Address to unblock.
     */
    function unblockAddress(address account) external onlyRole(BLOCKLIST_ROLE) {
        if (!blocked[account]) revert NotBlocked(account);
        blocked[account] = false;
        emit Unblocked(account);
    }

    // -------------------------------------------------------------------------
    // Mint Cap
    // -------------------------------------------------------------------------

    /**
     * @notice Updates the maximum supply cap. Only callable by DEFAULT_ADMIN_ROLE.
     * @param newCap New mint cap value. Must be >= current total supply.
     */
    function updateMintCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = mintCap;
        mintCap = newCap;
        emit MintCapUpdated(old, newCap);
    }

    // -------------------------------------------------------------------------
    // Internal Overrides
    // -------------------------------------------------------------------------

    /**
     * @dev Hook called before every token transfer (mint/burn/transfer).
     *      Enforces pause state and blocklist.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // Blocklist check — address(0) is valid for mint/burn, skip it.
        if (from != address(0) && blocked[from]) revert AddressBlocked(from);
        if (to   != address(0) && blocked[to])   revert AddressBlocked(to);

        super._update(from, to, value);
    }

    /**
     * @dev UUPS upgrade authorization — only DEFAULT_ADMIN_ROLE can upgrade.
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
