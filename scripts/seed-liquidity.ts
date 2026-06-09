/**
 * Seed a XIDR/USDC Uniswap v3 pool on Base (mainnet or Sepolia).
 *
 * Idempotent — re-running will detect an existing pool/position and skip
 * creation/initialization steps that are already done.
 *
 * Pool parameters
 * ───────────────
 *   Fee tier   : 500  (0.05% — stablecoin pair, tick spacing 10)
 *   Init price : INITIAL_PRICE_XIDR_PER_USDC  (default 15,900)
 *   Range      : ±5% from initial price
 *   XIDR liq   : INITIAL_XIDR_LIQUIDITY       (default 100,000,000)
 *
 * Usage
 * ─────
 *   npx hardhat run scripts/seed-liquidity.ts --network base-sepolia
 *   npx hardhat run scripts/seed-liquidity.ts --network base-mainnet
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Network-specific addresses ────────────────────────────────────────────────
const NETWORK_CONFIG: Record<string, {
  positionManager: string;
  factory:         string;
  usdc:            string;
  deploymentsFile: string;
}> = {
  "base-mainnet": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    factory:         "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    usdc:            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    deploymentsFile: "base-mainnet.json",
  },
  "base-sepolia": {
    positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5",
    factory:         "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    // Circle's official USDC on Base Sepolia
    usdc:            "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    deploymentsFile: "base-sepolia.json",
  },
};

// ── Pool parameters ───────────────────────────────────────────────────────────
const FEE_TIER     = 500;
const TICK_SPACING = 10;
const IDR_PER_USDC = BigInt(
  process.env.INITIAL_PRICE_XIDR_PER_USDC ?? process.env.IDR_PER_USDC ?? "15900"
);
const XIDR_AMOUNT  = BigInt(process.env.INITIAL_XIDR_LIQUIDITY ?? "100000000");
const RANGE_PCT    = 0.05; // ±5%

// ── ABIs ──────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address) external view returns (uint256)",
  "function symbol() external view returns (string)",
];

const FACTORY_ABI = [
  "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)",
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const POOL_ABI = [
  "function initialize(uint160 sqrtPriceX96) external",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const NPM_ABI = [
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
];

// ── Math helpers ──────────────────────────────────────────────────────────────

/**
 * Compute sqrtPriceX96 for a XIDR/USDC pool where XIDR has 0 decimals
 * and USDC has 6 decimals.
 *
 * If XIDR is token0:
 *   price (token1/token0) = USDC_raw_units / XIDR_raw_units = 1e6 / xidrPerUsdc
 *
 * sqrtPriceX96 = sqrt(price) × 2^96
 */
