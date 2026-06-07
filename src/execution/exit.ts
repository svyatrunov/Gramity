/**
 * Full position exit orchestrator.
 *
 * Flow:
 *   1. Burn LP tokens → receive TON + tsTON back in wallet
 *   2. Swap tsTON → TON via Tonstakers instant unstake
 *   3. Sweep all verified tokens (USDT + TON) → user's ton_address
 */

import { fromNano, toNano } from "@ton/ton";
import type { Plan } from "../db/index.js";
import { getUserWalletContext } from "../services/userWallet.js";
import { sweepAllTokens } from "./sweep.js";
import { burnJetton } from "../services/jetton.js";
import { getAllVerifiedJettons, getUsdtBalance } from "../services/tonapi.js";
import { POOL_ADDRESS, TSTON_ADDRESS, STON_API_URL } from "../config.js";
import { sleep } from "../wallet.js";
import { StonApiClient } from "@ston-fi/api";

export interface ExitResult {
  /** USDT sent to user's wallet */
  usdtSent: number;
  /** Summary of all tokens sent */
  summary: string[];
}

/**
 * Execute a full exit from all DeFi positions.
 * After completion, the user's agent wallet should be nearly empty.
 */
export async function executeFullExit(plan: Plan): Promise<ExitResult> {
  const telegramId = plan.telegram_id;
  console.log(`[EXIT] Starting full exit for user ${telegramId}`);

  const walletCtx = await getUserWalletContext(telegramId);
  const { address } = walletCtx;

  // ── Step 1: Burn LP tokens if any ──────────────────────────────────────────
  try {
    console.log("[EXIT] Step 1: Check LP position...");
    const apiClient = new StonApiClient({ baseUrl: STON_API_URL });

    const walletPool = await apiClient.getWalletPool({
      walletAddress: address,
      poolAddress: POOL_ADDRESS,
    }).catch(() => null);

    if (walletPool?.lpBalance && BigInt(walletPool.lpBalance) > 0n) {
      const lpAmount = BigInt(walletPool.lpBalance);
      console.log(`[EXIT] Burning ${fromNano(lpAmount)} LP tokens...`);

      await burnJetton(walletCtx, POOL_ADDRESS, lpAmount);
      console.log("[EXIT] LP burn sent. Waiting 60s for assets to arrive...");
      await sleep(60_000);
    } else {
      console.log("[EXIT] No LP position found, skipping step 1.");
    }
  } catch (err) {
    console.warn("[EXIT] Step 1 LP burn failed (non-fatal):", (err as Error).message);
  }

  // ── Step 2: Unstake tsTON if any ────────────────────────────────────────────
  try {
    console.log("[EXIT] Step 2: Check tsTON balance...");
    const jettons = await getAllVerifiedJettons(address);
    const tston = jettons.find(
      (j) =>
        j.jettonAddress.toLowerCase() === TSTON_ADDRESS.toLowerCase() ||
        j.symbol === "tsTON"
    );

    if (tston && tston.balanceRaw > 0n) {
      console.log(`[EXIT] Found ${tston.balance.toFixed(4)} tsTON. Initiating instant unstake...`);
      await burnJetton(walletCtx, TSTON_ADDRESS, tston.balanceRaw, toNano("0.5"));
      console.log("[EXIT] tsTON burn sent. Waiting 30s...");
      await sleep(30_000);
    } else {
      console.log("[EXIT] No tsTON found, skipping step 2.");
    }
  } catch (err) {
    console.warn("[EXIT] Step 2 tsTON unstake failed (non-fatal):", (err as Error).message);
  }

  // ── Step 3: Sweep everything to user's ton_address ───────────────────────────
  console.log("[EXIT] Step 3: Sweeping all verified tokens...");
  const { jettonsSent, tonSentNano } = await sweepAllTokens(walletCtx, plan.ton_address);

  const usdtSent = await getUsdtBalance(plan.ton_address).catch(() => 0);

  const summary: string[] = [...jettonsSent];
  if (tonSentNano > 0n) {
    summary.push(`${Number(fromNano(tonSentNano)).toFixed(3)} TON`);
  }

  console.log(`[EXIT] Complete. Sent: ${summary.join(", ")}`);

  return { usdtSent, summary };
}
