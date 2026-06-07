/**
 * Step 2 — CALCULATE SPLIT
 *
 * Fetches the current tsTON/TON pool from STON.fi API and computes:
 *   - pool ratio (reserve_tsTON / reserve_TON)
 *   - how much TON to stake (stake_amount) vs. keep (keep_amount)
 *     so that after staking we hold tsTON and TON in the exact pool ratio.
 *
 * Formula derivation:
 *   Let R = reserve_tsTON / reserve_TON  (token-amount ratio)
 *   Let X = tsTON exchange rate (TON per 1 tsTON) ≈ reserve_TON / reserve_tsTON = 1/R from pool
 *   We stake S TON → receive S/X tsTON
 *   We keep  K = total - S  TON
 *   Require: (S/X) / K = R  →  S = X*R*K  →  K = total/(X*R + 1)
 *
 *   When X = 1/R  (pool price):  X*R = 1  → K = total/2  (50/50 by value)
 *   When X ≠ 1/R (arb gap):     actual non-50/50 split
 *
 *   We use the actual tsTON rate reported by the pool's token price if available,
 *   otherwise approximate X = reserve_TON / reserve_tsTON from pool reserves.
 */

import { StonApiClient } from "@ston-fi/api";
import { fromNano } from "@ton/ton";
import { STON_API_URL, TSTON_ADDRESS, POOL_ADDRESS } from "./config.js";

export interface SplitResult {
  stakeAmount: bigint;   // TON (nanoton) to send to Tonstakers
  keepAmount: bigint;    // TON (nanoton) to keep for LP provision
  poolRatio: number;     // reserve_tsTON / reserve_TON (token amount ratio)
  tsTONRate: number;     // estimated TON per 1 tsTON (from pool)
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  reserve0: bigint;
  reserve1: bigint;
}

