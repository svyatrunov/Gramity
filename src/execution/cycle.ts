/**
 * DCA cycle wrapper — full pipeline with cycles table logging.
 * USDT → Omniston swap → Tonstakers → STON.fi LP → withdrawal address.
 */

import {
  insertCycle,
  updateCycle,
  incrementCyclesCompleted,
  type Plan,
} from "../db/index.js";
import { executeStrategy, type ExecutionResult } from "./index.js";

export interface DcaCycleResult extends ExecutionResult {
  cycleId: string;
  amountUsdt: number;
}

export async function executeDcaCycle(
  plan: Plan,
  amountUsdt?: number
): Promise<DcaCycleResult> {
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
}
