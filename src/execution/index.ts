/**
 * Strategy execution wrapper
 * Runs the 5-step engine for a given plan and logs results to DB.
 */

import { fromNano } from "@ton/ton";
import { createWallet } from "../wallet.js";
import { step1Swap } from "../step1-swap.js";
import { step2CalculateSplit } from "../step2-split.js";
import { step3Stake } from "../step3-stake.js";
import { step4ProvideLiquidity } from "../step4-liquidity.js";
import { step5Verify } from "../step5-verify.js";
import { TSTON_ADDRESS } from "../config.js";
import { logExecution, updatePlan, type Plan } from "../db/index.js";
import { getTonPriceUsd, getUsdtBalance } from "../services/tonapi.js";

export interface ExecutionResult {
  usdtSpent: number;
  tonReceived: number;
  tstonReceived: number;
  lpTokensAdded: number;
  lpPositionValue: string;
  apy1d: string;
  apy7d: string;
  status: "success" | "failed" | "partial";
}

/** Thrown when wallet has insufficient USDT — no execution logged, plan paused */
export class InsufficientFundsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super(`Insufficient USDT: $${balance.toFixed(2)} < $${required}`);
    this.name = "InsufficientFundsError";
  }
}

// Cached deposit address (backend wallet)
let _depositAddress: string | null = null;

export async function getDepositAddress(): Promise<string> {
  if (_depositAddress) return _depositAddress;
  const ctx = await createWallet();
  _depositAddress = ctx.address;
  return _depositAddress;
}

export async function executeStrategy(plan: Plan): Promise<ExecutionResult> {
  console.log(
    `[EXEC] Starting plan ${plan.id} (tg: ${plan.telegram_id}, amount: $${plan.usdt_amount})`
  );

  const walletCtx = await createWallet();

  // ── Pre-flight: check USDT balance ─────────────────────────────────────────
  const usdtBalance = await getUsdtBalance(walletCtx.address);
  console.log(`[EXEC] USDT balance: $${usdtBalance.toFixed(2)}, required: $${plan.usdt_amount}`);

  if (usdtBalance < plan.usdt_amount) {
    // Pause the plan so it doesn't retry every cycle
    await updatePlan(plan.telegram_id, { active: false });
    throw new InsufficientFundsError(usdtBalance, plan.usdt_amount);
  }

  // ── Fetch TON price upfront (needed for logging) ───────────────────────────
  const tonPriceUsd = await getTonPriceUsd().catch(() => 0);

  let tonReceived = 0n;
  let tstonReceived = 0n;
  let lpTokensAdded = 0n;
  let lpPositionValue = "N/A";
  let apy1d = "N/A";
  let apy7d = "N/A";
  let execStatus: "success" | "failed" | "partial" = "success";

  try {
    // Step 1: USDT → TON
    tonReceived = await step1Swap(walletCtx, plan.usdt_amount);
    console.log(`[EXEC] Step 1 done: ${fromNano(tonReceived)} TON`);

    // Step 2: Calculate split
    const splitInfo = await step2CalculateSplit(tonReceived);
    console.log(`[EXEC] Step 2 done: pool ${splitInfo.poolAddress}`);

    // Step 3: TON → tsTON
    const { tsTonReceived, tsTonAddress } = await step3Stake(
      walletCtx,
      splitInfo.stakeAmount
    );
    tstonReceived = tsTonReceived;
    console.log(`[EXEC] Step 3 done: ${fromNano(tstonReceived)} tsTON`);

    // Step 4: Provide liquidity
    const resolvedTstonAddress = tsTonAddress || TSTON_ADDRESS;
    const { lpTokensReceived } = await step4ProvideLiquidity(
      walletCtx,
      tsTonReceived,
      splitInfo.keepAmount,
      splitInfo,
      resolvedTstonAddress
    );
    lpTokensAdded = lpTokensReceived;
    console.log(`[EXEC] Step 4 done: ${fromNano(lpTokensAdded)} LP tokens`);

    // Step 5: Verify
    const verifyResult = await step5Verify(walletCtx.address, splitInfo);
    lpPositionValue = verifyResult.lpValueUsd;
    apy1d = verifyResult.apy1d;
    apy7d = verifyResult.apy7d;
    console.log(`[EXEC] Step 5 done: LP value $${lpPositionValue}`);
  } catch (err) {
    console.error("[EXEC] Error during execution:", err);
    execStatus = tonReceived === 0n ? "failed" : "partial";
  }

  // ── Log to DB ───────────────────────────────────────────────────────────────
  try {
    await logExecution({
      plan_id: plan.id,
      usdt_spent: plan.usdt_amount,
      ton_received: tonReceived > 0n ? Number(fromNano(tonReceived)) : null,
      tston_received: tstonReceived > 0n ? Number(fromNano(tstonReceived)) : null,
      lp_tokens_added: lpTokensAdded > 0n ? Number(fromNano(lpTokensAdded)) : null,
      ton_price_usdt: tonPriceUsd > 0 ? tonPriceUsd : null,
      lp_position_value: lpPositionValue !== "N/A" ? Number(lpPositionValue) : null,
      tx_swap: null,
      tx_stake: null,
      tx_lp: null,
      status: execStatus,
    });
  } catch (err) {
    console.error("[EXEC] Failed to log execution:", err);
  }

  return {
    usdtSpent: plan.usdt_amount,
    tonReceived: Number(fromNano(tonReceived)),
    tstonReceived: Number(fromNano(tstonReceived)),
    lpTokensAdded: Number(fromNano(lpTokensAdded)),
    lpPositionValue,
    apy1d,
    apy7d,
    status: execStatus,
  };
}
