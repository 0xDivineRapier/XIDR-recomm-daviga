/**
 * Upgrade XIdrToken implementation via UUPS proxy.
 * Usage: hardhat run scripts/upgrade.ts --network base-sepolia
 *        hardhat run scripts/upgrade.ts --network base-mainnet
 *
 * Reads the proxy address from the appropriate deployments JSON file.
 * Updates the file with the new implementation address after upgrade.
 */
import { ethers, upgrades, run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");

function deploymentsFile(): string {
  if (network.name === "base-mainnet") return path.join(DEPLOYMENTS_DIR, "base-mainnet.json");
  if (network.name === "base-sepolia") return path.join(DEPLOYMENTS_DIR, "base-sepolia.json");
  throw new Error(`No deployments file configured for network: ${network.name}`);
}

async function main() {
  const file = deploymentsFile();
  if (!fs.existsSync(file)) {
    throw new Error(`Deployments file not found: ${file}. Deploy first.`);
  }

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const proxyAddress: string = deployment.proxy;
  console.log("Upgrading proxy at:", proxyAddress);

  const Factory = await ethers.getContractFactory("XIdrToken");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory, { kind: "uups" });
  await upgraded.waitForDeployment();

  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("New implementation:", newImpl);

  deployment.implementation = newImpl;
  deployment.upgradedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log("Deployment file updated.");

  // Wait and verify
  const tx = upgraded.deploymentTransaction();
  if (tx) await tx.wait(5);

  try {
    await run("verify:verify", { address: newImpl, constructorArguments: [] });
    console.log("New implementation verified on Basescan.");
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
