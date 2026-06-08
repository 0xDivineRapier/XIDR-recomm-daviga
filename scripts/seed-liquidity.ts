/**
 * Seed a XIDR/USDC Uniswap v3 pool on Base Mainnet.
 *
 * Pool parameters:
 *   - Fee tier : 500 (0.05% — stablecoin pair)
 *   - Initial price: 1 USDC = IDR_PER_USDC XIDR  (default 15,900)
 *   - Liquidity: XIDR_AMOUNT XIDR + equivalent USDC within ±2% range
 *
 * NonfungiblePositionManager on Base: 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5
 * UniswapV3Factory on Base          : 0x33128a8fC17869897dcE68Ed026d694621f6FDfD
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ---- Uniswap v3 Base addresses ----
const POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f5";
const FACTORY_ADDRESS  = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const USDC_BASE        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet

// ---- Pool parameters ----
const FEE_TIER       = 500;
const IDR_PER_USDC   = BigInt(process.env.IDR_PER_USDC ?? "15900");
const XIDR_AMOUNT    = 100_000_000n; // 100 million XIDR
const TICK_SPACING   = 10; // for fee=500

// ---- Minimal ABIs ----
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address) external view returns (uint256)",
];

const FACTORY_ABI = [
  "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)",
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const POOL_ABI = [
  "function initialize(uint160 sqrtPriceX96) external",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
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

// ---- Math helpers ----
function sqrtPriceX96FromPrice(price: bigint): bigint {
  // price = XIDR per USDC. USDC has 6 decimals, XIDR has 0.
  // Uniswap price = token1/token0. We need to sort tokens.
  // sqrtPriceX96 = sqrt(price) * 2^96
  // price in raw terms: price_raw = amount_token1 / amount_token0
  // If token0=XIDR (0 decimals), token1=USDC (6 decimals):
  //   price_raw = (USDC_units / 1e6) / XIDR_units = 1 / (IDR_PER_USDC)  adjusted for decimals
  //   price_raw = 1e6 / IDR_PER_USDC  (token1 raw units per token0 raw unit)
  const Q96 = 2n ** 96n;
  const PRECISION = 10n ** 18n;
  const priceRaw = (1_000_000n * PRECISION) / price; // token1(USDC) per token0(XIDR)
  const sqrtPrice = sqrt(priceRaw * PRECISION);
  return (sqrtPrice * Q96) / PRECISION;
}

function sqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("sqrt of negative");
  if (value === 0n) return 0n;
  let z = value;
  let x = value / 2n + 1n;
  while (x < z) { z = x; x = (value / x + x) / 2n; }
  return z;
}

function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function tickFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n;
  const priceX128 = (sqrtPriceX96 * sqrtPriceX96) / (Q96);
  const price = Number(priceX128) / Number(Q96);
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// ---- Main ----
async function main() {
  if (network.name !== "base-mainnet") {
    throw new Error("seed-liquidity.ts must run on base-mainnet");
  }

  const deploymentsFile = path.join(__dirname, "..", "deployments", "base-mainnet.json");
  if (!fs.existsSync(deploymentsFile)) {
    throw new Error("deployments/base-mainnet.json not found — deploy first.");
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));
  const xidrAddress: string = deployment.proxy;

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
  const npm     = new ethers.Contract(POSITION_MANAGER, NPM_ABI, signer);
  const usdc    = new ethers.Contract(USDC_BASE, ERC20_ABI, signer);
  const xidr    = new ethers.Contract(xidrAddress, ERC20_ABI, signer);

  // Sort tokens (Uniswap requires token0 < token1 lexicographically)
  const token0Addr = xidrAddress.toLowerCase() < USDC_BASE.toLowerCase() ? xidrAddress : USDC_BASE;
  const token1Addr = token0Addr === xidrAddress ? USDC_BASE : xidrAddress;
  const xidrIsToken0 = token0Addr === xidrAddress;

  // Calculate USDC amount: XIDR_AMOUNT / IDR_PER_USDC * 1e6
  const usdcAmount = (XIDR_AMOUNT * 1_000_000n) / IDR_PER_USDC;

  // --- Create pool if needed ---
  let poolAddress: string = await factory.getPool(token0Addr, token1Addr, FEE_TIER);
  if (poolAddress === ethers.ZeroAddress) {
    console.log("Creating XIDR/USDC pool...");
    const tx = await factory.createPool(token0Addr, token1Addr, FEE_TIER);
    await tx.wait();
    poolAddress = await factory.getPool(token0Addr, token1Addr, FEE_TIER);
    console.log("Pool created at:", poolAddress);
  } else {
    console.log("Pool already exists at:", poolAddress);
  }

  // --- Initialize price if needed ---
  const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
  const slot0 = await pool.slot0();
  if (slot0.sqrtPriceX96 === 0n) {
    // If XIDR is token0: price = USDC/XIDR = 1/IDR_PER_USDC (adjusted for decimals)
    // If XIDR is token1: price = XIDR/USDC = IDR_PER_USDC (adjusted for decimals)
    const sqrtPrice = xidrIsToken0
      ? sqrtPriceX96FromPrice(IDR_PER_USDC)
      : sqrtPriceX96FromPrice(1n); // inverse case
    console.log("Initializing pool price...");
    const tx = await pool.initialize(sqrtPrice);
    await tx.wait();
    console.log("Pool initialized. sqrtPriceX96:", sqrtPrice.toString());
  }

  // --- Approve tokens ---
  console.log("Approving tokens...");
  await (await xidr.approve(POSITION_MANAGER, XIDR_AMOUNT)).wait();
  await (await usdc.approve(POSITION_MANAGER, usdcAmount)).wait();

  // --- Compute tick range (±2%) ---
  const currentSlot0 = await pool.slot0();
  const currentTick  = currentSlot0.tick;
  const tickRange = Math.floor(Math.log(1.02) / Math.log(1.0001)); // ~200 ticks ≈ 2%
  const tickLower = nearestUsableTick(currentTick - tickRange, TICK_SPACING);
  const tickUpper = nearestUsableTick(currentTick + tickRange, TICK_SPACING);
  console.log(`Tick range: [${tickLower}, ${tickUpper}] (current: ${currentTick})`);

  // --- Add liquidity ---
  const amount0Desired = xidrIsToken0 ? XIDR_AMOUNT : usdcAmount;
  const amount1Desired = xidrIsToken0 ? usdcAmount  : XIDR_AMOUNT;

  console.log("Adding liquidity...");
  const mintTx = await npm.mint({
    token0: token0Addr,
    token1: token1Addr,
    fee: FEE_TIER,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: signer.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
  });
  const receipt = await mintTx.wait();

  // Parse tokenId from logs
  const iface = new ethers.Interface([
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  ]);
  let tokenId = "unknown";
  let liquidity = "unknown";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        tokenId  = parsed.args.tokenId.toString();
        liquidity = parsed.args.liquidity.toString();
      }
    } catch {}
  }

  console.log("LP position minted. Token ID:", tokenId, "Liquidity:", liquidity);

  // --- Save position ---
  const output = {
    network: "base-mainnet",
    pool: poolAddress,
    tokenId,
    liquidity,
    xidr: xidrAddress,
    usdc: USDC_BASE,
    feeTier: FEE_TIER,
    tickLower,
    tickUpper,
    xidrAmount: XIDR_AMOUNT.toString(),
    usdcAmount: usdcAmount.toString(),
    idrPerUsdc: IDR_PER_USDC.toString(),
    seededAt: new Date().toISOString(),
  };
  const outFile = path.join(__dirname, "..", "deployments", "liquidity-position.json");
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log("Position details saved to", outFile);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
