import IORedis from 'ioredis';
import { db } from '../db/index.js';
import { rateSnapshots } from '../db/schema.js';

export interface RateSnapshot {
  sgdUsd: number;
  usdIdr: number;
  sgdIdr: number;
  spreadApplied: number;
  effectiveRate: number;
  source: 'pyth' | 'fallback';
  capturedAt: string;
}

const RATE_CACHE_KEY = 'corridor:rate:current';
const RATE_TTL_SECONDS = 65;

let pythFailCount = 0;

export class FxRateService {
  private redis: IORedis;

  constructor(redis: IORedis) {
    this.redis = redis;
  }

  private get spread(): number {
    return parseFloat(process.env.CORRIDOR_SPREAD || '0.005');
  }

  async fetchFromPyth(): Promise<{ sgdUsd: number; usdIdr: number; sgdIdr: number } | null> {
    try {
      // Pyth Hermes REST API — works on any chain without viem contract calls
      const pythUrl = 'https://hermes.pyth.network/v2/updates/price/latest';
      const sgdUsdFeedId = process.env.PYTH_SGD_USD_FEED_ID || '0x84c2dde9633d93d1bcad84e7dc41d9f9dd7d9b4a';
      const usdIdrFeedId = process.env.PYTH_USD_IDR_FEED_ID || '0x398e481c827a66e2571b956c7f394f8a1de0a3d7c98a7d70d15e99d6289c3b9';

      const resp = await fetch(
        `${pythUrl}?ids[]=${sgdUsdFeedId}&ids[]=${usdIdrFeedId}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (!resp.ok) throw new Error(`Pyth HTTP ${resp.status}`);
      const data = await resp.json() as any;
      const parsed = data.parsed as any[];

      const sgdEntry = parsed.find((p: any) => p.id.toLowerCase().includes(sgdUsdFeedId.toLowerCase().replace('0x', '')));
      const idrEntry = parsed.find((p: any) => p.id.toLowerCase().includes(usdIdrFeedId.toLowerCase().replace('0x', '')));
      if (!sgdEntry || !idrEntry) throw new Error('Missing Pyth feed entries');

      const sgdUsd = parseFloat(sgdEntry.price.price) * Math.pow(10, sgdEntry.price.expo);
      const usdIdr = parseFloat(idrEntry.price.price) * Math.pow(10, idrEntry.price.expo);
      const sgdIdr = usdIdr / sgdUsd;

      pythFailCount = 0;
      return { sgdUsd, usdIdr, sgdIdr };
    } catch (err) {
      pythFailCount++;
      console.error(`[fx-rate] Pyth fetch failed (attempt ${pythFailCount}):`, err);
      return null;
    }
  }

  async fetchFromCoinGecko(): Promise<{ sgdUsd: number; usdIdr: number; sgdIdr: number } | null> {
    try {
      const apiKey = process.env.COINGECKO_API_KEY ? `&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}` : '';
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=idr&vs_currencies=sgd${apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status}`);
      const data = await resp.json() as any;
      // CoinGecko returns IDR per SGD — we want SGD per IDR → invert
      const idrPerSgd: number = data?.idr?.sgd;
      if (!idrPerSgd) throw new Error('Missing CoinGecko data');
      const sgdIdr = 1 / idrPerSgd;
      // Approximate SGD/USD and USD/IDR from sgdIdr
      const sgdUsd = 0.74; // approximate fallback
      const usdIdr = sgdIdr / sgdUsd;
      return { sgdUsd, usdIdr, sgdIdr };
    } catch (err) {
      console.error('[fx-rate] CoinGecko fallback failed:', err);
      return null;
    }
  }

  applySpread(sgdIdr: number): number {
    return sgdIdr * (1 - this.spread);
  }

  async refreshRate(): Promise<RateSnapshot | null> {
    let raw: { sgdUsd: number; usdIdr: number; sgdIdr: number } | null = null;
    let source: 'pyth' | 'fallback' = 'pyth';

    if (pythFailCount < 3) {
      raw = await this.fetchFromPyth();
    }

    if (!raw) {
      source = 'fallback';
      raw = await this.fetchFromCoinGecko();
    }

    if (!raw) {
      console.error('[fx-rate] All rate sources failed');
      return null;
    }

    const effectiveRate = this.applySpread(raw.sgdIdr);
    const snapshot: RateSnapshot = {
      sgdUsd: raw.sgdUsd,
      usdIdr: raw.usdIdr,
      sgdIdr: raw.sgdIdr,
      spreadApplied: this.spread,
      effectiveRate,
      source,
      capturedAt: new Date().toISOString(),
    };

    await this.cacheRate(snapshot);

    try {
      await db.insert(rateSnapshots).values({
        sgdUsd: raw.sgdUsd.toFixed(6),
        usdIdr: raw.usdIdr.toFixed(4),
        sgdIdr: raw.sgdIdr.toFixed(4),
        spreadApplied: this.spread.toFixed(4),
        effectiveRate: effectiveRate.toFixed(4),
        source,
      });
    } catch (e) {
      console.error('[fx-rate] Failed to persist rate snapshot:', e);
    }

    return snapshot;
  }

  async cacheRate(snapshot: RateSnapshot): Promise<void> {
    await this.redis.setex(RATE_CACHE_KEY, RATE_TTL_SECONDS, JSON.stringify(snapshot));
  }

  async getCachedRate(): Promise<RateSnapshot | null> {
    const raw = await this.redis.get(RATE_CACHE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as RateSnapshot; } catch { return null; }
  }

  calculateFee(sgdAmount: number): { sgdFee: number; sgdNet: number } {
    const flatFee = parseFloat(process.env.CORRIDOR_FEE_FLAT_SGD || '1.50');
    const pctFee = parseFloat(process.env.CORRIDOR_FEE_PCT || '0.01');
    const maxFee = parseFloat(process.env.CORRIDOR_FEE_MAX_SGD || '15.00');
    const sgdFee = Math.min(flatFee + sgdAmount * pctFee, maxFee);
    const sgdNet = sgdAmount - sgdFee;
    return { sgdFee: parseFloat(sgdFee.toFixed(2)), sgdNet: parseFloat(sgdNet.toFixed(2)) };
  }
}
