/**
 * Step 5 — VERIFY LP position via STON.fi API
 *
 * Checks:
 *  - LP balance for the pool
 *  - LP value in USDT (lpBalance * lpPriceUsd / totalSupply)
 *  - Current APY (1D / 7D)
 */

import { StonApiClient } from "@ston-fi/api";
import { fromNano } from "@ton/ton";
import { STON_API_URL } from "./config.js";
import type { SplitResult } from "./step2-split.js";

export interface VerifyResult {
  lpBalance: string;
  lpValueUsd: string;
  apy1d: string;
  apy7d: string;
}

export async function step5Verify(
  walletAddress: string,
  splitInfo: SplitResult
): Promise<VerifyResult> {
  console.log("\n── STEP 5: VERIFY LP POSITION ───────────────────────────────");

  const apiClient = new StonApiClient({ baseUrl: STON_API_URL });

  // ── Fetch wallet's LP data for the pool ────────────────────────────────────
  let lpBalance = "0";
  let lpValueUsd = "N/A";
  let apy1d = "N/A";
  let apy7d = "N/A";

  try {
    const walletPool = await apiClient.getWalletPool({
      walletAddress,
      poolAddress: splitInfo.poolAddress,
    });

    lpBalance = walletPool.lpBalance ?? "0";

    // LP value in USD: lpBalance * (lpTotalSupplyUsd / lpTotalSupply)
    if (
      walletPool.lpBalance &&
      walletPool.lpTotalSupplyUsd &&
      walletPool.lpTotalSupply
    ) {
      const share =
        Number(walletPool.lpBalance) / Number(walletPool.lpTotalSupply);
      lpValueUsd = (share * Number(walletPool.lpTotalSupplyUsd)).toFixed(2);
    } else if (walletPool.lpBalance && walletPool.lpPriceUsd) {
      // Alternative: lpBalance * lpPriceUsd (price per LP token)
      lpValueUsd = (
        (Number(walletPool.lpBalance) / 1e9) *
        Number(walletPool.lpPriceUsd)
      ).toFixed(2);
    }

    apy1d = walletPool.apy1D ?? "N/A";
    apy7d = walletPool.apy7D ?? "N/A";

    console.log(`[S5] Pool: ${splitInfo.poolAddress}`);
    console.log(`[S5] LP balance: ${fromNano(BigInt(lpBalance))} LP tokens`);
    console.log(`[S5] LP value (USD): $${lpValueUsd}`);
    console.log(`[S5] APY 1D: ${apy1d}`);
    console.log(`[S5] APY 7D: ${apy7d}`);
  } catch (err) {
    console.warn("[S5] API call failed:", (err as Error).message);
    console.log(
      "[S5] Note: api.ston.fi is mainnet-only. Testnet LP positions are not tracked here."
    );
    console.log("[S5] Check pool address on testnet explorer:", splitInfo.poolAddress);
  }

  // ── Also list all wallet pools for completeness ────────────────────────────
  try {
    const allPools = await apiClient.getWalletPools({ walletAddress });
    const activePools = allPools.filter(
      (p) => p.lpBalance && Number(p.lpBalance) > 0
    );
    if (activePools.length > 0) {
      console.log(`[S5] Active LP positions: ${activePools.length}`);
      for (const p of activePools) {
        let posValueUsd = "N/A";
        if (p.lpBalance && p.lpTotalSupplyUsd && p.lpTotalSupply) {
          const posShare = Number(p.lpBalance) / Number(p.lpTotalSupply);
          posValueUsd = (posShare * Number(p.lpTotalSupplyUsd)).toFixed(2);
        } else if (p.lpBalance && p.lpPriceUsd) {
          posValueUsd = ((Number(p.lpBalance) / 1e9) * Number(p.lpPriceUsd)).toFixed(2);
        }
        console.log(
          `     Pool ${p.address}: LP=${fromNano(BigInt(p.lpBalance!))} | ` +
            `value=$${posValueUsd}`
        );
      }
    }
  } catch {
    /* not critical */
  }

  console.log("\n[S5] ✓ Verification complete");

  return { lpBalance, lpValueUsd, apy1d, apy7d };
}

// ── Standalone runner ────────────────────────────────────────────────────────
if (require.main === module) {
  const walletAddress = "EQBpHXcaZUg4XqlCt3cCEoOZaQo2DyAT10U8NQUyCzdI385F";

  const splitInfo = {
    stakeAmount:   1439031014n,
    keepAmount:    1439031013n,
    poolRatio:     1.33603828,
    tsTONRate:     0.74848155,
    poolAddress:   "EQBjiBVhFLQVCMS8mKMA3gS823m9Xeu9aXiZUYD4TP8GDvui",
    token0Address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
    token1Address: "EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav",
    reserve0:      96543524900221n,
    reserve1:      128985845048531n,
  };

  step5Verify(walletAddress, splitInfo)
    .then((result) => {
      console.log("\n[DONE] step5 finished.");
      console.log(`  lpBalance  : ${result.lpBalance}`);
      console.log(`  lpValueUsd : $${result.lpValueUsd}`);
      console.log(`  apy1d      : ${result.apy1d}`);
      console.log(`  apy7d      : ${result.apy7d}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n[FATAL]", err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      process.exit(1);
    });
}
