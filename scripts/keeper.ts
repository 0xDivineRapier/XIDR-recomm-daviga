/**
 * keeper.ts — Automated maintenance bot for XIDR liquidity infrastructure.
 *
 * Runs on a cron schedule (default: every 6 hours) and:
 *   1. batchAccrueYield — accrues yield for all active FloatIncentive partners
 *   2. Treasury health check — alerts if FloatIncentive treasury < ALERT_THRESHOLD
 *   3. Collect LP fees — sweeps accumulated Uniswap v3 fees to the signer wallet
 *
 * Usage
 * ─────
 *   # Run once (then schedule via cron/systemd/pm2):
 *   npx hardhat run scripts/keeper.ts --network base-sepolia
 *   npx hardhat run scripts/keeper.ts --network base-mainnet
 *
 *   # Example crontab (every 6 hours):
 *   0 */6 * * * cd /path/to/xidr-base && \
 *     npx hardhat run scripts/keeper.ts --network base-sepolia >> /var/log/keeper.log 2>&1
 *
 * Environment variables
 * ─────────────────────
 *   KEEPER_TREASURY_ALERT_THRESHOLD   default: 1000000  (1M XIDR)
 *   KEEPER_ALERT_EMAIL                optional — printed in alert messages
 *   KEEPER_SKIP_FEES                  set to "true" to skip fee collection
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Network config ────────────────────────────────────────────────────────────
const NETWORK_CONFIG: Record<string, {
  positionManager: string;
  deploymentsFile: string;
}> = {
  "base-mainnet": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    deploymentsFile: "base-mainnet.json",
  },
  "base-sepolia": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    deploymentsFile: "base-sepolia.json",
  },
};

const ALERT_THRESHOLD = BigInt(process.env.KEEPER_TREASURY_ALERT_THRESHOLD ?? "1000000");
const ALERT_EMAIL     = process.env.KEEPER_ALERT_EMAIL ?? "";
const SKIP_FEES       = process.env.KEEPER_SKIP_FEES === "true";

// ── ABIs ──────────────────────────────────────────────────────────────────────
const FLOAT_INCENTIVE_ABI = [
  "function batchAccrueYield() external",
  "function getTreasuryBalance() external view returns (uint256)",
  "function getPartnerCount() external view returns (uint256)",
  "function apyBps() external view returns (uint256)",
];

