/**
 * Step 7 — UNSTAKE tsTON → TON via Tonstakers
 *
 * Burns tsTON tokens. Tonstakers pool returns TON from its liquidity reserve
 * (instant for amounts within available reserve) or schedules withdrawal
 * for the next round (~36h).
 *
 * For exit purposes we use the burn approach; the SDK's unstake() method
 * requires a working connector that may not be available in the background.
 */

import { fromNano, toNano } from "@ton/ton";
import type { WalletContext } from "./wallet.js";
import { burnJetton } from "./services/jetton.js";
import { getAllVerifiedJettons } from "./services/tonapi.js";
import { TSTON_ADDRESS } from "./config.js";
import { sleep } from "./wallet.js";

export interface UnstakeResult {
  tsTonBurned: bigint;
}

/**
 * Unstake all tsTON in the wallet by burning tsTON tokens.
 * Tonstakers returns TON to the wallet.
 *
 * @param ctx  Wallet context
 */
export async function step7Unstake(ctx: WalletContext): Promise<UnstakeResult> {
  console.log("\n── STEP 7: UNSTAKE tsTON → TON (Tonstakers burn) ──────────");

  const jettons = await getAllVerifiedJettons(ctx.address);
  const tston = jettons.find(
    (j) =>
      j.jettonAddress.toLowerCase() === TSTON_ADDRESS.toLowerCase() ||
      j.symbol === "tsTON"
  );

  if (!tston || tston.balanceRaw === 0n) {
    console.log("[S7] No tsTON found. Nothing to unstake.");
    return { tsTonBurned: 0n };
  }

  console.log(`[S7] tsTON balance: ${tston.balance.toFixed(4)} tsTON`);
  console.log("[S7] Burning tsTON → TON via Tonstakers...");

  await burnJetton(ctx, TSTON_ADDRESS, tston.balanceRaw, toNano("0.5"));

  console.log("[S7] tsTON burn TX sent. TON will arrive within 30 seconds (instant liquidity).");

  return { tsTonBurned: tston.balanceRaw };
}
