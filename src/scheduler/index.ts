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

import cron from "node-cron";
import {
  getDuePlans,
  getPlanByTelegramId,
  updatePlan,
  incrementConsecutiveFailures,
  resetConsecutiveFailures,
  logNotification,
  getTotalInvested,
} from "../db/index.js";
import { InsufficientFundsError, type ExecutionResult } from "../execution/index.js";
import { executeDcaCycle } from "../execution/cycle.js";
import { preflightCheck } from "../execution/preflight.js";
import type { Plan } from "../db/index.js";
import { getNextPlanExecutionDate, isQuickPlan } from "../constants/dca.js";

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

    // Fire-and-forget — don't block cron loop
    (async () => {
      try {
        console.log(`[SCHEDULER] Executing plan ${plan.id}${plan.demo_mode ? " [DEMO]" : ""}`);

        // ── 1. Pre-flight check ──────────────────────────────────────────────
        const preflight = await preflightCheck(plan);
        if (!preflight.ok) {
          if (!preflight.silent) {
            // Specific notifications for gas vs USDT
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
              return;
            }
          }

          // Increment failures for non-silent preflight failures
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
          return;
        }

        // ── 2. Advance next_execution_at (prevents duplicate runs) ──────────
        const nextDate = getNextExecutionDate(plan);
        await updatePlan(plan.telegram_id, { next_execution_at: nextDate.toISOString() });

        // ── 3. Execute full DCA cycle (logged to cycles table) ─────────────────
        const result = await executeDcaCycle(plan);
        console.log(`[SCHEDULER] Plan ${plan.id} done: status=${result.status}`);

        if (result.status !== "success") {
          const errMsg = result.failedStep
            ? `Failed at ${result.failedStep}`
            : "Cycle failed";
          await handleFailure(plan, "cycle_failed", errMsg);
          return;
        }

        // ── 4. Reset failure counter on successful execution ───────────────────
        await resetConsecutiveFailures(plan.id).catch(() => {});

        // ── 5. Demo / max_cycles handling ────────────────────────────────────
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
            // "All cycles complete" notification
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

        // ── 6. Notify user of successful cycle ───────────────────────────────
        if (notifyUser) {
          try {
            await notifyUser(plan.telegram_id, result);
            await logNotification(plan.id, "cycle_complete", true);
          } catch (err) {
            await logNotification(plan.id, "cycle_complete", false, undefined,
              err instanceof Error ? err.message : String(err));
          }
        }
      } catch (err) {
        // ── Top-level error handler ────────────────────────────────────────
        if (err instanceof InsufficientFundsError) {
          console.warn(
            `[SCHEDULER] Plan ${plan.id} — insufficient USDT safety-net: $${err.balance.toFixed(2)} < $${err.required}`
          );
          if (notifyInsufficientFunds) {
            try {
              await notifyInsufficientFunds(plan.telegram_id, err.balance, err.required);
            } catch {}
          }
          await handleFailure(plan, "insufficient_usdt", null); // already notified above
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

export function startScheduler() {
  if (IS_DEMO_MODE) {
    setInterval(checkAndExecute, DEV_DEMO_CYCLE_INTERVAL_MS);
    console.log(`[SCHEDULER] DEMO MODE — checking every ${DEV_DEMO_CYCLE_INTERVAL_MS / 1000}s`);
    return;
  }

  const isProd = process.env.NODE_ENV === "production";
  const cronExpr = isProd ? "*/5 * * * *" : "* * * * *";
  const label = isProd ? "every 5 minutes" : "every minute (dev mode)";

  cron.schedule(cronExpr, checkAndExecute);
  console.log(`[SCHEDULER] Started — checking ${label}`);
}
