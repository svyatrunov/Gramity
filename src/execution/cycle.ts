/**
 * DCA cycle wrapper — full pipeline with cycles table logging.
 * USDT → Omniston swap → Tonstakers → STON.fi LP → withdrawal address.
 */

import {
  insertCycle,
  updateCycle,
  incrementCyclesCompleted,
  pool,
  type Plan,
} from "../db/index.js";
import { executeStrategy, type ExecutionResult } from "./index.js";

export interface DcaCycleResult extends ExecutionResult {
  cycleId?: string;
  amountUsdt?: number;
  skipped?: boolean;
  reason?: string;
}

type CycleSkipNotifier = (telegramId: number, message: string) => Promise<void>;
let _cycleSkipNotify: CycleSkipNotifier | null = null;

export function setCycleSkipNotifier(fn: CycleSkipNotifier): void {
  _cycleSkipNotify = fn;
}

async function notifyCycleSkipped(telegramId: number, message: string): Promise<void> {
  if (_cycleSkipNotify) {
    await _cycleSkipNotify(telegramId, message).catch(() => {});
    return;
  }
  const { bot } = await import("../bot/index.js");
  await bot.api.sendMessage(telegramId, message, { parse_mode: "Markdown" }).catch(() => {});
}

export async function executeDcaCycle(
  plan: Plan,
  amountUsdt?: number
): Promise<DcaCycleResult> {
  if (!plan.ton_address || plan.ton_address.trim() === "") {
    await notifyCycleSkipped(
      plan.telegram_id,
      "⚠️ Cycle skipped — withdrawal address not set.\n" +
        "Open App → set withdrawal wallet → cycles will resume."
    );
    return {
      skipped: true,
      reason: "no_withdrawal_address",
      usdtSpent: 0,
      tonReceived: 0,
      tstonReceived: 0,
      lpTokensAdded: 0,
      lpPositionValue: "0",
      apy1d: "0",
      apy7d: "0",
      status: "failed",
      txSwap: null,
      txStake: null,
      txLp: null,
      failedStep: null,
    };
  }

  const lockResult = await pool.query(
    `UPDATE plans SET is_running = TRUE
     WHERE telegram_id = $1 AND is_running = FALSE
     RETURNING id`,
    [plan.telegram_id]
  );

  if (lockResult.rowCount === 0) {
    console.log("[CYCLE] Already running for", plan.telegram_id, "— skipped");
    return {
      skipped: true,
      reason: "already_running",
      usdtSpent: 0,
      tonReceived: 0,
      tstonReceived: 0,
      lpTokensAdded: 0,
      lpPositionValue: "0",
      apy1d: "0",
      apy7d: "0",
      status: "failed",
      txSwap: null,
      txStake: null,
      txLp: null,
      failedStep: null,
    };
  }

  try {
    const amount = amountUsdt ?? plan.usdt_amount;
    const execPlan: Plan = { ...plan, usdt_amount: amount };

    const cycleId = await insertCycle(plan.telegram_id, amount);

    const result = await executeStrategy(execPlan);

    const cycleStatus =
      result.status === "success" ? "completed" : "failed";

    await updateCycle(cycleId, {
      status: cycleStatus,
      ton_received: result.tonReceived > 0 ? result.tonReceived : null,
      lp_tokens_received: result.lpTokensAdded > 0 ? result.lpTokensAdded : null,
      tx_swap: result.txSwap,
      tx_stake: result.txStake,
      tx_lp: result.txLp,
      error_message:
        cycleStatus === "failed"
          ? result.failedStep
            ? `Failed at ${result.failedStep}`
            : "Cycle failed"
          : null,
    });

    if (cycleStatus === "completed") {
      await incrementCyclesCompleted(plan.id).catch(() => {});
    }

    return { ...result, cycleId, amountUsdt: amount };
  } finally {
    await pool.query(
      "UPDATE plans SET is_running = FALSE WHERE telegram_id = $1",
      [plan.telegram_id]
    );
  }
}
