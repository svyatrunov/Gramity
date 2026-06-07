import { Bot, session } from "grammy";
import type { GramityContext, UserSession } from "./session.js";
import { initialSession } from "./session.js";
import {
  handleStart,
  handleText,
  handleCallbackQuery,
} from "./handlers/start.js";
import { handleStatus } from "./handlers/status.js";
import { handlePause, handleResume } from "./handlers/pause.js";
import {
  handleWithdrawMenu,
  handleWithdrawUsdtConfirm,
  handleWithdrawAllConfirm,
} from "./handlers/withdraw.js";
import { handleReset, handleResetCallback } from "./handlers/reset.js";
import { handleSettings, handleSettingsCallback } from "./handlers/settings.js";
import { setNotifyUser, setNotifyInsufficientFunds } from "../scheduler/index.js";
import { setPollerSender, stopDepositPoller } from "./depositPoller.js";
import { setGasNotifier } from "../execution/index.js";
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
bot.command("withdraw", handleWithdrawMenu);
bot.command("reset", handleReset);
bot.command("settings", handleSettings);

bot.command("cancel", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (telegramId) stopDepositPoller(telegramId);

  const wasOnboarding = ctx.session.step !== "idle";
  ctx.session.step = "idle";

  await ctx.reply(
    wasOnboarding
      ? "❌ Настройка отменена.\n\nНажми /start когда будешь готов."
      : "Нет активного действия для отмены."
  );
});

bot.command("dev", async (ctx) => {
  ctx.session.devMode = !ctx.session.devMode;
  await ctx.reply(
    ctx.session.devMode
      ? "🔧 Dev mode ON — тестовые интервалы включены в меню частоты."
      : "🔧 Dev mode OFF — тестовые интервалы скрыты."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 *Команды Gramity*\n\n" +
      "/start — настройка или главное меню\n" +
      "/status — текущая позиция\n" +
      "/pause — пауза стратегии\n" +
      "/resume — возобновить\n" +
      "/reset — удалить стратегию\n" +
      "/withdraw — информация о выводе\n" +
      "/cancel — отменить текущее действие",
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
    await handleWithdrawMenu(ctx);
    return;
  }
  if (data === "withdraw_usdt_confirm") {
    await ctx.answerCallbackQuery();
    await handleWithdrawUsdtConfirm(ctx);
    return;
  }
  if (data === "withdraw_all_confirm") {
    await ctx.answerCallbackQuery();
    await handleWithdrawAllConfirm(ctx);
    return;
  }
  if (data === "withdraw_cancel") {
    await ctx.answerCallbackQuery();
    await ctx.reply("❌ Вывод отменён.");
    return;
  }
  if (data.startsWith("settings_")) {
    await ctx.answerCallbackQuery();
    await handleSettingsCallback(ctx, data.replace("settings_", ""));
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

// ─── Execution notification ───────────────────────────────────────────────────

async function sendExecutionNotification(
  telegramId: number,
  result: ExecutionResult | null,
  error?: string
) {
  try {
    if (!result || result.status === "failed") {
      await bot.api.sendMessage(
        telegramId,
        `⚠️ *Gramity — ошибка цикла*\n\n` +
          (error ? `Причина: ${error.slice(0, 200)}\n\n` : "") +
          `Средства в безопасности. Следующая попытка по расписанию.\n` +
          `/status — проверить позицию`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const isPartial = result.status === "partial";

    // Compact one-screen report
    const tonPrice =
      result.tonReceived > 0
        ? (result.usdtSpent / result.tonReceived).toFixed(2)
        : null;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 7);
    const nextStr = nextDate.toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
    });

    const headline = isPartial
      ? `⚡ Gramity выполнен частично`
      : `⚡ *Gramity сработал — $${result.usdtSpent.toFixed(0)} в пул*`;

    const lines = [
      headline,
      "",
      `💵 $${result.usdtSpent.toFixed(2)}${tonPrice ? ` → ${result.tonReceived.toFixed(3)} TON по $${tonPrice}` : " USDT потрачено"}`,
      result.tstonReceived > 0
        ? `🔒 ${result.tstonReceived.toFixed(3)} tsTON застейкано`
        : null,
      `🏊 LP позиция: ${result.lpPositionValue !== "N/A" ? `$${result.lpPositionValue}` : "обновляется..."}`,
      "",
      `⏰ Следующий цикл: ${nextStr}`,
    ]
      .filter(Boolean)
      .join("\n");

    const kb = new InlineKeyboard()
      .text("📊 Статус", "status_check")
      .text("⏸ Пауза", "pause");

    await bot.api.sendMessage(telegramId, lines, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  } catch (err) {
    console.error("[BOT] Failed to send notification:", err);
  }
}

// ─── Register callbacks with scheduler ────────────────────────────────────────

setNotifyUser(sendExecutionNotification);

setNotifyInsufficientFunds(async (telegramId, balance, required) => {
  try {
    await bot.api.sendMessage(
      telegramId,
      `⚠️ *Недостаточно USDT для цикла*\n\n` +
        `На депозите: $${balance.toFixed(2)}\n` +
        `Нужно: $${required.toFixed(2)}\n\n` +
        `Стратегия поставлена на паузу.\n` +
        `Пополни депозит и нажми /resume`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[BOT] Failed to send insufficient funds notification:", err);
  }
});

// ─── Inject Telegram sender into deposit poller (no circular dep) ─────────────

setPollerSender(async (chatId, text, extra) => {
  await bot.api.sendMessage(chatId, text, extra as any);
});

// ─── Inject gas warning notifier ──────────────────────────────────────────────

setGasNotifier(async (telegramId, msg) => {
  try {
    await bot.api.sendMessage(telegramId, msg, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[BOT] Failed to send gas warning:", err);
  }
});

// ─── Bot startup ──────────────────────────────────────────────────────────────

export async function startBot() {
  await bot.api.setMyCommands([
    { command: "start", description: "Настройка или главное меню" },
    { command: "status", description: "Текущая позиция" },
    { command: "pause", description: "Пауза стратегии" },
    { command: "resume", description: "Возобновить стратегию" },
    { command: "settings", description: "Настройки стратегии" },
    { command: "withdraw", description: "Вывод средств" },
    { command: "reset", description: "Удалить стратегию" },
    { command: "cancel", description: "Отменить текущее действие" },
    { command: "help", description: "Помощь" },
  ]);

  bot.start({
    onStart: (info) => console.log(`[BOT] Started as @${info.username}`),
  });

  console.log("[BOT] Bot is running via long polling");
}
