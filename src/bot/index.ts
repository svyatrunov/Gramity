import { Bot, session } from "grammy";
import type { GramityContext, UserSession } from "./session.js";
import { initialSession } from "./session.js";
import {
  handleStart,
  handleText,
  handleCallbackQuery,
  continueToDepositStep,
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
import { handleHistory } from "./handlers/history.js";
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
bot.command("history", handleHistory);

bot.command("cancel", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (telegramId) stopDepositPoller(telegramId);

  const wasOnboarding = ctx.session.step !== "idle";
  ctx.session.step = "idle";

  await ctx.reply(
    wasOnboarding
      ? "❌ Setup cancelled.\n\nTap /start when you're ready."
      : "Nothing active to cancel."
  );
});

bot.command("dev", async (ctx) => {
  ctx.session.devMode = !ctx.session.devMode;
  await ctx.reply(
    ctx.session.devMode
      ? "🔧 Dev mode ON — test intervals enabled in frequency menu."
      : "🔧 Dev mode OFF — test intervals hidden."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 *Gramity Commands*\n\n" +
      "/start — setup or main menu\n" +
      "/status — current position\n" +
      "/pause — pause strategy\n" +
      "/resume — resume strategy\n" +
      "/reset — delete strategy\n" +
      "/withdraw — withdraw funds\n" +
      "/cancel — cancel current action",
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
    await ctx.reply("❌ Withdrawal cancelled.");
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

// ─── Web App Data (TonConnect wallet connection result) ───────────────────────

bot.on("message:web_app_data", async (ctx) => {
  try {
    const raw = ctx.message.web_app_data.data;
    console.log("[WebApp] Received data:", raw);

    const data = JSON.parse(raw) as {
      type?: string;
      address?: string;
      walletName?: string;
    };

    if (data.type === "wallet_connected" && data.address) {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      console.log(`[WebApp] Wallet connected for user ${telegramId}, step=${ctx.session.step}`);

      const { Address } = await import("@ton/ton");
      let friendlyAddress = data.address;
      try {
        friendlyAddress = Address.parseRaw(data.address).toString({
          bounceable: false,
          urlSafe: true,
        });
      } catch {
        // already in friendly format
        try {
          friendlyAddress = Address.parse(data.address).toString({
            bounceable: false,
            urlSafe: true,
          });
        } catch {
          // keep as is
        }
      }

      console.log(`[WebApp] Friendly address: ${friendlyAddress}`);

      // If in onboarding OR session was reset after deploy (step is idle/empty) → go to deposit step
      const isOnboarding =
        !ctx.session.step ||
        ctx.session.step === "idle" ||
        ctx.session.step === "waiting_wallet";

      if (isOnboarding) {
        await continueToDepositStep(ctx, friendlyAddress);
      } else {
        // Already has plan — update withdrawal address
        const { updatePlan } = await import("../db/index.js");
        await updatePlan(telegramId, { ton_address: friendlyAddress });
        ctx.session.tonAddress = friendlyAddress;

        await ctx.reply(
          `✅ *Wallet updated*\n\n` +
            `Withdrawal address:\n\`${friendlyAddress}\`\n\n` +
            (data.walletName ? `Wallet: ${data.walletName}\n\n` : "") +
            `Funds will be sent to this address on /withdraw.`,
          { parse_mode: "Markdown" }
        );
      }
    }
  } catch (err) {
    console.error("[WebApp] Failed to process web_app_data:", err);
  }
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
        `⚠️ *Gramity — cycle error*\n\n` +
          (error ? `Reason: ${error.slice(0, 200)}\n\n` : "") +
          `Funds are safe. Next attempt is scheduled.\n` +
          `/status — check position`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const isPartial = result.status === "partial";

    const tonPrice =
      result.tonReceived > 0
        ? (result.usdtSpent / result.tonReceived).toFixed(2)
        : null;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 7);
    const nextStr = nextDate.toLocaleDateString("en-US", {
      weekday: "short",
      day:     "numeric",
      month:   "short",
      timeZone: "UTC",
    });

    const headline = isPartial
      ? `⚡ Gramity executed partially`
      : `⚡ *DCA cycle complete — $${result.usdtSpent.toFixed(0)} deployed*`;

    const lines = [
      headline,
      "",
      `💵 $${result.usdtSpent.toFixed(2)}${tonPrice ? ` → ${result.tonReceived.toFixed(3)} TON @ $${tonPrice}` : " USDT spent"}`,
      result.tstonReceived > 0
        ? `🔒 ${result.tstonReceived.toFixed(3)} tsTON staked`
        : null,
      `🏊 LP position: ${result.lpPositionValue !== "N/A" ? `$${result.lpPositionValue}` : "updating..."}`,
      "",
      `⏰ Next cycle: ${nextStr}`,
    ]
      .filter(Boolean)
      .join("\n");

    const kb = new InlineKeyboard()
      .text("📊 Status", "status_check")
      .text("⏸ Pause",  "pause");

    await bot.api.sendMessage(telegramId, lines, {
      parse_mode:   "Markdown",
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
      `⚠️ *Insufficient USDT for cycle*\n\n` +
        `On deposit: $${balance.toFixed(2)}\n` +
        `Required:   $${required.toFixed(2)}\n\n` +
        `Strategy paused.\n` +
        `Top up your deposit and tap /resume`,
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
    { command: "start",    description: "Setup or main menu" },
    { command: "status",   description: "Current position" },
    { command: "pause",    description: "Pause strategy" },
    { command: "resume",   description: "Resume strategy" },
    { command: "settings", description: "Strategy settings" },
    { command: "withdraw", description: "Withdraw funds" },
    { command: "reset",    description: "Delete strategy" },
    { command: "cancel",   description: "Cancel current action" },
    { command: "history",  description: "Last 5 cycle history" },
    { command: "help",     description: "Help" },
  ]);

  bot.start({
    onStart: (info) => console.log(`[BOT] Started as @${info.username}`),
  });

  console.log("[BOT] Bot is running via long polling");
}
