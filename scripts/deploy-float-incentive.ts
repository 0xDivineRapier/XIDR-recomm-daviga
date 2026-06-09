/**
 * deploy-float-incentive.ts
 *
 * Deploys FloatIncentive as a UUPS proxy, initializes it, funds the treasury,
 * registers initial partner wallets, optionally verifies on Basescan, and
 * saves the address to deployments/<network>.json.
 *
 * Idempotent — if floatIncentive is already present in the deployments file,
 * the script prints the existing address and exits without redeploying.
 *
 * Usage
 * ─────
 *   npx hardhat run scripts/deploy-float-incentive.ts --network base-sepolia
 *   npx hardhat run scripts/deploy-float-incentive.ts --network base-mainnet
 *
 * Environment variables
 * ─────────────────────
 *   FLOAT_INCENTIVE_INITIAL_APY_BPS   default: 350   (3.5%)
 *   FLOAT_INCENTIVE_MIN_FLOAT         default: 10000000
 *   FLOAT_INCENTIVE_TREASURY_SEED     default: 10000000 (10M XIDR)
 *   INITIAL_PARTNER_WALLETS           comma-separated addresses, optional
 */
import { ethers, network, upgrades, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_MAP: Record<string, string> = {
  "base-mainnet": "base-mainnet.json",
  "base-sepolia": "base-sepolia.json",
};

async function main() {
  const net  = network.name;
  const file = DEPLOYMENTS_MAP[net];
  if (!file) throw new Error(`Unsupported network "${net}".`);

  const deploymentsDir  = path.join(__dirname, "..", "deployments");
  const deploymentsFile = path.join(deploymentsDir, file);

  if (!fs.existsSync(deploymentsFile)) {
    throw new Error(`${file} not found — deploy XIdrToken first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));
  const xidrAddress: string = deployment.proxy;
  if (!xidrAddress) throw new Error("No proxy address in deployments file.");

  // Idempotency guard
  if (deployment.floatIncentive?.proxy) {
    console.log(
      "FloatIncentive already deployed at:",
      deployment.floatIncentive.proxy
    );
    return;
  }

  const [deployer] = await ethers.getSigners();
  console.log("═══════════════════════════════════════════════════");
  console.log(" deploy-float-incentive.ts");
  console.log("═══════════════════════════════════════════════════");
  console.log("Network :", net);
  console.log("Deployer:", deployer.address);
  console.log("XIDR    :", xidrAddress);

  // ── Parameters ──────────────────────────────────────────────────────────
  const apyBps       = BigInt(process.env.FLOAT_INCENTIVE_INITIAL_APY_BPS ?? "350");
  const minFloat     = BigInt(process.env.FLOAT_INCENTIVE_MIN_FLOAT       ?? "10000000");
  const treasurySeed = BigInt(process.env.FLOAT_INCENTIVE_TREASURY_SEED   ?? "10000000");
  const partnerWallets: string[] = process.env.INITIAL_PARTNER_WALLETS
    ? process.env.INITIAL_PARTNER_WALLETS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  console.log("APY          :", apyBps.toString(), "bps =", (Number(apyBps) / 100).toFixed(2) + "%");
  console.log("Min float    :", minFloat.toString(), "XIDR");
  console.log("Treasury seed:", treasurySeed.toString(), "XIDR");
  console.log("Init partners:", partnerWallets.length ? partnerWallets.join(", ") : "(none)");

  // ── 1. Deploy proxy ──────────────────────────────────────────────────────
  console.log("\n[1/5] Deploying FloatIncentive proxy...");
  const FloatIncentive = await ethers.getContractFactory("FloatIncentive");
  const proxy = await upgrades.deployProxy(
    FloatIncentive,
    [xidrAddress, apyBps, minFloat, deployer.address],
    {
      kind:            "uups",
      initializer:     "initialize",
      redeployImplementation: "never",
    }
  );
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("      Proxy deployed at:", proxyAddress);

  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("      Implementation  :", implAddress);

  // ── 2. Fund treasury ─────────────────────────────────────────────────────
  console.log("\n[2/5] Funding treasury with", treasurySeed.toString(), "XIDR...");
  const xidr = new ethers.Contract(
    xidrAddress,
    [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address) external view returns (uint256)",
    ],
    deployer
  );

  const balance: bigint = await xidr.balanceOf(deployer.address);
  if (balance < treasurySeed) {
    console.warn(
      `WARNING: deployer XIDR balance (${balance}) < treasury seed (${treasurySeed}).`,
      "Skipping treasury fund. Fund manually via FloatIncentive.fundTreasury()."
    );
  } else {
    await (await xidr.approve(proxyAddress, treasurySeed)).wait();
    await (await (proxy as any).fundTreasury(treasurySeed)).wait();
    const treasuryBal: bigint = await (proxy as any).getTreasuryBalance();
    console.log("      Treasury balance:", treasuryBal.toString(), "XIDR");
  }

  // ── 3. Register initial partners ─────────────────────────────────────────
  if (partnerWallets.length > 0) {
    console.log("\n[3/5] Registering", partnerWallets.length, "partner(s)...");
    for (const wallet of partnerWallets) {
      try {
        await (await (proxy as any).registerPartner(wallet)).wait();
        console.log("      ✓ Registered:", wallet);
      } catch (err: any) {
        console.warn("      ⚠ Skipped (may already be registered):", wallet, "—", err.message);
      }
    }
  } else {
    console.log("\n[3/5] No initial partners to register.");
  }

  // ── 4. Verify on Basescan ─────────────────────────────────────────────────
  if (net !== "hardhat" && net !== "localhost") {
    console.log("\n[4/5] Verifying on Basescan (implementation)...");
    try {
      await run("verify:verify", {
        address:              implAddress,
        constructorArguments: [],
      });
      console.log("      Verification submitted.");
    } catch (err: any) {
      console.warn("      Verification skipped/failed:", err.message.slice(0, 120));
    }
  } else {
    console.log("\n[4/5] Skipping Basescan verification (local network).");
  }

  // ── 5. Save to deployments ────────────────────────────────────────────────
  console.log("\n[5/5] Saving deployments...");
  deployment.floatIncentive = {
    proxy:          proxyAddress,
    implementation: implAddress,
    apyBps:         apyBps.toString(),
    minFloat:       minFloat.toString(),
    treasurySeed:   treasurySeed.toString(),
    registeredPartners: partnerWallets,
    deployedAt:     new Date().toISOString(),
  };
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployment, null, 2));
  console.log("Deployments saved →", deploymentsFile);

  console.log("\n✅ FloatIncentive deployment complete!");
  console.log("   Proxy:", proxyAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
