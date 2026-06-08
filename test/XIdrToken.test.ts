import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { XIdrToken } from "../typechain-types";

// ---- roles ----
const MINTER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const PAUSER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
const BLOCKLIST_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BLOCKLIST_ROLE"));
const DEFAULT_ADMIN  = ethers.ZeroHash;

const MINT_CAP = 1_000_000_000_000n;

// ---- fixture ----
async function deployFixture() {
  const [admin, minter, pauser, blockLister, alice, bob, carol] =
    await ethers.getSigners();

  const Factory = await ethers.getContractFactory("XIdrToken");
  const proxy = (await upgrades.deployProxy(
    Factory,
    [admin.address, minter.address, pauser.address, blockLister.address, MINT_CAP],
    { kind: "uups", initializer: "initialize" }
  )) as unknown as XIdrToken;
  await proxy.waitForDeployment();

  return { proxy, admin, minter, pauser, blockLister, alice, bob, carol };
}

// =============================================================================
describe("XIdrToken", function () {
  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------
  describe("Deployment", function () {
    it("has correct name and symbol", async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.name()).to.equal("StraitsX Indonesian Rupiah");
      expect(await proxy.symbol()).to.equal("XIDR");
    });

    it("has 0 decimals", async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(Number(await proxy.decimals())).to.equal(0);
    });

    it("starts with zero total supply", async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.totalSupply()).to.equal(0n);
    });

    it("sets mint cap correctly", async function () {
      const { proxy } = await loadFixture(deployFixture);
      expect(await proxy.mintCap()).to.equal(MINT_CAP);
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
      const { proxy, admin } = await loadFixture(deployFixture);
      expect(await proxy.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("grants MINTER_ROLE to minter", async function () {
      const { proxy, minter } = await loadFixture(deployFixture);
      expect(await proxy.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("grants PAUSER_ROLE to pauser", async function () {
      const { proxy, pauser } = await loadFixture(deployFixture);
      expect(await proxy.hasRole(PAUSER_ROLE, pauser.address)).to.be.true;
    });

    it("grants BLOCKLIST_ROLE to blockLister", async function () {
      const { proxy, blockLister } = await loadFixture(deployFixture);
      expect(await proxy.hasRole(BLOCKLIST_ROLE, blockLister.address)).to.be.true;
    });

    it("reverts initialize with zero address", async function () {
      const Factory = await ethers.getContractFactory("XIdrToken");
      await expect(
        upgrades.deployProxy(
          Factory,
          [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, MINT_CAP],
          { kind: "uups", initializer: "initialize" }
        )
      ).to.be.rejected;
    });
  });

  // ---------------------------------------------------------------------------
  // Minting
  // ---------------------------------------------------------------------------
  describe("Minting", function () {
    it("MINTER_ROLE can mint tokens", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      expect(await proxy.balanceOf(alice.address)).to.equal(1000n);
      expect(await proxy.totalSupply()).to.equal(1000n);
    });

    it("emits Mint event", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(minter).mint(alice.address, 500n))
        .to.emit(proxy, "Mint")
        .withArgs(alice.address, 500n);
    });

    it("non-minter cannot mint", async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(alice).mint(alice.address, 100n))
        .to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
    });

    it("reverts when minting above cap", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(minter).mint(alice.address, MINT_CAP + 1n))
        .to.be.revertedWithCustomError(proxy, "MintCapExceeded");
    });

    it("can mint exactly up to cap", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, MINT_CAP);
      expect(await proxy.totalSupply()).to.equal(MINT_CAP);
    });

    it("reverts second mint that would exceed cap", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, MINT_CAP);
      await expect(proxy.connect(minter).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(proxy, "MintCapExceeded");
    });
  });

  // ---------------------------------------------------------------------------
  // Burning / Redeem
  // ---------------------------------------------------------------------------
  describe("Burning / Redeem", function () {
    it("holder can burn via burn()", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(alice).burn(500n);
      expect(await proxy.balanceOf(alice.address)).to.equal(500n);
    });

    it("redeem() burns and emits Redeem event", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await expect(proxy.connect(alice).redeem(400n))
        .to.emit(proxy, "Redeem")
        .withArgs(alice.address, 400n);
      expect(await proxy.balanceOf(alice.address)).to.equal(600n);
    });

    it("cannot burn more than balance", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 100n);
      await expect(proxy.connect(alice).burn(101n)).to.be.reverted;
    });

    it("burnFrom works with allowance", async function () {
      const { proxy, minter, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(alice).approve(bob.address, 300n);
      await proxy.connect(bob).burnFrom(alice.address, 300n);
      expect(await proxy.balanceOf(alice.address)).to.equal(700n);
    });
  });

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------
  describe("Pause", function () {
    it("PAUSER_ROLE can pause", async function () {
      const { proxy, pauser } = await loadFixture(deployFixture);
      await proxy.connect(pauser).pause();
      expect(await proxy.paused()).to.be.true;
    });

    it("transfers revert when paused", async function () {
      const { proxy, minter, pauser, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(pauser).pause();
      await expect(proxy.connect(alice).transfer(bob.address, 100n))
        .to.be.revertedWithCustomError(proxy, "EnforcedPause");
    });

    it("minting reverts when paused", async function () {
      const { proxy, minter, pauser, alice } = await loadFixture(deployFixture);
      await proxy.connect(pauser).pause();
      await expect(proxy.connect(minter).mint(alice.address, 100n))
        .to.be.revertedWithCustomError(proxy, "EnforcedPause");
    });

    it("PAUSER_ROLE can unpause", async function () {
      const { proxy, minter, pauser, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(pauser).pause();
      await proxy.connect(pauser).unpause();
      await expect(proxy.connect(alice).transfer(bob.address, 100n)).to.not.be.reverted;
    });

    it("non-pauser cannot pause", async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(alice).pause())
        .to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // Blocklist
  // ---------------------------------------------------------------------------
  describe("Blocklist", function () {
    it("BLOCKLIST_ROLE can block an address", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await proxy.connect(blockLister).blockAddress(alice.address);
      expect(await proxy.blocked(alice.address)).to.be.true;
    });

    it("emits Blocked event", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(blockLister).blockAddress(alice.address))
        .to.emit(proxy, "Blocked")
        .withArgs(alice.address);
    });

    it("blocked sender cannot transfer", async function () {
      const { proxy, minter, blockLister, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await expect(proxy.connect(alice).transfer(bob.address, 100n))
        .to.be.revertedWithCustomError(proxy, "AddressBlocked");
    });

    it("blocked recipient cannot receive", async function () {
      const { proxy, minter, blockLister, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(blockLister).blockAddress(bob.address);
      await expect(proxy.connect(alice).transfer(bob.address, 100n))
        .to.be.revertedWithCustomError(proxy, "AddressBlocked");
    });

    it("minting to blocked address reverts", async function () {
      const { proxy, minter, blockLister, alice } = await loadFixture(deployFixture);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await expect(proxy.connect(minter).mint(alice.address, 100n))
        .to.be.revertedWithCustomError(proxy, "AddressBlocked");
    });

    it("BLOCKLIST_ROLE can unblock an address", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await proxy.connect(blockLister).unblockAddress(alice.address);
      expect(await proxy.blocked(alice.address)).to.be.false;
    });

    it("emits Unblocked event", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await expect(proxy.connect(blockLister).unblockAddress(alice.address))
        .to.emit(proxy, "Unblocked")
        .withArgs(alice.address);
    });

    it("unblocked address can transfer again", async function () {
      const { proxy, minter, blockLister, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await proxy.connect(blockLister).unblockAddress(alice.address);
      await expect(proxy.connect(alice).transfer(bob.address, 100n)).to.not.be.reverted;
    });

    it("reverts blocking already-blocked address", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await proxy.connect(blockLister).blockAddress(alice.address);
      await expect(proxy.connect(blockLister).blockAddress(alice.address))
        .to.be.revertedWithCustomError(proxy, "AlreadyBlocked");
    });

    it("reverts unblocking non-blocked address", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(blockLister).unblockAddress(alice.address))
        .to.be.revertedWithCustomError(proxy, "NotBlocked");
    });

    it("reverts blocking zero address", async function () {
      const { proxy, blockLister } = await loadFixture(deployFixture);
      await expect(proxy.connect(blockLister).blockAddress(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(proxy, "ZeroAddress");
    });

    it("non-blockLister cannot block", async function () {
      const { proxy, alice, bob } = await loadFixture(deployFixture);
      await expect(proxy.connect(alice).blockAddress(bob.address))
        .to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // Mint Cap
  // ---------------------------------------------------------------------------
  describe("Mint Cap", function () {
    it("admin can update mint cap", async function () {
      const { proxy, admin } = await loadFixture(deployFixture);
      await proxy.connect(admin).updateMintCap(2_000_000_000_000n);
      expect(await proxy.mintCap()).to.equal(2_000_000_000_000n);
    });

    it("emits MintCapUpdated event", async function () {
      const { proxy, admin } = await loadFixture(deployFixture);
      const newCap = 2_000_000_000_000n;
      await expect(proxy.connect(admin).updateMintCap(newCap))
        .to.emit(proxy, "MintCapUpdated")
        .withArgs(MINT_CAP, newCap);
    });

    it("non-admin cannot update mint cap", async function () {
      const { proxy, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(alice).updateMintCap(9999n))
        .to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
    });

    it("minting above new lower cap reverts", async function () {
      const { proxy, admin, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(admin).updateMintCap(500n);
      await expect(proxy.connect(minter).mint(alice.address, 501n))
        .to.be.revertedWithCustomError(proxy, "MintCapExceeded");
    });

    it("minting within new cap succeeds", async function () {
      const { proxy, admin, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(admin).updateMintCap(500n);
      await proxy.connect(minter).mint(alice.address, 500n);
      expect(await proxy.balanceOf(alice.address)).to.equal(500n);
    });
  });

  // ---------------------------------------------------------------------------
  // Upgrade
  // ---------------------------------------------------------------------------
  describe("Upgrade", function () {
    it("admin can upgrade implementation", async function () {
      const { proxy } = await loadFixture(deployFixture);
      const proxyAddress = await proxy.getAddress();

      const Factory = await ethers.getContractFactory("XIdrToken");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, { kind: "uups" });
      await upgraded.waitForDeployment();

      const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
      expect(newImpl).to.match(/^0x[0-9a-fA-F]{40}$/);
    });

    it("state is preserved after upgrade", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      const proxyAddress = await proxy.getAddress();

      await proxy.connect(minter).mint(alice.address, 12345n);

      const Factory = await ethers.getContractFactory("XIdrToken");
      const upgraded = (await upgrades.upgradeProxy(proxyAddress, Factory, {
        kind: "uups",
      })) as unknown as XIdrToken;
      await upgraded.waitForDeployment();

      expect(await upgraded.balanceOf(alice.address)).to.equal(12345n);
      expect(await upgraded.mintCap()).to.equal(MINT_CAP);
    });

    it("non-admin cannot upgrade", async function () {
      const { proxy, alice } = await loadFixture(deployFixture);

      const Factory = await ethers.getContractFactory("XIdrToken");
      const newImpl = await Factory.deploy();
      await newImpl.waitForDeployment();
      const newImplAddr = await newImpl.getAddress();

      await expect(proxy.connect(alice).upgradeToAndCall(newImplAddr, "0x"))
        .to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
    });
  });

  // ---------------------------------------------------------------------------
  // Transfers
  // ---------------------------------------------------------------------------
  describe("Transfers", function () {
    it("holder can transfer to another address", async function () {
      const { proxy, minter, alice, bob } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(alice).transfer(bob.address, 300n);
      expect(await proxy.balanceOf(alice.address)).to.equal(700n);
      expect(await proxy.balanceOf(bob.address)).to.equal(300n);
    });

    it("approve + transferFrom works", async function () {
      const { proxy, minter, alice, bob, carol } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await proxy.connect(alice).approve(bob.address, 200n);
      await proxy.connect(bob).transferFrom(alice.address, carol.address, 200n);
      expect(await proxy.balanceOf(carol.address)).to.equal(200n);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom Events
  // ---------------------------------------------------------------------------
  describe("Custom Events", function () {
    it("Mint event has correct args", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(minter).mint(alice.address, 999n))
        .to.emit(proxy, "Mint").withArgs(alice.address, 999n);
    });

    it("Redeem event has correct args", async function () {
      const { proxy, minter, alice } = await loadFixture(deployFixture);
      await proxy.connect(minter).mint(alice.address, 1000n);
      await expect(proxy.connect(alice).redeem(250n))
        .to.emit(proxy, "Redeem").withArgs(alice.address, 250n);
    });

    it("Blocked/Unblocked events have correct args", async function () {
      const { proxy, blockLister, alice } = await loadFixture(deployFixture);
      await expect(proxy.connect(blockLister).blockAddress(alice.address))
        .to.emit(proxy, "Blocked").withArgs(alice.address);
      await expect(proxy.connect(blockLister).unblockAddress(alice.address))
        .to.emit(proxy, "Unblocked").withArgs(alice.address);
    });

    it("MintCapUpdated event has correct old and new cap", async function () {
      const { proxy, admin } = await loadFixture(deployFixture);
      await expect(proxy.connect(admin).updateMintCap(999n))
        .to.emit(proxy, "MintCapUpdated").withArgs(MINT_CAP, 999n);
    });
  });
});
