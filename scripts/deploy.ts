/**
 * Deploy XIdrToken to Base Sepolia testnet.
 * Usage: hardhat run scripts/deploy.ts --network base-sepolia
 *
 * Idempotent: if deployments/base-sepolia.json already exists and the proxy
 * address is live on-chain, the script exits without redeploying.
 */
import { ethers, upgrades, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, "base-sepolia.json");

const INITIAL_MINT_CAP = 1_000_000_000_000n; // 1 trillion XIDR

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const admin      = process.env.ADMIN_ADDRESS   ?? deployer.address;
  const minter     = process.env.MINTER_ADDRESS  ?? deployer.address;
  const pauser     = process.env.PAUSER_ADDRESS  ?? deployer.address;
  const blockLister = process.env.BLOCKLIST_ADDRESS ?? deployer.address;

  // --- idempotency check ---
  if (fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    const code = await ethers.provider.getCode(existing.proxy);
    if (code !== "0x") {
      console.log("Proxy already deployed at", existing.proxy, "— skipping.");
      return;
    }
  }

  console.log("Deploying XIdrToken proxy...");
  const Factory = await ethers.getContractFactory("XIdrToken");
  const proxy = await upgrades.deployProxy(
    Factory,
    [admin, minter, pauser, blockLister, INITIAL_MINT_CAP],
    { kind: "uups", initializer: "initialize" }
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress  = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("Proxy deployed at:         ", proxyAddress);
  console.log("Implementation deployed at:", implAddress);

  // --- persist addresses ---
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const output = {
    network: "base-sepolia",
    chainId: 84532,
    proxy: proxyAddress,
    implementation: implAddress,
    admin,
    minter,
    pauser,
    blockLister,
    mintCap: INITIAL_MINT_CAP.toString(),
    deployedAt: new Date().toISOString(),
    deployerTx: proxy.deploymentTransaction()?.hash ?? "",
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log("Addresses saved to", OUTPUT_FILE);

  // --- verify on Basescan ---
  console.log("Waiting for confirmations before verifying...");
  await proxy.deploymentTransaction()?.wait(5);

  try {
    await run("verify:verify", { address: implAddress, constructorArguments: [] });
    console.log("Implementation verified on Basescan.");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Already Verified")) {
      console.log("Already verified.");
    } else {
      console.warn("Verification failed:", msg);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
