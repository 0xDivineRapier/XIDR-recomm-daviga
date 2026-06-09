/**
 * manage-pool.ts — Uniswap v3 pool management CLI
 *
 * Subcommands (--action=<cmd>):
 *   add-liquidity   Add more XIDR+USDC to the existing LP position.
 *                   --xidr=<amount>  (raw XIDR units, e.g. 50000000)
 *   collect-fees    Collect accumulated fees from the LP position.
 *   rebalance       Remove all liquidity, shift to a new center price,
 *                   and re-add within ±5% of the new price.
 *                   --new-center-price=<IDR per USDC, e.g. 16200>
 *   pool-stats      Print current pool slot0, liquidity, and fee growth.
 *
 * Usage
 * ─────
 *   npx hardhat run scripts/manage-pool.ts --network base-sepolia -- \
 *     --action=add-liquidity --xidr=50000000
 *
 *   npx hardhat run scripts/manage-pool.ts --network base-sepolia -- \
 *     --action=collect-fees
 *
 *   npx hardhat run scripts/manage-pool.ts --network base-sepolia -- \
 *     --action=rebalance --new-center-price=16200
 *
 *   npx hardhat run scripts/manage-pool.ts --network base-sepolia -- \
 *     --action=pool-stats
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Network config ────────────────────────────────────────────────────────────
const NETWORK_CONFIG: Record<string, {
  positionManager: string;
  usdc:            string;
  deploymentsFile: string;
}> = {
  "base-mainnet": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    usdc:            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    deploymentsFile: "base-mainnet.json",
  },
  "base-sepolia": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    usdc:            "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    deploymentsFile: "base-sepolia.json",
  },
};

const TICK_SPACING = 10;
const FEE_TIER     = 500;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
  "function symbol() external view returns (string)",
];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function feeGrowthGlobal0X128() external view returns (uint256)",
  "function feeGrowthGlobal1X128() external view returns (uint256)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const NPM_ABI = [
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  `function increaseLiquidity(tuple(
    uint256 tokenId,
    uint256 amount0Desired,
    uint256 amount1Desired,
    uint256 amount0Min,
    uint256 amount1Min,
    uint256 deadline
  ) params) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`,
  `function decreaseLiquidity(tuple(
    uint256 tokenId,
    uint128 liquidity,
    uint256 amount0Min,
    uint256 amount1Min,
    uint256 deadline
  ) params) external payable returns (uint256 amount0, uint256 amount1)`,
  `function collect(tuple(
    uint256 tokenId,
    address recipient,
    uint128 amount0Max,
    uint128 amount1Max
  ) params) external payable returns (uint256 amount0, uint256 amount1)`,
  `function mint(tuple(
    address token0,
    address token1,
    uint24 fee,
    int24 tickLower,
    int24 tickUpper,
    uint256 amount0Desired,
    uint256 amount1Desired,
    uint256 amount0Min,
    uint256 amount1Min,
    address recipient,
    uint256 deadline
  ) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`,
  "function ownerOf(uint256 tokenId) external view returns (address)",
];

// ── Math helpers ──────────────────────────────────────────────────────────────
function sqrtPriceX96FromPrice(xidrPerUsdc: bigint): bigint {
  const Q96       = 2n ** 96n;
  const PRECISION = 10n ** 18n;
  const priceRaw  = (1_000_000n * PRECISION) / xidrPerUsdc;
  const sqrtPrice = isqrt(priceRaw * PRECISION);
  return (sqrtPrice * Q96) / PRECISION;
}

function isqrt(value: bigint): bigint {
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) { z = x; x = (value / x + x) / 2n; }
  return z;
}

function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function tickFromHumanPrice(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      args[key] = val ?? "true";
    }
  }
  return args;
}

// ── Sub-commands ──────────────────────────────────────────────────────────────

async function actionAddLiquidity(
  npm:       ethers.Contract,
  xidr:      ethers.Contract,
  usdc:      ethers.Contract,
  signer:    ethers.Signer,
  cfg:       { positionManager: string },
  tokenId:   bigint,
  xidrIsToken0: boolean,
  args:      Record<string, string>
) {
  const xidrAmt = BigInt(args["xidr"] ?? "0");
  if (xidrAmt === 0n) throw new Error("--xidr=<amount> required for add-liquidity");

  const pos = await npm.positions(tokenId);
  const idrPerUsdc = pos.tickLower > 0
    ? BigInt(Math.round(1_000_000 / Math.pow(1.0001, Number(pos.tickLower))))
    : 15900n; // fallback

  const usdcAmt = (xidrAmt * 1_000_000n) / idrPerUsdc;
  console.log(`Adding ${xidrAmt} XIDR + ${usdcAmt} USDC (raw)...`);

  await (await xidr.approve(cfg.positionManager, xidrAmt)).wait();
  await (await usdc.approve(cfg.positionManager, usdcAmt)).wait();

  const amount0Desired = xidrIsToken0 ? xidrAmt : usdcAmt;
  const amount1Desired = xidrIsToken0 ? usdcAmt : xidrAmt;
  const deadline       = BigInt(Math.floor(Date.now() / 1000) + 1800);

  const tx = await npm.increaseLiquidity({
    tokenId,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline,
  });
  const receipt = await tx.wait();

  // Parse IncreaseLiquidity event
  const iface = new ethers.Interface([
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  ]);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        console.log("✅ Liquidity increased.");
        console.log("   New liquidity delta:", parsed.args.liquidity.toString());
        console.log("   amount0 used       :", parsed.args.amount0.toString());
        console.log("   amount1 used       :", parsed.args.amount1.toString());
      }
    } catch {}
  }
}

async function actionCollectFees(
  npm:     ethers.Contract,
  signer:  ethers.Signer,
  tokenId: bigint
) {
  const signerAddr = await signer.getAddress();
  const MAX_UINT128 = (2n ** 128n) - 1n;

  console.log("Collecting fees for tokenId", tokenId.toString(), "...");
  const tx = await npm.collect({
    tokenId,
    recipient:    signerAddr,
    amount0Max:   MAX_UINT128,
    amount1Max:   MAX_UINT128,
  });
  const receipt = await tx.wait();

  const iface = new ethers.Interface([
    "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
  ]);
  let collected = false;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        console.log("✅ Fees collected.");
        console.log("   amount0:", parsed.args.amount0.toString());
        console.log("   amount1:", parsed.args.amount1.toString());
        collected = true;
      }
    } catch {}
  }
  if (!collected) {
    console.log("   (no fees to collect or event not found)");
  }
}

async function actionRebalance(
  npm:          ethers.Contract,
  pool:         ethers.Contract,
  xidr:         ethers.Contract,
  usdc:         ethers.Contract,
  signer:       ethers.Signer,
  cfg:          { positionManager: string },
  tokenId:      bigint,
  xidrIsToken0: boolean,
  args:         Record<string, string>
) {
  const newCenterPrice = BigInt(args["new-center-price"] ?? "0");
  if (newCenterPrice === 0n)
    throw new Error("--new-center-price=<IDR per USDC> required for rebalance");

  const signerAddr = await signer.getAddress();
  const MAX_UINT128 = (2n ** 128n) - 1n;

  // 1. Get current position liquidity
  const pos = await npm.positions(tokenId);
  const posLiquidity: bigint = pos.liquidity;

  console.log(`Rebalancing to ${newCenterPrice} IDR/USDC. Current liquidity: ${posLiquidity}`);

  // 2. Remove all liquidity
  if (posLiquidity > 0n) {
    console.log("  Removing all liquidity...");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    await (await npm.decreaseLiquidity({
      tokenId,
      liquidity: posLiquidity,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline,
    })).wait();
  }

  // 3. Collect tokens back (including accumulated fees)
  console.log("  Collecting tokens + fees...");
  const collectTx = await npm.collect({
    tokenId,
    recipient:  signerAddr,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  await collectTx.wait();

  // 4. Compute new tick range
  const humanPrice = xidrIsToken0
    ? 1_000_000 / Number(newCenterPrice)
    : Number(newCenterPrice) / 1_000_000;

  const tickLower = nearestUsableTick(tickFromHumanPrice(humanPrice * 0.95), TICK_SPACING);
  const tickUpper = nearestUsableTick(tickFromHumanPrice(humanPrice * 1.05), TICK_SPACING);
  console.log(`  New tick range: [${tickLower}, ${tickUpper}]`);

  // 5. Use available balances
  const xidrBal: bigint = await xidr.balanceOf(signerAddr);
  const usdcBal: bigint = await usdc.balanceOf(signerAddr);
  console.log("  XIDR balance:", xidrBal.toString());
  console.log("  USDC balance:", usdcBal.toString());

  const amount0Desired = xidrIsToken0 ? xidrBal : usdcBal;
  const amount1Desired = xidrIsToken0 ? usdcBal : xidrBal;

  // 6. Approve and re-mint
  await (await xidr.approve(cfg.positionManager, xidrBal)).wait();
  await (await usdc.approve(cfg.positionManager, usdcBal)).wait();

  const token0 = xidrIsToken0 ? await xidr.getAddress() : await usdc.getAddress();
  const token1 = xidrIsToken0 ? await usdc.getAddress() : await xidr.getAddress();

  console.log("  Minting new position...");
  const mintTx = await npm.mint({
    token0,
    token1,
    fee:    FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: signerAddr,
    deadline:  BigInt(Math.floor(Date.now() / 1000) + 1800),
  });
  const receipt = await mintTx.wait();

  const iface = new ethers.Interface([
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  ]);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        console.log("✅ Rebalance complete. New tokenId:", parsed.args.tokenId.toString());
        console.log("   Liquidity  :", parsed.args.liquidity.toString());
        console.log("   amount0    :", parsed.args.amount0.toString());
        console.log("   amount1    :", parsed.args.amount1.toString());
        return parsed.args.tokenId as bigint;
      }
    } catch {}
  }
  return null;
}

async function actionPoolStats(pool: ethers.Contract, xidrIsToken0: boolean) {
  const [slot0, liq, fg0, fg1] = await Promise.all([
    pool.slot0(),
    pool.liquidity(),
    pool.feeGrowthGlobal0X128(),
    pool.feeGrowthGlobal1X128(),
  ]);

  // Human-readable price from sqrtPriceX96
  const Q192 = 2n ** 192n;
  const sqrtP = slot0.sqrtPriceX96 as bigint;
  const priceNum = Number(sqrtP * sqrtP) / Number(Q192);

  let idrPerUsdc: number;
  if (xidrIsToken0) {
    // price = USDC/XIDR → IDR per USDC = 1 / price * 1e-6 * 1e0
    // price_raw = USDC_raw/XIDR_raw = priceNum
    // human price USDC = priceNum * 1e6 per XIDR unit
    // IDR per USDC = 1 / (priceNum * 1e6)
    idrPerUsdc = priceNum > 0 ? 1 / (priceNum * 1e6) : 0;
  } else {
    idrPerUsdc = priceNum * 1e6;
  }

  console.log("═══════════════════════════════════════");
  console.log(" Pool Stats");
  console.log("═══════════════════════════════════════");
  console.log("  sqrtPriceX96       :", slot0.sqrtPriceX96.toString());
  console.log("  Current tick       :", slot0.tick.toString());
  console.log("  Est. IDR per USDC  :", idrPerUsdc.toFixed(2));
  console.log("  Active liquidity   :", (liq as bigint).toString());
  console.log("  feeGrowthGlobal0   :", (fg0 as bigint).toString());
  console.log("  feeGrowthGlobal1   :", (fg1 as bigint).toString());
  console.log("  Fee protocol       :", slot0.feeProtocol.toString());
  console.log("  Unlocked           :", slot0.unlocked.toString());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const net = network.name;
  const cfg = NETWORK_CONFIG[net];
  if (!cfg) throw new Error(`Unsupported network "${net}".`);

  const args = parseArgs();
  const action = args["action"];
  if (!action) {
    throw new Error(
      "Usage: --action=<add-liquidity|collect-fees|rebalance|pool-stats>"
    );
  }

  // Load deployments
  const deploymentsFile = path.join(__dirname, "..", "deployments", cfg.deploymentsFile);
  if (!fs.existsSync(deploymentsFile)) {
    throw new Error(`${cfg.deploymentsFile} not found — seed liquidity first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));

  if (!deployment.pool) throw new Error("No pool data in deployments — run seed-liquidity.ts first.");

  const poolAddress  = deployment.pool.address as string;
  const tokenId      = BigInt(deployment.pool.tokenId as string);
  const xidrIsToken0 = deployment.pool.xidrIsToken0 as boolean;
  const xidrAddress  = deployment.proxy as string;

  const [signer] = await ethers.getSigners();
  console.log("Network:", net, "| Signer:", signer.address);
  console.log("Pool   :", poolAddress, "| tokenId:", tokenId.toString());

  const npm  = new ethers.Contract(cfg.positionManager, NPM_ABI,  signer);
  const pool = new ethers.Contract(poolAddress,          POOL_ABI, signer);
  const xidr = new ethers.Contract(xidrAddress,          ERC20_ABI, signer);
  const usdc = new ethers.Contract(cfg.usdc,             ERC20_ABI, signer);

  switch (action) {
    case "add-liquidity":
      await actionAddLiquidity(npm, xidr, usdc, signer, cfg, tokenId, xidrIsToken0, args);
      break;

    case "collect-fees":
      await actionCollectFees(npm, signer, tokenId);
      break;

    case "rebalance": {
      const newTokenId = await actionRebalance(
        npm, pool, xidr, usdc, signer, cfg, tokenId, xidrIsToken0, args
      );
      if (newTokenId != null) {
        deployment.pool.tokenId = newTokenId.toString();
        deployment.pool.idrPerUsdc = args["new-center-price"];
        deployment.pool.rebalancedAt = new Date().toISOString();
        fs.writeFileSync(deploymentsFile, JSON.stringify(deployment, null, 2));
        console.log("Deployments updated with new tokenId.");
      }
      break;
    }

    case "pool-stats":
      await actionPoolStats(pool, xidrIsToken0);
      break;

    default:
      throw new Error(`Unknown action: "${action}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