export function sqrtPriceX96FromPrice(xidrPerUsdc: bigint): bigint {
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

export function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function tickFromHumanPrice(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const net = network.name;
  const cfg = NETWORK_CONFIG[net];
  if (!cfg) {
    throw new Error(
      `Unsupported network "${net}". Use --network base-sepolia or --network base-mainnet.`
    );
  }

  // ── Load deployments ──────────────────────────────────────────────────────
  const deploymentsDir  = path.join(__dirname, "..", "deployments");
  const deploymentsFile = path.join(deploymentsDir, cfg.deploymentsFile);

  if (!fs.existsSync(deploymentsFile)) {
    throw new Error(
      `${cfg.deploymentsFile} not found — run deploy.ts (or deploy-mainnet.ts) first.`
    );
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));
  const xidrAddress: string = deployment.proxy;
  if (!xidrAddress || xidrAddress === ethers.ZeroAddress) {
    throw new Error("No valid proxy address in deployments file.");
  }

  const [signer] = await ethers.getSigners();
  console.log("═══════════════════════════════════════════════════");
  console.log(" seed-liquidity.ts");
  console.log("═══════════════════════════════════════════════════");
  console.log("Network       :", net);
  console.log("Signer        :", signer.address);
  console.log("XIDR          :", xidrAddress);
  console.log("USDC          :", cfg.usdc);
  console.log("IDR per USDC  :", IDR_PER_USDC.toString());
  console.log("XIDR liquidity:", XIDR_AMOUNT.toString());

  const factory = new ethers.Contract(cfg.factory,         FACTORY_ABI, signer);
  const npm     = new ethers.Contract(cfg.positionManager, NPM_ABI,     signer);
  const usdc    = new ethers.Contract(cfg.usdc,            ERC20_ABI,   signer);
  const xidr    = new ethers.Contract(xidrAddress,         ERC20_ABI,   signer);

  // ── Step 1: Sort tokens ──────────────────────────────────────────────────
  const xidrIsToken0 = xidrAddress.toLowerCase() < cfg.usdc.toLowerCase();
  const token0Addr   = xidrIsToken0 ? xidrAddress : cfg.usdc;
  const token1Addr   = xidrIsToken0 ? cfg.usdc    : xidrAddress;
  console.log(
    `\nToken order   : token0=${xidrIsToken0 ? "XIDR" : "USDC"}  token1=${xidrIsToken0 ? "USDC" : "XIDR"}`
  );

  // USDC liquidity = XIDR_AMOUNT / IDR_PER_USDC expressed as 6-decimal USDC units
  const usdcAmount = (XIDR_AMOUNT * 1_000_000n) / IDR_PER_USDC;
  console.log(
    `USDC liquidity: ${usdcAmount.toString()} (6-decimal raw units ≈ ${
      Number(usdcAmount) / 1e6
    } USDC)`
  );

  // ── Step 2: Create pool (idempotent) ──────────────────────────────────────
  let poolAddress: string = await factory.getPool(token0Addr, token1Addr, FEE_TIER);

  if (poolAddress === ethers.ZeroAddress) {
    console.log("\n[1/4] Creating XIDR/USDC pool (fee=500)...");
    const tx = await factory.createPool(token0Addr, token1Addr, FEE_TIER);
    await tx.wait();
    poolAddress = await factory.getPool(token0Addr, token1Addr, FEE_TIER);
    console.log("      Pool created:", poolAddress);
  } else {
    console.log("\n[1/4] Pool already exists:", poolAddress);
  }

  // ── Step 3: Initialize price (idempotent) ─────────────────────────────────
  const pool   = new ethers.Contract(poolAddress, POOL_ABI, signer);
  const slot0  = await pool.slot0();

  if (slot0.sqrtPriceX96 === 0n) {
    // If XIDR is token0: price = USDC/XIDR (1e6/IDR_PER_USDC)
    // If USDC is token0: price = XIDR/USDC (IDR_PER_USDC/1e6) — inverse
    const sqrtPrice = xidrIsToken0
      ? sqrtPriceX96FromPrice(IDR_PER_USDC)
      : sqrtPriceX96FromPrice(1_000_000n / IDR_PER_USDC);

    console.log("[2/4] Initializing pool price...");
    console.log("      sqrtPriceX96:", sqrtPrice.toString());
    const tx = await pool.initialize(sqrtPrice);
    await tx.wait();
    console.log("      Pool initialized.");
  } else {
    console.log("[2/4] Pool already initialized. sqrtPriceX96:", slot0.sqrtPriceX96.toString());
  }

  // ── Step 4: Compute tick range ±RANGE_PCT ─────────────────────────────────
  const currentSlot0 = await pool.slot0();
  const currentTick  = Number(currentSlot0.tick);

  // Human price: USDC-units-per-XIDR (if XIDR=token0) or inverse
  const humanPrice = xidrIsToken0
    ? 1_000_000 / Number(IDR_PER_USDC)
    : Number(IDR_PER_USDC) / 1_000_000;

  const tickLower = nearestUsableTick(
    tickFromHumanPrice(humanPrice * (1 - RANGE_PCT)),
    TICK_SPACING
  );
  const tickUpper = nearestUsableTick(
    tickFromHumanPrice(humanPrice * (1 + RANGE_PCT)),
    TICK_SPACING
  );
  console.log(
    `[3/4] Tick range : [${tickLower}, ${tickUpper}]  current tick: ${currentTick}`
  );

  // ── Step 5: Approve tokens ────────────────────────────────────────────────
  console.log("[4/4] Approving tokens...");
  await (await xidr.approve(cfg.positionManager, XIDR_AMOUNT)).wait();
  await (await usdc.approve(cfg.positionManager, usdcAmount)).wait();

  // ── Step 6: Mint LP position ──────────────────────────────────────────────
  console.log("      Minting LP position...");
  const amount0Desired = xidrIsToken0 ? XIDR_AMOUNT : usdcAmount;
  const amount1Desired = xidrIsToken0 ? usdcAmount  : XIDR_AMOUNT;
  const amount0Min     = (amount0Desired * 99n) / 100n; // 1% slippage
  const amount1Min     = (amount1Desired * 99n) / 100n;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const mintTx   = await npm.mint({
    token0: token0Addr,
    token1: token1Addr,
    fee:    FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: signer.address,
    deadline,
  });
  const receipt = await mintTx.wait();

  // Parse IncreaseLiquidity event
  const iface = new ethers.Interface([
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  ]);
  let tokenId       = "unknown";
  let liquidity     = "unknown";
  let actualAmount0 = "0";
  let actualAmount1 = "0";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        tokenId       = parsed.args.tokenId.toString();
        liquidity     = parsed.args.liquidity.toString();
        actualAmount0 = parsed.args.amount0.toString();
        actualAmount1 = parsed.args.amount1.toString();
      }
    } catch { /* ignore non-matching logs */ }
  }

  console.log("\n✅ LP position minted!");
  console.log("   Token ID :", tokenId);
  console.log("   Liquidity:", liquidity);
  console.log(`   amount0  : ${actualAmount0} (${xidrIsToken0 ? "XIDR" : "USDC"})`);
  console.log(`   amount1  : ${actualAmount1} (${xidrIsToken0 ? "USDC" : "XIDR"})`);

  // ── Step 7: Save to deployments/<network>.json ────────────────────────────
  deployment.pool = {
    address:              poolAddress,
    fee:                  FEE_TIER,
    tokenId,
    liquidity,
    tickLower,
    tickUpper,
    token0:               token0Addr,
    token1:               token1Addr,
    xidrIsToken0,
    initialXidrLiquidity: XIDR_AMOUNT.toString(),
    initialUsdcLiquidity: usdcAmount.toString(),
    idrPerUsdc:           IDR_PER_USDC.toString(),
    seededAt:             new Date().toISOString(),
  };
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployment, null, 2));
  console.log("\nDeployments saved →", deploymentsFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
