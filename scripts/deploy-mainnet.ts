/**
 * Deploy XIdrToken to Base Mainnet.
 * Usage: hardhat run scripts/deploy-mainnet.ts --network base-mainnet
 *
 * Prompts for explicit confirmation before broadcasting to mainnet.
 * Idempotent: exits without redeploying if proxy already exists on-chain.
 */
import { ethers, upgrades, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, "base-mainnet.json");

const INITIAL_MINT_CAP = 1_000_000_000_000n;

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(balance), "ETH");
  console.log("Network:  Base Mainnet (chainId 8453)");

  // --- idempotency check ---
  if (fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    const code = await ethers.provider.getCode(existing.proxy);
    if (code !== "0x") {
      console.log("Proxy already deployed at", existing.proxy, "— skipping.");
      return;
    }
  }

  const ok = await confirm(
    "\n⚠️  You are about to deploy to BASE MAINNET. Type 'yes' to proceed: "
  );
  if (!ok) {
    console.log("Deployment cancelled.");
    return;
  }

  const admin       = process.env.ADMIN_ADDRESS      ?? deployer.address;
  const minter      = process.env.MINTER_ADDRESS     ?? deployer.address;
  const pauser      = process.env.PAUSER_ADDRESS     ?? deployer.address;
  const blockLister = process.env.BLOCKLIST_ADDRESS  ?? deployer.address;

  console.log("\nDeploying XIdrToken proxy to Base Mainnet...");
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

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const output = {
    network: "base-mainnet",
    chainId: 8453,
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
