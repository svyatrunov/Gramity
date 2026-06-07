import { Bot, session } from "grammy";
import type { GramityContext, UserSession } from "./session.js";
import { initialSession } from "./session.js";
import {
  handleStart,
  handleText,
  handleCallbackQuery,
} from "./handlers/start.js";
import { handleStatus } from "./handlers/status.js";
import { handlePause, handleResume, handleWithdrawInfo } from "./handlers/pause.js";
import { handleReset, handleResetCallback } from "./handlers/reset.js";
import { setNotifyUser } from "../scheduler/index.js";
import { BOT_TOKEN } from "../config.js";
import type { ExecutionResult } from "../execution/index.js";
import { InlineKeyboard } from "grammy";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not set in environment");

export const bot = new Bot<GramityContext>(BOT_TOKEN);

// ─── Session middleware ────────────────────────────────────────────────────────

bot.use(
  session<UserSession, GramityContext>({
    initial: initialSession,
  })
);

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", handleStart);
bot.command("status", handleStatus);
bot.command("pause", handlePause);
bot.command("resume", handleResume);
bot.command("withdraw", handleWithdrawInfo);
bot.command("reset", handleReset);

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 *Команды Gramity*\n\n" +
      "/start — настройка или статус\n" +
      "/status — текущая позиция\n" +
      "/pause — пауза стратегии\n" +
      "/resume — возобновить\n" +
      "/withdraw — информация о выводе",
    { parse_mode: "Markdown" }
  );
});

// ─── Callbacks ────────────────────────────────────────────────────────────────

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  if (data === "pause") {
    await ctx.answerCallbackQuery();
    await handlePause(ctx);
    return;
  }
  if (data === "resume") {
    await ctx.answerCallbackQuery();
    await handleResume(ctx);
    return;
  }
  if (data === "withdraw") {
    await ctx.answerCallbackQuery();
    await handleWithdrawInfo(ctx);
    return;
  }
  if (data === "status_check") {
    await ctx.answerCallbackQuery();
    await handleStatus(ctx);
    return;
  }
  if (data === "confirm_reset") {
    await ctx.answerCallbackQuery();
    await handleResetCallback(ctx, "confirm");
    return;
  }
  if (data === "cancel_reset") {
    await ctx.answerCallbackQuery();
    await handleResetCallback(ctx, "cancel");
    return;
  }

  // /start onboarding flow callbacks
  await handleCallbackQuery(ctx);
});

// ─── Text messages ─────────────────────────────────────────────────────────────

bot.on("message:text", handleText);

// ─── Error handler ────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("[BOT] Error:", err.message);
});

// ─── Execution notification sender ────────────────────────────────────────────

async function sendExecutionNotification(
  telegramId: number,
  result: ExecutionResult | null,
  error?: string
) {
  try {
    if (!result || result.status === "failed") {
      await bot.api.sendMessage(
        telegramId,
        `⚠️ *Gramity — ошибка выполнения*\n\n` +
          `Не удалось выполнить стратегию.\n` +
          (error ? `Причина: ${error.slice(0, 200)}\n\n` : "\n") +
          `Средства в безопасности. Следующая попытка через расписание.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 7);
    const nextStr = nextDate.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
    });

    const tonPriceApprox =
      result.tonReceived > 0
        ? (result.usdtSpent / result.tonReceived).toFixed(2)
        : "N/A";

    const statusLabel =
      result.status === "partial" ? "⚡ частично" : "⚡ Gramity сработал";

    const kb = new InlineKeyboard()
      .text("📊 Статус", "status_check")
      .text("⏸ Пауза", "pause")
      .text("💸 Вывести", "withdraw");

    await bot.api.sendMessage(
      telegramId,
      `${statusLabel}\n\n` +
        `Потрачено: $${result.usdtSpent.toFixed(2)} USDT\n` +
        `Куплено: ${result.tonReceived.toFixed(4)} TON по $${tonPriceApprox}\n` +
        `Застейкано: ${(result.tonReceived / 2).toFixed(4)} TON → ${result.tstonReceived.toFixed(4)} tsTON\n` +
        `Добавлено в пул: tsTON + TON ✅\n\n` +
        `📊 *Твоя позиция*\n` +
        `LP позиция: $${result.lpPositionValue}\n` +
        `Текущий APY: ~${result.apy7d !== "N/A" ? (5 + Number(result.apy7d)).toFixed(1) : "8.0"}%\n\n` +
        `⏰ Следующий запуск: ${nextStr}`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
  } catch (err) {
    console.error("[BOT] Failed to send notification:", err);
  }
}

// Register notification handler with scheduler
setNotifyUser(sendExecutionNotification);

export async function startBot() {
  await bot.api.setMyCommands([
    { command: "start", description: "Настройка или главное меню" },
    { command: "status", description: "Текущая позиция" },
    { command: "pause", description: "Пауза стратегии" },
    { command: "resume", description: "Возобновить стратегию" },
    { command: "withdraw", description: "Информация о выводе" },
    { command: "reset", description: "Удалить стратегию" },
    { command: "help", description: "Помощь" },
  ]);

  bot.start({
    onStart: (info) =>
      console.log(`[BOT] Started as @${info.username}`),
  });

  console.log("[BOT] Bot is running via long polling");
}
