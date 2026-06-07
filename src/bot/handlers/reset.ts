import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId, deletePlan } from "../../db/index.js";

export async function handleReset(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "У тебя нет активной стратегии.\n\nИспользуй /start чтобы создать новую."
    );
    return;
  }

  const kb = new InlineKeyboard()
    .text("🗑 Да, удалить", "confirm_reset")
    .text("❌ Отмена", "cancel_reset");

  await ctx.reply(
    `⚠️ *Удалить стратегию?*\n\n` +
      `Сумма: $${plan.usdt_amount} | ${plan.frequency}\n\n` +
      `Средства в пуле остаются — это только удаляет план из Gramity.\n` +
      `Для вывода средств из LP используй /withdraw`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleResetCallback(ctx: GramityContext, action: "confirm" | "cancel") {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === "cancel") {
    await ctx.editMessageText("❌ Удаление отменено.");
    return;
  }

  try {
    await deletePlan(telegramId);
    ctx.session.step = "idle";
    await ctx.editMessageText(
      "✅ Стратегия удалена.\n\nИспользуй /start чтобы создать новую."
    );
  } catch (err) {
    await ctx.editMessageText(
      `❌ Ошибка: ${err instanceof Error ? err.message : "unknown"}`
    );
  }
}
