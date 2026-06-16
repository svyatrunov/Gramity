import type { GramityContext } from "../context.js";
import { getPlanByTelegramId, updatePlan } from "../../db/index.js";
import { getNextPlanExecutionDate } from "../../constants/dca.js";

export async function handlePause(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply("No active strategy. Use /start to set one up.");
    return;
  }

  if (!plan.active) {
    await ctx.reply(
      "Strategy is already paused.\n\n" +
        "Funds in the pool keep working.\n" +
        "/resume — resume strategy"
    );
    return;
  }

  await updatePlan(telegramId, { active: false });

  await ctx.reply(
    "Strategy paused.\n\n" +
      "Funds in the pool keep working.\n" +
      "/resume — resume strategy"
  );
}

export async function handleResume(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply("No strategy found. Use /start to set one up.");
    return;
  }

  if (plan.active) {
    await ctx.reply("✅ Strategy is already active.\n\n/status — view position");
    return;
  }

  const next = getNextPlanExecutionDate(plan);

  await updatePlan(telegramId, {
    active: true,
    next_execution_at: next.toISOString(),
  });

  await ctx.reply("Strategy resumed.\n\n/status — view position");
}
