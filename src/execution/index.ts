/**
 * Strategy execution wrapper
 * Runs the 5-step engine for a given plan and logs results to DB.
 *
 * Each step is wrapped in executeWithTimeout + withRetry:
 *   step1 (Omniston swap):    90 s timeout, 2 retries, 10 s delay
 *   step3 (Tonstakers stake): 60 s timeout, 1 retry
 *   step4 (STON.fi LP):       60 s timeout, 1 retry
 *   step5 (Verify):           30 s timeout, no retry (read-only)
 */

import { fromNano } from "@ton/ton";
import { getUserWalletContext } from "../services/userWallet.js";
import { step1Swap } from "../step1-swap.js";
import { step2CalculateSplit } from "../step2-split.js";
import { step3Stake } from "../step3-stake.js";
import { step4ProvideLiquidity } from "../step4-liquidity.js";
import { step5Verify } from "../step5-verify.js";
import { TSTON_ADDRESS } from "../config.js";
import { logExecution, updatePlan, setPlanLastError, type Plan } from "../db/index.js";
import { getTonPriceUsd, getUsdtBalance, getLastTxHash } from "../services/tonapi.js";

// ── Gas warning notifier injection (avoids circular dep with bot/index.ts) ────
type GasNotifier = (telegramId: number, msg: string) => Promise<void>;
let _gasNotify: GasNotifier | null = null;
export function setGasNotifier(fn: GasNotifier): void {
  _gasNotify = fn;
}

export interface ExecutionResult {
  usdtSpent: number;
  tonReceived: number;
  tstonReceived: number;
  lpTokensAdded: number;
  lpPositionValue: string;
  apy1d: string;
  apy7d: string;
  status: "success" | "failed" | "partial";
  txSwap: string | null;
  txStake: string | null;
  txLp: string | null;
  failedStep: string | null;
}

/** Thrown when wallet has insufficient USDT — execution stops immediately */
export class InsufficientFundsError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(balance: number | string, required: number | string) {
    const bal = Number(balance);
    const req = Number(required);
    super(`Insufficient USDT: $${bal.toFixed(2)} < $${req.toFixed(2)}`);
    this.name = "InsufficientFundsError";
    this.balance = bal;
    this.required = req;
  }
}

// ── Timeout / retry helpers ───────────────────────────────────────────────────

