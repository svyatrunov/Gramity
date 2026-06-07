/**
 * /settings — strategy mode, amount, frequency management.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId, updatePlan, type Plan } from "../../db/index.js";

const MODE_LABELS: Record<string, string> = {
  full: "Полная (своп + стейкинг + LP)",
  stake_only: "Только стейкинг (без LP)",
  accumulate: "Только TON (без стейкинга и LP)",
};

const FREQ_LABELS: Record<string, string> = {
  weekly: "Еженедельно",
  biweekly: "Раз в 2 нед.",
  monthly: "Раз в месяц",
  minutely: "Каждую минуту (тест)",
  hourly: "Каждый час (тест)",
};

export async function handleSettings(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply(
      "У тебя нет активной стратегии.\nНажми /start чтобы настроить Gramity."
    );
    return;
  }

  await showSettingsMenu(ctx, plan);
}

async function showSettingsMenu(ctx: GramityContext, plan: Plan) {
  const mode = plan.strategy_mode ?? "full";
  const freq = plan.frequency;

  const kb = new InlineKeyboard()
    .text("🔄 Сменить стратегию", "settings_mode")
    .row()
    .text("💰 Сменить сумму", "settings_amount")
    .row()
    .text("⏱ Сменить частоту", "settings_freq");

  await ctx.reply(
    `⚙️ *Настройки стратегии*\n\n` +
      `Режим: *${MODE_LABELS[mode] ?? mode}*\n` +
      `Сумма: *$${plan.usdt_amount}* за цикл\n` +
      `Частота: *${FREQ_LABELS[freq] ?? freq}*\n\n` +
      `Выбери что изменить:`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleSettingsCallback(
  ctx: GramityContext,
  action: string
) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Стратегия не найдена.");
    return;
  }

  if (action === "mode") {
    const current = plan.strategy_mode ?? "full";
    const kb = new InlineKeyboard()
      .text(
        `${current === "full" ? "✅ " : ""}Полная (LP + стейкинг)`,
        "settings_set_mode_full"
      )
      .row()
      .text(
        `${current === "stake_only" ? "✅ " : ""}Только стейкинг`,
        "settings_set_mode_stake_only"
      )
      .row()
      .text(
        `${current === "accumulate" ? "✅ " : ""}Только TON`,
        "settings_set_mode_accumulate"
      )
      .row()
      .text("← Назад", "settings_back");

    await ctx.reply(
      `🔄 *Режим стратегии*\n\n` +
        `• *Полная* — своп USDT→TON, стейкинг→tsTON, добавление в пул STON.fi (~8% APY)\n` +
        `• *Только стейкинг* — своп USDT→TON, стейкинг→tsTON. Без LP, без риска непост. потерь (~5% APY)\n` +
        `• *Только TON* — только своп USDT→TON, копить в кошельке\n\n` +
        `Текущий: *${MODE_LABELS[current] ?? current}*`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    return;
  }

  if (action.startsWith("set_mode_")) {
    const newMode = action.replace("set_mode_", "") as
      | "full"
      | "stake_only"
      | "accumulate";
    await updatePlan(telegramId, { strategy_mode: newMode });
    await ctx.reply(
      `✅ Стратегия изменена на *${MODE_LABELS[newMode] ?? newMode}*\n\n` +
        `Вступит в силу на следующем цикле.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "amount") {
    ctx.session.step = "waiting_custom_amount";
    await ctx.reply(
      `💰 Введи новую сумму за цикл в USDT (например: \`50\`)`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "freq") {
    const kb = new InlineKeyboard()
      .text("📅 Еженедельно", "settings_set_freq_weekly")
      .row()
      .text("🗓 Раз в 2 нед.", "settings_set_freq_biweekly")
      .row()
      .text("📆 Раз в месяц", "settings_set_freq_monthly")
      .row()
      .text("← Назад", "settings_back");

    if (ctx.session.devMode || process.env.NODE_ENV !== "production") {
      kb.row()
        .text("⚡ 1 мин (тест)", "settings_set_freq_minutely")
        .text("🕐 1 час (тест)", "settings_set_freq_hourly");
    }

    await ctx.reply("⏱ Выбери новую частоту:", { reply_markup: kb });
    return;
  }

  if (action.startsWith("set_freq_")) {
    const newFreq = action.replace("set_freq_", "") as Plan["frequency"];
    await updatePlan(telegramId, { frequency: newFreq });
    await ctx.reply(
      `✅ Частота изменена: *${FREQ_LABELS[newFreq] ?? newFreq}*`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (action === "back") {
    await showSettingsMenu(ctx, plan);
  }
}
