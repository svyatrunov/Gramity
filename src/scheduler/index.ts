/**
 * Gramity Scheduler — checks due plans every 5 minutes and executes strategy.
 * Set DEMO_MODE=true in Railway env to activate 5-second cycles without redeploy.
 *
 * Execution flow per cycle:
 *   1. preflightCheck (USDT balance, TON gas, plan active)
 *      → fail: notify user, increment consecutive_failures, auto-pause at 3
 *   2. executeStrategy with per-step timeouts and retries
 *      → success: reset consecutive_failures, notify user
 *      → fail: notify user, increment consecutive_failures, auto-pause at 3
 */

import cron, { type ScheduledTask } from "node-cron";
import { IS_PRODUCTION } from "../config.js";
import {
  getDuePlans,
  getActivePlans,
  getActiveStrategiesWithTelegram,
  getPlanByTelegramId,
  updatePlan,
  updateStrategyNextRun,
  incrementConsecutiveFailures,
  resetConsecutiveFailures,
  logNotification,
  getTotalInvested,
} from "../db/index.js";
import { InsufficientFundsError, type ExecutionResult } from "../execution/index.js";
import { executeDcaCycle } from "../execution/cycle.js";
import { preflightCheck } from "../execution/preflight.js";
import type { Plan } from "../db/index.js";
import type { Strategy } from "../db/index.js";
import {
  getNextPlanExecutionDate,
  getInitialPlanExecutionDate,
  isQuickPlan,
  frequencyToCron,
} from "../constants/dca.js";
import { walletQueue } from "../wallet-queue.js";
import { executeMultiStrategy } from "../strategy-executor.js";
import { getUserDepositAddress } from "../services/userWallet.js";
import { diag } from "../utils/diag.js";

const AUTO_PAUSE_THRESHOLD = 3;

// ── Injected notification callbacks (set by bot/index.ts) ────────────────────

type NotifyUserFn = (telegramId: number, result: ExecutionResult | null, error?: string) => Promise<void>;
type NotifyInsufficientFundsFn = (telegramId: number, balance: number, required: number) => Promise<void>;
type NotifyAutoPausedFn = (telegramId: number, reason: string) => Promise<void>;
type NotifyAllCompleteFn = (telegramId: number, totalInvested: number, lpBalance: string) => Promise<void>;

let notifyUser: NotifyUserFn | null = null;
let notifyInsufficientFunds: NotifyInsufficientFundsFn | null = null;
let notifyAutoPaused: NotifyAutoPausedFn | null = null;
let notifyAllComplete: NotifyAllCompleteFn | null = null;

export function setNotifyUser(fn: NotifyUserFn) { notifyUser = fn; }
export function setNotifyInsufficientFunds(fn: NotifyInsufficientFundsFn) { notifyInsufficientFunds = fn; }
export function setNotifyAutoPaused(fn: NotifyAutoPausedFn) { notifyAutoPaused = fn; }
export function setNotifyAllComplete(fn: NotifyAllCompleteFn) { notifyAllComplete = fn; }

// ── Scheduler state ───────────────────────────────────────────────────────────

const IS_DEMO_MODE = process.env.DEMO_MODE === "true";
const DEV_DEMO_CYCLE_INTERVAL_MS = 5_000;

function getNextExecutionDate(plan: Plan): Date {
  if (IS_DEMO_MODE) {
    const next = new Date();
    next.setTime(next.getTime() + DEV_DEMO_CYCLE_INTERVAL_MS);
    return next;
  }
  return getNextPlanExecutionDate(plan);
}

/** Plans currently executing — prevents double-runs across cron ticks. */
const executing = new Set<string>();
const executingStrategies = new Set<number>();

/** Per-strategy cron jobs (restored from DB on startup). */
const strategyCronJobs = new Map<number, ScheduledTask>();

function getNextStrategyRunDate(strategy: Strategy): Date {
  return getNextPlanExecutionDate({ frequency: strategy.frequency });
}

