/**
 * Gramity Scheduler — checks due plans every 5 minutes and executes strategy
 */

import cron from "node-cron";
import { getDuePlans, updatePlan } from "../db/index.js";
import { executeStrategy, type ExecutionResult } from "../execution/index.js";

// Injected by bot/index.ts after bot starts
let notifyUser: ((telegramId: number, result: ExecutionResult | null, error?: string) => Promise<void>) | null = null;

export function setNotifyUser(
  fn: (telegramId: number, result: ExecutionResult | null, error?: string) => Promise<void>
) {
  notifyUser = fn;
}

function getNextExecutionDate(frequency: string): Date {
  const next = new Date();
  if (frequency === "minutely") next.setMinutes(next.getMinutes() + 1);
  else if (frequency === "hourly") next.setHours(next.getHours() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);
  return next;
}

// Track plans currently executing to avoid double-runs
const executing = new Set<string>();

async function checkAndExecute() {
  let duePlans;
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

    // Fire and forget — don't block cron loop
    (async () => {
      try {
        console.log(`[SCHEDULER] Executing plan ${plan.id}`);

        // Advance next_execution_at immediately to prevent duplicate runs
        const nextDate = getNextExecutionDate(plan.frequency);
        await updatePlan(plan.telegram_id, {
          next_execution_at: nextDate.toISOString(),
        });

        const result = await executeStrategy(plan);
        console.log(
          `[SCHEDULER] Plan ${plan.id} done: status=${result.status}`
        );

        if (notifyUser) {
          await notifyUser(plan.telegram_id, result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SCHEDULER] Plan ${plan.id} failed:`, msg);

        if (notifyUser) {
          await notifyUser(plan.telegram_id, null, msg);
        }
      } finally {
        executing.delete(plan.id);
      }
    })();
  }
}

export function startScheduler() {
  const isProd = process.env.NODE_ENV === "production";
  const cronExpr = isProd ? "*/5 * * * *" : "* * * * *";
  const label = isProd ? "every 5 minutes" : "every minute (dev mode)";

  cron.schedule(cronExpr, checkAndExecute);
  console.log(`[SCHEDULER] Started — checking ${label}`);
}