const NPM_ABI = [
  `function collect(tuple(
    uint256 tokenId,
    address recipient,
    uint128 amount0Max,
    uint128 amount1Max
  ) params) external payable returns (uint256 amount0, uint256 amount1)`,
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(level: "INFO" | "WARN" | "ERROR", msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

function alert(msg: string) {
  log("WARN", `ALERT: ${msg}${ALERT_EMAIL ? ` (notify: ${ALERT_EMAIL})` : ""}`);
  // In production, replace with: sendEmail(ALERT_EMAIL, subject, msg)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const net = network.name;
  const cfg = NETWORK_CONFIG[net];
  if (!cfg) throw new Error(`Unsupported network "${net}".`);

  const deploymentsFile = path.join(__dirname, "..", "deployments", cfg.deploymentsFile);
  if (!fs.existsSync(deploymentsFile)) {
    throw new Error(`${cfg.deploymentsFile} not found.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));

  const floatIncentiveAddr: string | undefined = deployment.floatIncentive?.proxy;
  const poolTokenId: string | undefined        = deployment.pool?.tokenId;

  const [keeper] = await ethers.getSigners();

  log("INFO", `Keeper starting — network: ${net}, keeper: ${keeper.address}`);
  log("INFO", `FloatIncentive: ${floatIncentiveAddr ?? "(not deployed)"}`);
  log("INFO", `Pool tokenId: ${poolTokenId ?? "(not seeded)"}`);

  let anyFailure = false;

  // ── Task 1: Batch accrue yield ───────────────────────────────────────────
  if (floatIncentiveAddr) {
    log("INFO", "Task 1/3: batchAccrueYield...");
    try {
      const fi = new ethers.Contract(floatIncentiveAddr, FLOAT_INCENTIVE_ABI, keeper);
      const partnerCount: bigint = await fi.getPartnerCount();
      const apyBps:       bigint = await fi.apyBps();

      log("INFO", `  Partners registered: ${partnerCount}, APY: ${apyBps} bps`);

      if (partnerCount > 0n) {
        const tx = await fi.batchAccrueYield();
        const receipt = await tx.wait();
        log("INFO", `  batchAccrueYield OK. Gas used: ${receipt.gasUsed.toString()}`);
      } else {
        log("INFO", "  No partners registered — skipping accrual.");
      }
    } catch (err: any) {
      log("ERROR", `  batchAccrueYield failed: ${err.message}`);
      anyFailure = true;
    }
  } else {
    log("INFO", "Task 1/3: FloatIncentive not deployed — skipping yield accrual.");
  }

  // ── Task 2: Treasury health check ────────────────────────────────────────
  if (floatIncentiveAddr) {
    log("INFO", "Task 2/3: Treasury health check...");
    try {
      const fi = new ethers.Contract(floatIncentiveAddr, FLOAT_INCENTIVE_ABI, keeper);
      const treasury: bigint = await fi.getTreasuryBalance();
      log("INFO", `  Treasury balance: ${treasury.toString()} XIDR`);

      if (treasury < ALERT_THRESHOLD) {
        alert(
          `FloatIncentive treasury LOW: ${treasury.toString()} XIDR < threshold ${ALERT_THRESHOLD.toString()} XIDR. ` +
          `Fund via FloatIncentive.fundTreasury() before partners cannot claim.`
        );
      } else {
        log("INFO", `  Treasury OK (threshold: ${ALERT_THRESHOLD.toString()} XIDR).`);
      }
    } catch (err: any) {
      log("ERROR", `  Treasury check failed: ${err.message}`);
      anyFailure = true;
    }
  } else {
    log("INFO", "Task 2/3: FloatIncentive not deployed — skipping treasury check.");
  }

  // ── Task 3: Collect LP fees ──────────────────────────────────────────────
  if (poolTokenId && !SKIP_FEES) {
    log("INFO", `Task 3/3: Collecting LP fees for tokenId ${poolTokenId}...`);
    try {
      const npm         = new ethers.Contract(cfg.positionManager, NPM_ABI, keeper);
      const MAX_UINT128 = (2n ** 128n) - 1n;
      const keeperAddr  = await keeper.getAddress();

      // Check tokensOwed before collecting
      const pos = await npm.positions(BigInt(poolTokenId));
      const owed0: bigint = pos.tokensOwed0;
      const owed1: bigint = pos.tokensOwed1;
      log("INFO", `  tokensOwed0: ${owed0.toString()}, tokensOwed1: ${owed1.toString()}`);

      const collectTx = await npm.collect({
        tokenId:    BigInt(poolTokenId),
        recipient:  keeperAddr,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      });
      const receipt = await collectTx.wait();

      // Parse Collect event
      const iface = new ethers.Interface([
        "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
      ]);
      let found = false;
      for (const logEntry of receipt.logs) {
        try {
          const parsed = iface.parseLog(logEntry);
          if (parsed) {
            log(
              "INFO",
              `  Collected — amount0: ${parsed.args.amount0.toString()}, amount1: ${parsed.args.amount1.toString()}`
            );
            found = true;
          }
        } catch {}
      }
      if (!found) {
        log("INFO", "  Collect OK (amounts: 0 or event not found).");
      }
    } catch (err: any) {
      log("ERROR", `  Fee collection failed: ${err.message}`);
      anyFailure = true;
    }
  } else if (SKIP_FEES) {
    log("INFO", "Task 3/3: KEEPER_SKIP_FEES=true — skipping fee collection.");
  } else {
    log("INFO", "Task 3/3: Pool not seeded — skipping fee collection.");
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (anyFailure) {
    log("WARN", "Keeper run completed with errors. Check logs above.");
    process.exit(1);
  } else {
    log("INFO", "Keeper run completed successfully.");
  }
}

main().catch((err) => {
  log("ERROR", err.message ?? String(err));
  process.exit(1);
});