/**
 * Races fn() against a hard timeout.
 * Rejects with an error whose message includes the step name for DB logging.
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${stepName} timeout after ${timeoutMs}ms`)),
      timeoutMs
    )
  );
  return Promise.race([fn(), timeout]);
}

/**
 * Retries fn() up to `maxRetries` times on failure, with `delayMs` between attempts.
 * Total attempts = maxRetries + 1.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: number,
  stepName: string
): Promise<T> {
  let lastErr: Error = new Error("Unknown error");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        console.warn(
          `[EXEC] ${stepName} attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${lastErr.message}`
        );
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// ── Main execution function ───────────────────────────────────────────────────

export async function executeStrategy(plan: Plan): Promise<ExecutionResult> {
  console.log(
    `[EXEC] Starting plan ${plan.id} (tg: ${plan.telegram_id}, amount: $${plan.usdt_amount})`
  );

  const walletCtx = await getUserWalletContext(plan.telegram_id);

  // ── Safety-net USDT check (primary check is in preflight.ts / scheduler) ───
  const usdtBalance = await getUsdtBalance(walletCtx.address);
  console.log(`[EXEC] USDT balance: $${usdtBalance.toFixed(2)}, required: $${plan.usdt_amount}`);

  if (usdtBalance < plan.usdt_amount) {
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
  let txSwap: string | null = null;
  let txStake: string | null = null;
  let txLp: string | null = null;
  let failedStep: string | null = null;

  try {
    // ── Step 1: USDT → TON (90 s, retry 2×, 10 s delay) ──────────────────
    tonReceived = await withRetry(
      () =>
        executeWithTimeout(async () => {
          const swapResult = await step1Swap(walletCtx, plan.usdt_amount);
          if (swapResult.kind !== "native") {
            throw new Error("Legacy plan pipeline requires native TON swap output");
          }
          return swapResult.amountNano;
        }, 90_000, "step1_swap"),
      2,
      10_000,
      "step1_swap"
    );
    console.log(`[EXEC] Step 1 done: ${fromNano(tonReceived)} TON`);
    txSwap = await getLastTxHash(walletCtx.address, 3_000);
    if (txSwap) console.log(`[EXEC] Step 1 tx: ${txSwap}`);

    // ── Step 2: Calculate split (pure calc, no timeout needed) ─────────────
    const splitInfo = await step2CalculateSplit(tonReceived);
    console.log(`[EXEC] Step 2 done: pool ${splitInfo.poolAddress}`);

    // ── Step 3: TON → tsTON (60 s, retry 1×) — skip in accumulate mode ───
    let resolvedTstonAddress = TSTON_ADDRESS;
    if (plan.strategy_mode !== "accumulate") {
      const { tsTonReceived, tsTonAddress } = await withRetry(
        () =>
          executeWithTimeout(
            () => step3Stake(walletCtx, splitInfo.stakeAmount),
            60_000,
            "step3_stake"
          ),
        1,
        5_000,
        "step3_stake"
      );
      tstonReceived = tsTonReceived;
      resolvedTstonAddress = tsTonAddress || TSTON_ADDRESS;
      console.log(`[EXEC] Step 3 done: ${fromNano(tstonReceived)} tsTON`);
      txStake = await getLastTxHash(walletCtx.address, 3_000);
      if (txStake) console.log(`[EXEC] Step 3 tx: ${txStake}`);
    } else {
      console.log(`[EXEC] Step 3 skipped (accumulate mode)`);
    }

    // ── Step 4: Provide liquidity (60 s, retry 1×) — full mode only ───────
    if (plan.strategy_mode === "full" && tstonReceived > 0n) {
      const { lpTokensReceived } = await withRetry(
        () =>
          executeWithTimeout(
            () =>
              step4ProvideLiquidity(
                walletCtx,
                tstonReceived,
                splitInfo.keepAmount,
                splitInfo,
                resolvedTstonAddress
              ),
            60_000,
            "step4_lp"
          ),
        1,
        5_000,
        "step4_lp"
      );
      lpTokensAdded = lpTokensReceived;
      console.log(`[EXEC] Step 4 done: ${fromNano(lpTokensAdded)} LP tokens`);
      txLp = await getLastTxHash(walletCtx.address, 3_000);
      if (txLp) console.log(`[EXEC] Step 4 tx: ${txLp}`);
    } else if (plan.strategy_mode !== "full") {
      console.log(`[EXEC] Step 4 skipped (mode: ${plan.strategy_mode})`);
    }

    // ── Step 5: Verify (30 s, no retry — read-only) ────────────────────────
    const verifyResult = await executeWithTimeout(
      () => step5Verify(walletCtx.address, splitInfo),
      30_000,
      "step5_verify"
    );
    lpPositionValue = verifyResult.lpValueUsd;
    apy1d = verifyResult.apy1d;
    apy7d = verifyResult.apy7d;
    console.log(`[EXEC] Step 5 done: LP value $${lpPositionValue}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[EXEC] Error during execution (plan ${plan.id}):`, errMsg);

    execStatus = tonReceived === 0n ? "failed" : "partial";

    // Extract step name from timeout messages for DB tracking
    const timeoutMatch = errMsg.match(/^(step\d+\w*)\s+timeout/);
    failedStep = timeoutMatch?.[1] ?? "unknown_step";

    if (errMsg.includes("timeout")) {
      console.error(`[CYCLE ${plan.id}] ${failedStep} TIMEOUT`);
    }

    // Persist last_error to DB for monitoring / /status display
    try {
      await setPlanLastError(plan.id, errMsg);
    } catch (dbErr) {
      console.error("[EXEC] Failed to persist last_error:", dbErr);
    }
  }

  // ── Log execution to DB ────────────────────────────────────────────────────
  try {
    await logExecution({
      plan_id: plan.id,
      usdt_spent: plan.usdt_amount,
      ton_received: tonReceived > 0n ? Number(fromNano(tonReceived)) : null,
      tston_received: tstonReceived > 0n ? Number(fromNano(tstonReceived)) : null,
      lp_tokens_added: lpTokensAdded > 0n ? Number(fromNano(lpTokensAdded)) : null,
      ton_price_usdt: tonPriceUsd > 0 ? tonPriceUsd : null,
      lp_position_value: lpPositionValue !== "N/A" ? Number(lpPositionValue) : null,
      tx_swap: txSwap,
      tx_stake: txStake,
      tx_lp: txLp,
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
    txSwap,
    txStake,
    txLp,
    failedStep,
  };
}
