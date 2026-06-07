import type { GramityContext } from "../session.js";
import { getPlanByTelegramId, updatePlan } from "../../db/index.js";

export async function handlePause(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "У тебя нет активной стратегии. Используй /start для настройки."
    );
    return;
  }

  if (!plan.active) {
    await ctx.reply(
      "⏸ Стратегия уже на паузе.\n\n" +
        "Средства в пуле продолжают работать.\n" +
        "/resume — возобновить"
    );
    return;
  }

  await updatePlan(telegramId, { active: false });

  await ctx.reply(
    "⏸ Стратегия на паузе.\n\n" +
      "Средства в пуле продолжают работать.\n" +
      "/resume — возобновить"
  );
}

export async function handleResume(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "У тебя нет стратегии. Используй /start для настройки."
    );
    return;
  }

  if (plan.active) {
    await ctx.reply(
      "✅ Стратегия уже активна.\n\n" + "/status — посмотреть позицию"
    );
    return;
  }

  // Schedule next execution from now
  const next = new Date();
  if (plan.frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (plan.frequency === "biweekly") next.setDate(next.getDate() + 14);
  else next.setMonth(next.getMonth() + 1);

  await updatePlan(telegramId, {
    active: true,
    next_execution_at: next.toISOString(),
  });

  await ctx.reply(
    "▶️ Стратегия возобновлена!\n\n" + "/status — посмотреть позицию"
  );
}
