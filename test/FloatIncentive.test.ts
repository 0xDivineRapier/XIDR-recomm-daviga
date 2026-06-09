import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { XIdrToken, FloatIncentive } from "../typechain-types";

// ── Fixture ───────────────────────────────────────────────────────────────────
async function deployFixture() {
  const [admin, manager, treasury, partner1, partner2, stranger] =
    await ethers.getSigners();

  // Deploy XIDR token (proxy)
  const XIdrFactory = await ethers.getContractFactory("XIdrToken");
  const xidr = (await upgrades.deployProxy(
    XIdrFactory,
    [admin.address, admin.address, admin.address, admin.address, 1_000_000_000n],
    { kind: "uups" }
  )) as unknown as XIdrToken;

  // Deploy FloatIncentive (proxy)
  const FIFactory = await ethers.getContractFactory("FloatIncentive");
  const fi = (await upgrades.deployProxy(
    FIFactory,
    [await xidr.getAddress(), 350, 10_000_000n, admin.address],
    { kind: "uups" }
  )) as unknown as FloatIncentive;

  const xidrAddress = await xidr.getAddress();
  const fiAddress   = await fi.getAddress();

  // Grant MINTER_ROLE to admin (already done in XIdrToken.initialize)
  // Mint XIDR to admin, treasury, and partners
  const MINTER_ROLE = await xidr.MINTER_ROLE();
  await xidr.connect(admin).mint(admin.address,    100_000_000n);
  await xidr.connect(admin).mint(partner1.address,  50_000_000n);
  await xidr.connect(admin).mint(partner2.address,  50_000_000n);

  // Fund treasury: admin approves fi then fundTreasury
  await xidr.connect(admin).approve(fiAddress, 20_000_000n);
  await fi.connect(admin).fundTreasury(20_000_000n);

  return { xidr, fi, admin, manager, treasury, partner1, partner2, stranger, xidrAddress, fiAddress };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("FloatIncentive", () => {

  // ── Deployment ──────────────────────────────────────────────────────────────
  describe("Deployment", () => {
    it("initialises with correct apyBps and minimumFloat", async () => {
      const { fi } = await loadFixture(deployFixture);
      expect(await fi.apyBps()).to.equal(350n);
      expect(await fi.minimumFloat()).to.equal(10_000_000n);
    });

    it("admin holds DEFAULT_ADMIN_ROLE, MANAGER_ROLE, TREASURY_ROLE", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      const ADMIN   = await fi.DEFAULT_ADMIN_ROLE();
      const MANAGER = await fi.MANAGER_ROLE();
      const TREAS   = await fi.TREASURY_ROLE();
      expect(await fi.hasRole(ADMIN,   admin.address)).to.be.true;
      expect(await fi.hasRole(MANAGER, admin.address)).to.be.true;
      expect(await fi.hasRole(TREAS,   admin.address)).to.be.true;
    });

    it("xidrToken is set correctly", async () => {
      const { fi, xidrAddress } = await loadFixture(deployFixture);
      expect(await fi.xidrToken()).to.equal(xidrAddress);
    });

    it("MAX_APY_BPS is 2000", async () => {
      const { fi } = await loadFixture(deployFixture);
      expect(await fi.MAX_APY_BPS()).to.equal(2000n);
    });
  });

  // ── Partner management ──────────────────────────────────────────────────────
  describe("Partner management", () => {
    it("registerPartner: adds stake and emits PartnerRegistered", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      const tx = await fi.connect(admin).registerPartner(partner1.address);
      await expect(tx)
        .to.emit(fi, "PartnerRegistered")
        .withArgs(partner1.address, await time.latest());

      const stake = await fi.stakes(partner1.address);
      expect(stake.isActive).to.be.true;
      expect(stake.wallet).to.equal(partner1.address);
    });

    it("registerPartner: reverts if already registered", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await expect(fi.connect(admin).registerPartner(partner1.address))
        .to.be.revertedWithCustomError(fi, "AlreadyRegistered")
        .withArgs(partner1.address);
    });

    it("registerPartner: reverts if caller lacks MANAGER_ROLE", async () => {
      const { fi, stranger, partner1 } = await loadFixture(deployFixture);
      await expect(fi.connect(stranger).registerPartner(partner1.address))
        .to.be.revertedWithCustomError(fi, "AccessControlUnauthorizedAccount");
    });

    it("deregisterPartner: sets isActive=false and emits PartnerDeregistered", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      const tx = await fi.connect(admin).deregisterPartner(partner1.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      await expect(tx)
        .to.emit(fi, "PartnerDeregistered")
        .withArgs(partner1.address, block!.timestamp);

      const stake = await fi.stakes(partner1.address);
      expect(stake.isActive).to.be.false;
    });

    it("deregisterPartner: reverts if not registered", async () => {
      const { fi, admin, stranger } = await loadFixture(deployFixture);
      await expect(fi.connect(admin).deregisterPartner(stranger.address))
        .to.be.revertedWithCustomError(fi, "NotRegistered")
        .withArgs(stranger.address);
    });

    it("deregisterPartner: accrues pending yield before deregistering", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      // Advance 30 days
      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).deregisterPartner(partner1.address);

      const stake = await fi.stakes(partner1.address);
      // Should have non-zero accruedYield (partner1 holds 50M XIDR > minimumFloat 10M)
      expect(stake.accruedYield).to.be.gt(0n);
    });

    it("partner can still claimYield after deregistration", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(365 * 24 * 3600); // 1 year
      await fi.connect(admin).deregisterPartner(partner1.address);

      const stake = await fi.stakes(partner1.address);
      const accrued = stake.accruedYield;
      expect(accrued).to.be.gt(0n);

      await expect(fi.connect(partner1).claimYield())
        .to.emit(fi, "YieldClaimed");
    });

    it("getPartnerCount returns correct count", async () => {
      const { fi, admin, partner1, partner2 } = await loadFixture(deployFixture);
      expect(await fi.getPartnerCount()).to.equal(0n);
      await fi.connect(admin).registerPartner(partner1.address);
      await fi.connect(admin).registerPartner(partner2.address);
      expect(await fi.getPartnerCount()).to.equal(2n);
    });
  });

  // ── Yield accrual ───────────────────────────────────────────────────────────
  describe("Yield accrual", () => {
    it("partner with balance > minimumFloat accrues yield over time", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      await time.increase(365 * 24 * 3600); // 1 year
      await fi.accrueYield(partner1.address);

      const stake = await fi.stakes(partner1.address);
      // 50M * 350 bps / 10000 = 50M * 3.5% = 1,750,000 XIDR/year
      expect(stake.accruedYield).to.be.closeTo(1_750_000n, 100n);
    });

    it("partner with balance < minimumFloat accrues zero yield", async () => {
      const { fi, admin, xidr, partner2 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner2.address);

      // Burn partner2's balance down below minimumFloat (keep 5M < 10M minimum)
      const balance = await xidr.balanceOf(partner2.address);
      await xidr.connect(partner2).burn(balance - 5_000_000n);

      await time.increase(365 * 24 * 3600);
      await fi.accrueYield(partner2.address);

      const stake = await fi.stakes(partner2.address);
      expect(stake.accruedYield).to.equal(0n);
    });

    it("yield calculation is correct: balance * apyBps * elapsed / (10000 * 365days)", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      const ELAPSED = 30n * 24n * 3600n; // 30 days in seconds
      await time.increase(Number(ELAPSED));
      await fi.accrueYield(partner1.address);

      const stake = await fi.stakes(partner1.address);
      const YEAR = 365n * 24n * 3600n;
      const expected = (50_000_000n * 350n * ELAPSED) / (10_000n * YEAR);
      expect(stake.accruedYield).to.be.closeTo(expected, 5n);
    });

    it("getClaimableYield returns accrued + pending (view — no state change)", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      await time.increase(180 * 24 * 3600); // 6 months

      const claimable = await fi.getClaimableYield(partner1.address);
      expect(claimable).to.be.gt(0n);

      // State should NOT change (it's a view)
      const stakeBefore = await fi.stakes(partner1.address);
      expect(stakeBefore.accruedYield).to.equal(0n); // not yet written
    });

    it("batchAccrueYield accrues all active partners", async () => {
      const { fi, admin, partner1, partner2 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await fi.connect(admin).registerPartner(partner2.address);

      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).batchAccrueYield();

      const s1 = await fi.stakes(partner1.address);
      const s2 = await fi.stakes(partner2.address);
      expect(s1.accruedYield).to.be.gt(0n);
      expect(s2.accruedYield).to.be.gt(0n);
    });

    it("batchAccrueYield skips deregistered partners", async () => {
      const { fi, admin, partner1, partner2 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await fi.connect(admin).registerPartner(partner2.address);

      // Advance and accrueYield once to set initial state
      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).batchAccrueYield();

      // Deregister partner2
      await fi.connect(admin).deregisterPartner(partner2.address);
      const s2Before = await fi.stakes(partner2.address);

      // More time — partner2 should NOT accrue further
      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).batchAccrueYield();

      const s2After = await fi.stakes(partner2.address);
      expect(s2After.accruedYield).to.equal(s2Before.accruedYield);
    });
  });

  // ── Claiming ─────────────────────────────────────────────────────────────────
  describe("Claiming", () => {
    it("claimYield transfers correct amount to partner", async () => {
      const { fi, xidr, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(365 * 24 * 3600);

      const claimable = await fi.getClaimableYield(partner1.address);
      const balBefore = await xidr.balanceOf(partner1.address);

      await fi.connect(partner1).claimYield();

      const balAfter = await xidr.balanceOf(partner1.address);
      expect(balAfter - balBefore).to.be.closeTo(claimable, 1000n);
    });

    it("claimYield resets accruedYield to 0", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(30 * 24 * 3600);

      await fi.connect(partner1).claimYield();

      const stake = await fi.stakes(partner1.address);
      expect(stake.accruedYield).to.equal(0n);
    });

    it("claimYield emits YieldClaimed with correct args", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(30 * 24 * 3600);
      await fi.accrueYield(partner1.address);

      const stake = await fi.stakes(partner1.address);
      const accrued = stake.accruedYield;

      await expect(fi.connect(partner1).claimYield())
        .to.emit(fi, "YieldClaimed")
        .withArgs(partner1.address, accrued, await time.latest() + 1);
    });

    it("claimYield reverts with TreasuryUnderfunded when contract balance < yield", async () => {
      const { fi, xidr, admin, partner1, fiAddress } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);

      // Drain treasury
      const treasuryBal = await xidr.balanceOf(fiAddress);
      // Need a fresh contract with no treasury funded
      const FIFactory = await ethers.getContractFactory("FloatIncentive");
      const fi2 = (await upgrades.deployProxy(
        FIFactory,
        [await xidr.getAddress(), 350, 10_000_000n, admin.address],
        { kind: "uups" }
      )) as unknown as FloatIncentive;

      await fi2.connect(admin).registerPartner(partner1.address);
      await time.increase(365 * 24 * 3600);

      await expect(fi2.connect(partner1).claimYield())
        .to.be.revertedWithCustomError(fi2, "TreasuryUnderfunded");
    });

    it("claimYield reverts for unregistered wallet", async () => {
      const { fi, stranger } = await loadFixture(deployFixture);
      await expect(fi.connect(stranger).claimYield())
        .to.be.revertedWithCustomError(fi, "NotRegistered")
        .withArgs(stranger.address);
    });

    it("claimYield reverts when paused", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).pause();

      await expect(fi.connect(partner1).claimYield())
        .to.be.revertedWithCustomError(fi, "EnforcedPause");
    });

    it("claimYield works again after unpause", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(30 * 24 * 3600);
      await fi.connect(admin).pause();
      await fi.connect(admin).unpause();

      await expect(fi.connect(partner1).claimYield()).to.not.be.reverted;
    });
  });

  // ── APY management ───────────────────────────────────────────────────────────
  describe("APY management", () => {
    it("setApy: accrues existing partners at old rate before updating", async () => {
      const { fi, admin, partner1 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await time.increase(365 * 24 * 3600);

      const claimableBefore = await fi.getClaimableYield(partner1.address);

      await fi.connect(admin).setApy(700); // double APY

      // Accrued yield locked in at old rate
      const stake = await fi.stakes(partner1.address);
      expect(stake.accruedYield).to.be.closeTo(claimableBefore, 1000n);
      expect(await fi.apyBps()).to.equal(700n);
    });

    it("setApy above 2000 bps reverts", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      await expect(fi.connect(admin).setApy(2001))
        .to.be.revertedWithCustomError(fi, "ApyTooHigh")
        .withArgs(2001n, 2000n);
    });

    it("setApy emits ApyUpdated", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      await expect(fi.connect(admin).setApy(500))
        .to.emit(fi, "ApyUpdated")
        .withArgs(350n, 500n);
    });

    it("setApy reverts if caller lacks MANAGER_ROLE", async () => {
      const { fi, stranger } = await loadFixture(deployFixture);
      await expect(fi.connect(stranger).setApy(200))
        .to.be.revertedWithCustomError(fi, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Treasury ─────────────────────────────────────────────────────────────────
  describe("Treasury", () => {
    it("fundTreasury: increases contract XIDR balance and emits TreasuryFunded", async () => {
      const { fi, xidr, admin, fiAddress } = await loadFixture(deployFixture);
      const balBefore = await xidr.balanceOf(fiAddress);

      await xidr.connect(admin).approve(fiAddress, 5_000_000n);
      await expect(fi.connect(admin).fundTreasury(5_000_000n))
        .to.emit(fi, "TreasuryFunded")
        .withArgs(5_000_000n, balBefore + 5_000_000n);

      expect(await fi.getTreasuryBalance()).to.equal(balBefore + 5_000_000n);
    });

    it("fundTreasury reverts with ZeroAmount", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      await expect(fi.connect(admin).fundTreasury(0n))
        .to.be.revertedWithCustomError(fi, "ZeroAmount");
    });

    it("getTreasuryBalance reflects contract XIDR balance", async () => {
      const { fi, xidr, fiAddress } = await loadFixture(deployFixture);
      const contractBal = await xidr.balanceOf(fiAddress);
      expect(await fi.getTreasuryBalance()).to.equal(contractBal);
    });
  });

  // ── Minimum float ────────────────────────────────────────────────────────────
  describe("Minimum float", () => {
    it("setMinimumFloat updates value and emits event", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      await expect(fi.connect(admin).setMinimumFloat(20_000_000n))
        .to.emit(fi, "MinimumFloatUpdated")
        .withArgs(10_000_000n, 20_000_000n);
      expect(await fi.minimumFloat()).to.equal(20_000_000n);
    });
  });

  // ── getAllPartners ────────────────────────────────────────────────────────────
  describe("getAllPartners", () => {
    it("returns full stakes array for MANAGER_ROLE", async () => {
      const { fi, admin, partner1, partner2 } = await loadFixture(deployFixture);
      await fi.connect(admin).registerPartner(partner1.address);
      await fi.connect(admin).registerPartner(partner2.address);

      const all = await fi.connect(admin).getAllPartners();
      expect(all.length).to.equal(2);
      expect(all[0].wallet).to.equal(partner1.address);
    });

    it("reverts for non-manager", async () => {
      const { fi, stranger } = await loadFixture(deployFixture);
      await expect(fi.connect(stranger).getAllPartners())
        .to.be.revertedWithCustomError(fi, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Upgrade ──────────────────────────────────────────────────────────────────
  describe("Upgrade", () => {
    it("admin can upgrade implementation", async () => {
      const { fi, admin } = await loadFixture(deployFixture);
      const FIFactory2 = await ethers.getContractFactory("FloatIncentive", admin);
      // upgradeProxy verifies _authorizeUpgrade — should not revert
      const upgraded = await upgrades.upgradeProxy(await fi.getAddress(), FIFactory2);
      // State preserved
      expect(await upgraded.apyBps()).to.equal(350n);
    });

    it("non-admin cannot upgrade implementation", async () => {
      const { fi, stranger } = await loadFixture(deployFixture);
      const FIFactory2 = await ethers.getContractFactory("FloatIncentive", stranger);
      await expect(
        upgrades.upgradeProxy(await fi.getAddress(), FIFactory2)
      ).to.be.revertedWithCustomError(fi, "AccessControlUnauthorizedAccount");
    });
  });
});
