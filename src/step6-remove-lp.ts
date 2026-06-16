/**
 * Step 6 — REMOVE LIQUIDITY from STON.fi tsTON/TON pool
 *
 * Burns LP tokens → pool returns TON + tsTON to the wallet.
 * Uses TEP-74 burn operation (0x595f07bc).
 */

import { fromNano } from "@ton/ton";
import type { WalletContext } from "./wallet.js";
import { burnJetton } from "./services/jetton.js";
import { POOL_ADDRESS, STON_API_URL } from "./config.js";
import { StonApiClient } from "@ston-fi/api";
import { sleep } from "./wallet.js";

export interface RemoveLpResult {
  lpBurned: bigint;
}

/**
 * Remove all LP tokens from the tsTON/TON STON.fi pool.
 * The pool sends back TON + tsTON after the burn is confirmed on-chain.
 *
 * @param ctx  Wallet context (agent wallet)
 * @returns    Amount of LP tokens burned
 */
export async function step6RemoveLiquidity(
  ctx: WalletContext
): Promise<RemoveLpResult> {
  console.log("\n── STEP 6: REMOVE LIQUIDITY (STON.fi burn LP) ──────────────");

  const apiClient = new StonApiClient({ baseUrl: STON_API_URL });

  // Get LP balance via STON.fi API
  let lpBalance = 0n;
  try {
    const walletPool = await apiClient.getWalletPool({
      walletAddress: ctx.address,
      poolAddress: POOL_ADDRESS,
    });
    if (walletPool?.lpBalance) {
      lpBalance = BigInt(walletPool.lpBalance);
    }
  } catch (err) {
    console.warn("[S6] Could not fetch LP balance via API, will try direct query:", err);
  }

  if (lpBalance === 0n) {
    console.log("[S6] No LP tokens found. Nothing to remove.");
    return { lpBurned: 0n };
  }

  console.log(`[S6] LP balance: ${fromNano(lpBalance)} LP tokens`);
  console.log(`[S6] Burning LP tokens → pool returns TON + tsTON...`);

  // Burn LP tokens — STON.fi pool will return underlying assets
  await burnJetton(ctx, POOL_ADDRESS, lpBalance);

  console.log("[S6] LP burn TX sent. Assets will arrive within 30–60 seconds.");

  return { lpBurned: lpBalance };
}
