/**
 * /settings — strategy mode, amount, frequency, withdrawal wallet.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../context.js";
import { botTgId, writeState } from "../state.js";
import {
  getPlanByTelegramId,
  updatePlan,
  type Plan,
} from "../../db/index.js";
import { getNextPlanExecutionDate, MIN_DCA_USDT } from "../../constants/dca.js";

const MODE_LABELS: Record<string, string> = {
  full:       "Full (swap + staking + LP)",
  stake_only: "Staking only (no LP)",
  accumulate: "TON only (no staking, no LP)",
};

const FREQ_LABELS: Record<string, string> = {
  weekly:   "Weekly",
  biweekly: "Every 2 weeks",
  monthly:  "Monthly",
  daily:    "Daily",
  minutely: "Every minute (test)",
  hourly:   "Every hour (test)",
};

export async function handleSettings(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("No active strategy.\nUse /start to set up Gramity.");
    return;
  }

  await showSettingsMenu(ctx, plan);
}

async function showSettingsMenu(ctx: GramityContext, plan: Plan) {
  const mode = plan.strategy_mode ?? "full";
  const freq = plan.frequency;

  const kb = new InlineKeyboard()
    .text("Change strategy", "settings_mode")
    .row()
    .text("Change amount", "settings_amount")
    .row()
    .text("Change frequency", "settings_freq")
    .row()
    .text("Withdrawal wallet", "settings:wallet")
    .row()
    .text("Withdraw USDT", "withdraw");

  await ctx.reply(
    `Settings\n\n` +
      `Mode       *${MODE_LABELS[mode] ?? mode}*\n` +
      `Amount     *$${plan.usdt_amount}* per cycle\n` +
      `Frequency  *${FREQ_LABELS[freq] ?? freq}*\n\n` +
      `Choose what to change:`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleSettingsCallback(ctx: GramityContext, action: string) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("Strategy not found.");
    return;
  }

  if (action === "mode") {
    const current = plan.strategy_mode ?? "full";
    const kb = new InlineKeyboard()
      .text(
        `${current === "full" ? "✅ " : ""}Full (LP + staking)`,
        "settings_set_mode_full"
      )
      .row()
      .text(
        `${current === "stake_only" ? "✅ " : ""}Staking only`,
        "settings_set_mode_stake_only"
      )
      .row()
      .text(
        `${current === "accumulate" ? "✅ " : ""}TON only`,
        "settings_set_mode_accumulate"
      )
      .row()
      .text("← Back", "settings_back");

    await ctx.reply(
      `Strategy mode\n\n` +
        `• *Full* — swap USDT→TON, stake→tsTON, add to STON.fi LP (~5.4% APY)\n` +
        `• *Staking only* — swap USDT→TON, stake→tsTON. No LP risk (~5% APY)\n` +
        `• *TON only* — swap USDT→TON, accumulate in wallet\n\n` +
        `Current: *${MODE_LABELS[current] ?? current}*`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    return;
  }

  if (action.startsWith("set_mode_")) {
    const newMode = action.replace("set_mode_", "") as "full" | "stake_only" | "accumulate";
    await updatePlan(telegramId, { strategy_mode: newMode });
    await ctx.reply(
      `✅ Strategy changed to *${MODE_LABELS[newMode] ?? newMode}*\n\n` +
        `Takes effect on the next cycle.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "amount") {
    const tid = botTgId(ctx);
    if (tid) await writeState(tid, { step: "waiting_settings_amount" });
    await ctx.reply(
      `Enter new amount per cycle in USDT (min $${MIN_DCA_USDT}, e.g. \`50\`)`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "freq") {
    const kb = new InlineKeyboard()
      .text("Weekly", "settings_set_freq_weekly")
      .row()
      .text("Every 2 weeks", "settings_set_freq_biweekly")
      .row()
      .text("Monthly", "settings_set_freq_monthly")
      .row()
      .text("← Back", "settings_back");

    if (process.env.NODE_ENV !== "production") {
      kb.row()
        .text("1 min (test)", "settings_set_freq_minutely")
        .text("1 hour (test)", "settings_set_freq_hourly");
    }

    await ctx.reply("Choose new frequency:", { reply_markup: kb });
    return;
  }

  if (action.startsWith("set_freq_")) {
    const newFreq = action.replace("set_freq_", "") as Plan["frequency"];
    const next = getNextPlanExecutionDate({ ...plan, frequency: newFreq });
    await updatePlan(telegramId, {
      frequency: newFreq,
      next_execution_at: next.toISOString(),
    });
    await ctx.reply(
      `✅ Frequency changed to: *${FREQ_LABELS[newFreq] ?? newFreq}*\n\n` +
        `Next scheduled cycle: ${next.toUTCString()}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "back") {
    await showSettingsMenu(ctx, plan);
  }
}

export async function handleSettingsAmountInput(ctx: GramityContext, text: string) {
  const tid = botTgId(ctx);
  if (!tid) return;
  const telegramId = Number(tid);

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await writeState(tid, { step: "idle" });
    await ctx.reply("Strategy not found.");
    return;
  }

  const amount = parseFloat(text.replace(",", ".").replace(/[^0-9.]/g, ""));
  if (isNaN(amount) || amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Minimum per cycle is $${MIN_DCA_USDT} USDT. Try again:`, {
      parse_mode: "Markdown",
    });
    return;
  }

  await updatePlan(telegramId, { usdt_amount: amount });
  await writeState(tid, { step: "idle" });

  await ctx.reply(
    `✅ Amount updated to *$${amount}* per cycle.\n\n` +
      `Takes effect on the next cycle.\n` +
      `Run a cycle from the Dashboard in the Mini App.`,
    { parse_mode: "Markdown" }
  );
}