async function runStrategyJob(
  strategy: Strategy & { telegram_id: number }
): Promise<void> {
  if (executingStrategies.has(strategy.id)) {
    console.log(`[SCHEDULER] Strategy ${strategy.id} already executing, skipping`);
    return;
  }

  if (strategy.next_run_at && new Date(strategy.next_run_at) > new Date()) {
    return;
  }

  executingStrategies.add(strategy.id);

  try {
    const walletAddress =
      (await getUserDepositAddress(strategy.telegram_id)) ?? String(strategy.telegram_id);

    await walletQueue.add(walletAddress, async () => {
      const nextDate = getNextStrategyRunDate(strategy);
      await updateStrategyNextRun(strategy.id, nextDate);

      const syntheticPlan: Plan = {
        id: String(strategy.id),
        telegram_id: strategy.telegram_id,
        ton_address: strategy.withdrawal_wallet,
        agent_wallet: null,
        usdt_amount: strategy.amount_usdt,
        frequency: strategy.frequency as Plan["frequency"],
        strategy_mode: "full",
        active: true,
        next_execution_at: nextDate.toISOString(),
        created_at: strategy.created_at,
        demo_mode: false,
        cycles_completed: strategy.total_cycles,
        max_cycles: null,
        consecutive_failures: 0,
        last_error: strategy.last_error,
        is_running: false,
      };

      const preflight = await preflightCheck(syntheticPlan);
      if (!preflight.ok) {
        console.log(
          `[SCHEDULER] Strategy ${strategy.id} preflight failed: ${preflight.reason}`
        );
        return;
      }

      await executeMultiStrategy(strategy, strategy.telegram_id);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SCHEDULER] Strategy ${strategy.id} failed:`, msg);
  } finally {
    executingStrategies.delete(strategy.id);
  }
}

export function registerStrategyCron(
  strategy: Strategy & { telegram_id: number }
): void {
  const existing = strategyCronJobs.get(strategy.id);
  if (existing) {
    existing.stop();
    strategyCronJobs.delete(strategy.id);
  }

  if (strategy.status !== "active") return;

  const cronExpr = frequencyToCron(strategy.frequency);
  const job = cron.schedule(
    cronExpr,
    () => {
      void runStrategyJob(strategy);
    },
    { timezone: "UTC", name: `strategy_${strategy.id}` }
  );
  strategyCronJobs.set(strategy.id, job);
  console.log(
    `[SCHEDULER] Registered cron for strategy #${strategy.id} (${cronExpr})`
  );
}

export function unregisterStrategyCron(strategyId: number): void {
  const job = strategyCronJobs.get(strategyId);
  if (job) {
    job.stop();
    strategyCronJobs.delete(strategyId);
  }
}

/** Re-register active strategies after Railway restart. */
export async function restoreSchedules(): Promise<void> {
  const [plans, strategies] = await Promise.all([
    getActivePlans(),
    getActiveStrategiesWithTelegram(),
  ]);

  for (const plan of plans) {
    const nextAt = new Date(plan.next_execution_at);
    if (Number.isNaN(nextAt.getTime())) {
      const fixed = getInitialPlanExecutionDate(plan);
      await updatePlan(plan.telegram_id, { next_execution_at: fixed.toISOString() });
      console.warn(
        `[SCHEDULER] Fixed invalid next_execution_at for plan ${plan.id}`
      );
    }
  }

  for (const strategy of strategies) {
    registerStrategyCron(strategy);
  }

  console.log(
    `[SCHEDULER] Restored ${plans.length} active plan(s), ${strategies.length} active strategy(ies)`
  );
  diag("scheduler", "restore_schedules", {
    meta: { active_plans: plans.length, active_strategies: strategies.length },
  });
}

// ── Failure handler helper ────────────────────────────────────────────────────

async function handleFailure(
  plan: Plan,
  reason: string,
  notifyMsg: string | null
): Promise<void> {
  // Send notification
  if (notifyMsg && notifyUser) {
    try {
      await notifyUser(plan.telegram_id, null, notifyMsg);
      await logNotification(plan.id, `failure:${reason}`, true, notifyMsg);
    } catch (notifyErr) {
      console.error(`[SCHEDULER] Failed to notify user ${plan.telegram_id}:`, notifyErr);
      await logNotification(plan.id, `failure:${reason}`, false, notifyMsg,
        notifyErr instanceof Error ? notifyErr.message : String(notifyErr));
    }
  }

  // Increment consecutive failures
  const failures = await incrementConsecutiveFailures(plan.id).catch(() => 1);
  console.log(
    `[SCHEDULER] Plan ${plan.id} failure #${failures} (${reason}), threshold=${AUTO_PAUSE_THRESHOLD}`
  );

  // Auto-pause after 3 consecutive failures
  if (failures >= AUTO_PAUSE_THRESHOLD) {
    await updatePlan(plan.telegram_id, { active: false }).catch(() => {});
    console.warn(`[SCHEDULER] Plan ${plan.id} auto-paused after ${failures} consecutive failures`);

    if (notifyAutoPaused) {
      const pauseMsg = `⏸ *Strategy Auto-Paused*\n\nAfter ${failures} consecutive failures (${reason}), your strategy has been paused.\n\nUse /resume to restart after topping up.`;
      try {
        await notifyAutoPaused(plan.telegram_id, reason);
        await logNotification(plan.id, "auto_paused", true, pauseMsg);
      } catch (err) {
        await logNotification(plan.id, "auto_paused", false, pauseMsg,
          err instanceof Error ? err.message : String(err));
      }
    }
  }
}

// ── Core execution loop ───────────────────────────────────────────────────────

async function checkAndExecute() {
  let duePlans: Plan[];
  try {
    duePlans = await getDuePlans();
  } catch (err) {
    console.error("[SCHEDULER] Failed to fetch due plans:", err);
    return;
  }

  if (duePlans.length === 0) return;
  console.log(`[SCHEDULER] Found ${duePlans.length} due plan(s)`);

  for (const plan of duePlans) {
    if (executing.has(plan.id)) {
      console.log(`[SCHEDULER] Plan ${plan.id} already executing, skipping`);
      continue;
    }

    executing.add(plan.id);

    const walletAddress =
      (await getUserDepositAddress(plan.telegram_id)) ?? String(plan.telegram_id);

    void (async () => {
      try {
        await walletQueue.add(walletAddress, async () => {
          console.log(`[SCHEDULER] Executing plan ${plan.id}${plan.demo_mode ? " [DEMO]" : ""}`);

          const preflight = await preflightCheck(plan);
          if (!preflight.ok) {
            if (preflight.reason === "missing_withdrawal_address") {
              if (preflight.userMessage && notifyUser) {
                try {
                  await notifyUser(plan.telegram_id, null, preflight.userMessage);
                  await logNotification(plan.id, "missing_withdrawal_address", true, preflight.userMessage);
                } catch (err) {
                  await logNotification(
                    plan.id,
                    "missing_withdrawal_address",
                    false,
                    preflight.userMessage,
                    err instanceof Error ? err.message : String(err)
                  );
                }
              }
              const nextDate = getNextExecutionDate(plan);
              await updatePlan(plan.telegram_id, { next_execution_at: nextDate.toISOString() });
              return;
            }

            if (!preflight.silent) {
              if (preflight.reason === "insufficient_usdt" && notifyInsufficientFunds && preflight.walletAddress) {
                try {
                  await notifyInsufficientFunds(
                    plan.telegram_id,
                    preflight.usdtBalance ?? 0,
                    plan.usdt_amount
                  );
                  if (preflight.userMessage) {
                    await logNotification(plan.id, "preflight_insufficient_usdt", true, preflight.userMessage);
                  }
                } catch (err) {
                  if (preflight.userMessage) {
                    await logNotification(plan.id, "preflight_insufficient_usdt", false,
                      preflight.userMessage, err instanceof Error ? err.message : String(err));
                  }
                }
              } else if (preflight.userMessage) {
                await handleFailure(plan, preflight.reason ?? "preflight", preflight.userMessage);
                const nextDate = getNextExecutionDate(plan);
                await updatePlan(plan.telegram_id, { next_execution_at: nextDate.toISOString() });
                return;
              }
            }

            const failures = await incrementConsecutiveFailures(plan.id).catch(() => 1);
            console.log(
              `[SCHEDULER] Plan ${plan.id} preflight failed: ${preflight.reason}, consecutive: ${failures}`
            );

            if (failures >= AUTO_PAUSE_THRESHOLD) {
              await updatePlan(plan.telegram_id, { active: false }).catch(() => {});
              console.warn(`[SCHEDULER] Plan ${plan.id} auto-paused after ${failures} consecutive preflight failures`);
              if (notifyAutoPaused) {
                try {
                  await notifyAutoPaused(plan.telegram_id, preflight.reason ?? "balance");
                  await logNotification(plan.id, "auto_paused", true);
                } catch {}
              }
            }

            const nextDate = getNextExecutionDate(plan);
            await updatePlan(plan.telegram_id, { next_execution_at: nextDate.toISOString() });
            return;
          }

          const nextDate = getNextExecutionDate(plan);
          await updatePlan(plan.telegram_id, { next_execution_at: nextDate.toISOString() });

          const result = await executeDcaCycle(plan);
          if (result.skipped) {
            console.log(`[SCHEDULER] Plan ${plan.id} skipped: ${result.reason}`);
            return;
          }
          console.log(`[SCHEDULER] Plan ${plan.id} done: status=${result.status}`);

          if (result.status !== "success") {
            const errMsg = result.failedStep
              ? `Failed at ${result.failedStep}`
              : "Cycle failed";
            await handleFailure(plan, "cycle_failed", errMsg);
            return;
          }

          await resetConsecutiveFailures(plan.id).catch(() => {});

          if (isQuickPlan(plan.demo_mode, plan.frequency)) {
            const updated = await getPlanByTelegramId(plan.telegram_id);
            const completed = updated?.cycles_completed ?? plan.cycles_completed;
            console.log(
              `[SCHEDULER] Demo plan ${plan.id}: cycle ${completed}/${plan.max_cycles ?? "∞"}`
            );

            if (plan.max_cycles !== null && completed >= plan.max_cycles) {
              await updatePlan(plan.telegram_id, { active: false });
              console.log(
                `[SCHEDULER] Demo plan ${plan.id} completed all ${plan.max_cycles} cycles — stopped`
              );
              if (notifyAllComplete) {
                const totalInvested = await getTotalInvested(plan.id).catch(() => 0);
                const lpBalance = result.lpTokensAdded > 0
                  ? result.lpTokensAdded.toFixed(4)
                  : "N/A";
                try {
                  await notifyAllComplete(plan.telegram_id, totalInvested, lpBalance);
                  await logNotification(plan.id, "all_cycles_complete", true);
                } catch (err) {
                  await logNotification(plan.id, "all_cycles_complete", false, undefined,
                    err instanceof Error ? err.message : String(err));
                }
              }
              return;
            }
          }

          if (notifyUser) {
            try {
              await notifyUser(plan.telegram_id, result);
              await logNotification(plan.id, "cycle_complete", true);
            } catch (err) {
              await logNotification(plan.id, "cycle_complete", false, undefined,
                err instanceof Error ? err.message : String(err));
            }
          }
        });
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          console.warn(
            `[SCHEDULER] Plan ${plan.id} — insufficient USDT: $${err.balance.toFixed(2)} < $${err.required}`
          );
          if (notifyInsufficientFunds) {
            try {
              await notifyInsufficientFunds(plan.telegram_id, err.balance, err.required);
            } catch {}
          }
          await handleFailure(plan, "insufficient_usdt", null);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[SCHEDULER] Plan ${plan.id} failed:`, msg);
          await handleFailure(plan, "execution_error", msg);
        }
      } finally {
        executing.delete(plan.id);
      }
    })();
  }
}

// ── Scheduler startup ─────────────────────────────────────────────────────────

export async function startScheduler(): Promise<void> {
  await restoreSchedules().catch((err) =>
    console.error("[SCHEDULER] restoreSchedules failed:", err)
  );

  if (IS_DEMO_MODE) {
    setInterval(checkAndExecute, DEV_DEMO_CYCLE_INTERVAL_MS);
    console.log(`[SCHEDULER] DEMO MODE — checking every ${DEV_DEMO_CYCLE_INTERVAL_MS / 1000}s`);
    return;
  }

  const cronExpr = IS_PRODUCTION ? "* * * * *" : "* * * * *";
  const label = IS_PRODUCTION ? "every minute" : "every minute (dev mode)";

  cron.schedule(cronExpr, checkAndExecute);
  console.log(`[SCHEDULER] Started — polling ${label}`);
}