export async function step2CalculateSplit(
  totalTon: bigint
): Promise<SplitResult> {
  console.log("\n── STEP 2: CALCULATE SPLIT (tsTON/TON pool ratio) ──────────");
  console.log(`[S2] Total TON to split: ${fromNano(totalTon)} TON`);

  const apiClient = new StonApiClient({ baseUrl: STON_API_URL });

  // ── Discover tsTON/TON pool ────────────────────────────────────────────────
  let poolData: Awaited<ReturnType<typeof apiClient.getPool>> | null = null;

  if (POOL_ADDRESS) {
    try {
      console.log("[S2] Using configured pool address:", POOL_ADDRESS);
      poolData = await apiClient.getPool(POOL_ADDRESS);
    } catch (err) {
      console.warn("[S2] Could not fetch configured pool:", (err as Error).message);
    }
  }

  if (!poolData && TSTON_ADDRESS) {
    try {
      console.log("[S2] Searching pools for tsTON address:", TSTON_ADDRESS);
      const pools = await apiClient.getPoolsByAssetPair({
        asset0Address: TSTON_ADDRESS,
        asset1Address: "ton",
      });
      if (pools.length > 0) {
        // Prefer non-deprecated pools
        const activePool =
          pools.find((p) => !p.deprecated) ?? pools[0];
        poolData = activePool;
        console.log("[S2] Found pool:", activePool.address);
      }
    } catch (err) {
      console.warn("[S2] Pool search failed:", (err as Error).message);
    }
  }

  if (!poolData) {
    // Fallback: search all pools and find tsTON by symbol/name heuristic
    console.log("[S2] Searching all pools for tsTON...");
    try {
      const pools = await apiClient.getPools({ dexV2: true });
      const tstonPool = pools.find(
        (p) =>
          !p.deprecated &&
          (p.token0Address.toLowerCase().includes("tston") ||
            p.token1Address.toLowerCase().includes("tston") ||
            // Check if pool involves TON (reserves hint at tsTON/TON)
            (Number(p.reserve0) > 0 &&
              Number(p.reserve1) > 0 &&
              p.lpPriceUsd !== undefined))
      );
      if (tstonPool) {
        poolData = tstonPool;
        console.log("[S2] Found candidate pool:", tstonPool.address);
      }
    } catch (err) {
      console.warn("[S2] Bulk pool search failed:", (err as Error).message);
    }
  }

  if (!poolData) {
    throw new Error(
      "Could not find tsTON/TON pool. " +
        "Set TSTON_ADDRESS or POOL_ADDRESS in .env."
    );
  }

  const { address: poolAddress, reserve0, reserve1, token0Address, token1Address } = poolData;

  const r0 = BigInt(reserve0);
  const r1 = BigInt(reserve1);

  // Determine which reserve is tsTON and which is TON
  // (TON native is represented as "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c" or similar)
  const isToken0TSTON =
    TSTON_ADDRESS
      ? token0Address.toLowerCase() === TSTON_ADDRESS.toLowerCase()
      : Number(r0) < Number(r1); // heuristic: smaller reserve → likely tsTON (more valuable)

  const [reserveTSTON, reserveTON] = isToken0TSTON
    ? [r0, r1]
    : [r1, r0];

  // Pool ratio: tsTON units per TON unit
  const poolRatio = Number(reserveTSTON) / Number(reserveTON);
  // Exchange rate: TON per 1 tsTON (from AMM pool price)
  const tsTONRate = Number(reserveTON) / Number(reserveTSTON); // ≈ 1.05

  console.log(
    `[S2] Pool: ${poolAddress}`
  );
  console.log(
    `[S2] Reserves: ${fromNano(reserveTSTON)} tsTON | ${fromNano(reserveTON)} TON`
  );
  console.log(
    `[S2] Pool ratio (tsTON/TON): ${poolRatio.toFixed(6)}`
  );
  console.log(
    `[S2] tsTON rate (TON per tsTON): ${tsTONRate.toFixed(6)}`
  );

  // ── Calculate split ────────────────────────────────────────────────────────
  // K = total / (tsTONRate * poolRatio + 1)
  // S = total - K
  const denominator = tsTONRate * poolRatio + 1;
  const keepAmountF = Number(totalTon) / denominator;
  const stakeAmountF = Number(totalTon) - keepAmountF;

  const keepAmount = BigInt(Math.floor(keepAmountF));
  const stakeAmount = totalTon - keepAmount;

  const tsTONToReceive = Number(stakeAmount) / tsTONRate / 1e9;
  const tonToKeep = Number(keepAmount) / 1e9;

  console.log(`[S2] stake_amount: ${fromNano(stakeAmount)} TON → ~${tsTONToReceive.toFixed(4)} tsTON after staking`);
  console.log(`[S2] keep_amount:  ${fromNano(keepAmount)} TON`);
  console.log(
    `[S2] Resulting ratio tsTON/TON: ${(tsTONToReceive / tonToKeep).toFixed(6)} ` +
      `(target pool ratio: ${poolRatio.toFixed(6)})`
  );

  return {
    stakeAmount,
    keepAmount,
    poolRatio,
    tsTONRate,
    poolAddress,
    token0Address,
    token1Address,
    reserve0: r0,
    reserve1: r1,
  };
}

// ── Standalone runner ────────────────────────────────────────────────────────
if (require.main === module) {
  // Use TON amount from step1 output (2878062027 nanoton = ~2.878 TON)
  const totalTon = BigInt(process.argv[2] ?? "2878062027");
  step2CalculateSplit(totalTon)
    .then((result) => {
      console.log("\n[DONE] step2 finished.");
      console.log(`  stakeAmount : ${fromNano(result.stakeAmount)} TON`);
      console.log(`  keepAmount  : ${fromNano(result.keepAmount)} TON`);
      console.log(`  poolRatio   : ${result.poolRatio.toFixed(8)}`);
      console.log(`  tsTONRate   : ${result.tsTONRate.toFixed(8)}`);
      console.log(`  poolAddress : ${result.poolAddress}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n[FATAL]", err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exit(1);
    });
}
