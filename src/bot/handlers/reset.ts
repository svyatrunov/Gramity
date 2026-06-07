import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId, deletePlan } from "../../db/index.js";

export async function handleReset(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "No active strategy.\n\nUse /start to create one."
    );
    return;
  }

  const kb = new InlineKeyboard()
    .text("🗑 Yes, delete", "confirm_reset")
    .text("❌ Cancel",     "cancel_reset");

  await ctx.reply(
    `⚠️ *Delete strategy?*\n\n` +
      `Amount: $${plan.usdt_amount} | ${plan.frequency}\n\n` +
      `Funds in the pool remain — this only removes the plan from Gramity.\n` +
      `To withdraw funds from LP use /withdraw`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleResetCallback(ctx: GramityContext, action: "confirm" | "cancel") {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === "cancel") {
    await ctx.editMessageText("❌ Deletion cancelled.");
    return;
  }

  try {
    await deletePlan(telegramId);
    ctx.session.step = "idle";
    await ctx.editMessageText(
      "✅ Strategy deleted.\n\nUse /start to create a new one."
    );
  } catch (err) {
    await ctx.editMessageText(
      `❌ Error: ${err instanceof Error ? err.message : "unknown"}`
    );
  }
}
