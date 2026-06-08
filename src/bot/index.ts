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
  handleWithdrawLpConfirm,
} from "./handlers/withdraw.js";
import { handleReset, handleResetCallback } from "./handlers/reset.js";
import { handleSettings, handleSettingsCallback } from "./handlers/settings.js";
import { handleHistory } from "./handlers/history.js";
import { handleTestCommand, handleTestRun } from "./handlers/test.js";
import {
  setNotifyUser,
  setNotifyInsufficientFunds,
  setNotifyAutoPaused,
  setNotifyAllComplete,
} from "../scheduler/index.js";
import { setPollerSender, stopDepositPoller } from "./depositPoller.js";
import { setGasNotifier } from "../execution/index.js";
import { BOT_TOKEN, RAILWAY_PUBLIC_URL } from "../config.js";
import type { ExecutionResult } from "../execution/index.js";
import { notify } from "./notifications.js";
import { InlineKeyboard } from "grammy";

const MINI_APP_URL = `${RAILWAY_PUBLIC_URL}/app`;

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

bot.command("demo", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  try {
    const { getPlanByTelegramId, upsertPlan } = await import("../db/index.js");
    const { createUserWallet } = await import("../services/userWallet.js");
    const { getNextPlanExecutionDate, formatPlanFrequency } = await import("../constants/dca.js");
    const { hasWithdrawalAddress } = await import("../utils/tonAddress.js");

    const existingPlan = await getPlanByTelegramId(telegramId).catch(() => null);
    if (!existingPlan || !hasWithdrawalAddress(existingPlan.ton_address)) {
      await ctx.reply(
        "⚠️ *No withdrawal address set*\n\n" +
          "Please complete onboarding first via /start to set your TON address.",
        { parse_mode: "Markdown" }
      );
      return;
    }
    const withdrawalAddress = existingPlan.ton_address;

    const frequency = "10s";
    const nextExec = getNextPlanExecutionDate({ frequency, demo_mode: true });
    const amount = 2;

    await upsertPlan({
      telegram_id:       telegramId,
      ton_address:       withdrawalAddress,
      agent_wallet:      null,
      usdt_amount:       amount,
      frequency,
      strategy_mode:     "full",
      active:            true,
      next_execution_at: nextExec.toISOString(),
      demo_mode:         true,
      cycles_completed:  0,
      max_cycles:        2,
    });

    await createUserWallet(telegramId);

    const freqLabel = formatPlanFrequency(frequency, true);
    await ctx.reply(
      "🚀 *Quick Start activated*\n\n" +
        `2 cycles × $${amount} USDT\n` +
        `Interval: ${freqLabel}\n` +
        `Withdrawal: \`${withdrawalAddress.slice(0, 8)}…${withdrawalAddress.slice(-6)}\`\n\n` +
        "Fund your agent wallet to begin.",
      { parse_mode: "Markdown" }
    );

    console.log(`[BOT] Quick Start plan created for user ${telegramId}`);
  } catch (err) {
    console.error("[BOT] /demo error:", err);
    await ctx.reply("❌ Failed to start Quick Start: " + (err instanceof Error ? err.message : "unknown error"));
  }
});

bot.command("test", handleTestCommand);

bot.command("help", async (ctx) => {  await ctx.reply(
    "📋 *Gramity Commands*\n\n" +
      "/start — setup or main menu\n" +
      "/status — current position\n" +
      "/test — 🧪 run 3 real DCA cycles immediately\n" +
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
  if (data === "withdraw_lp_confirm") {
    await ctx.answerCallbackQuery();
    await handleWithdrawLpConfirm(ctx);
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
  if (data === "test_run_confirm") {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    await handleTestRun(
      telegramId,
      (text, extra) => ctx.reply(text, extra as object).then(() => {})
    );
    return;
  }
  if (data === "test_cancel") {
    await ctx.answerCallbackQuery();
    await ctx.reply("Test cancelled.");
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
    // Resolve plan for dashboard deep-link and cycle count (best-effort)
    let planId: string | null = null;
    let cyclesDone = 1;
    let totalCycles: number | null = null;
    try {
      const { getPlanByTelegramId } = await import("../db/index.js");
      const plan = await getPlanByTelegramId(telegramId);
      if (plan) {
        planId = plan.id;
        cyclesDone = plan.cycles_completed + 1;
        totalCycles = plan.max_cycles;
      }
    } catch { /* non-critical */ }

    const dashboardUrl = planId
      ? `${MINI_APP_URL}/dashboard.html#strategy-${planId}`
      : `${MINI_APP_URL}/dashboard.html`;

    // ── Failed cycle ───────────────────────────────────────────────────────
    if (!result || result.status === "failed") {
      const errText = error ?? result?.failedStep ?? "unknown error";
      const msg = result?.failedStep
        ? notify.stepFailed(result.failedStep, errText)
        : notify.cycleFailed(errText);

      await bot.api.sendMessage(telegramId, msg, {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
        reply_markup: new InlineKeyboard().webApp("📊 View Dashboard", dashboardUrl),
      });
      return;
    }

    // ── Partial cycle ──────────────────────────────────────────────────────
    if (result.status === "partial") {
      const msg =
        `⚡ *Partial cycle — ${result.failedStep ?? "unknown step"} failed*\n\n` +
        `$${result.usdtSpent.toFixed(2)} USDT swapped → ${result.tonReceived.toFixed(3)} TON\n` +
        `Liquidity provision skipped.\n\n` +
        `Funds are safe. Next attempt is scheduled.\n/status — check position`;

      await bot.api.sendMessage(telegramId, msg, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().webApp("📊 View Dashboard", dashboardUrl),
      });
      return;
    }

    // ── Successful cycle — use notify.cycleComplete template ───────────────
    const msg = notify.cycleComplete({
      amountUsdt:    result.usdtSpent,
      tonAmount:     result.tonReceived,
      tsTonAmount:   result.tstonReceived,
      lpTokensAdded: result.lpTokensAdded,
      txSwap:        result.txSwap,
      txStake:       result.txStake,
      txLp:          result.txLp,
      cyclesDone,
      totalCycles,
    });

    const kb = new InlineKeyboard()
      .webApp("📊 Dashboard", dashboardUrl)
      .text("⏸ Pause", "pause");

    await bot.api.sendMessage(telegramId, msg, {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
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
    // Resolve deposit wallet address for deep-link (best-effort)
    let depositAddr: string | null = null;
    try {
      const { createUserWallet } = await import("../services/userWallet.js");
      depositAddr = await createUserWallet(telegramId);
    } catch { /* non-critical */ }

    const depositUrl = depositAddr
      ? `${MINI_APP_URL}/deposit.html?wallet=${encodeURIComponent(depositAddr)}`
      : `${MINI_APP_URL}/deposit.html`;

    const kb = new InlineKeyboard()
      .webApp("💰 Deposit Funds", depositUrl);

    await bot.api.sendMessage(
      telegramId,
      `⚠️ *Insufficient USDT for cycle*\n\n` +
        `On deposit: $${balance.toFixed(2)}\n` +
        `Required:   $${required.toFixed(2)}\n\n` +
        `Strategy paused.\n` +
        `Top up your deposit and tap /resume`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
  } catch (err) {
    console.error("[BOT] Failed to send insufficient funds notification:", err);
  }
});

// ─── Auto-paused after 3 consecutive failures ─────────────────────────────────

setNotifyAutoPaused(async (telegramId, reason) => {
  try {
    const msg = notify.autoPaused(reason);
    await bot.api.sendMessage(telegramId, msg, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[BOT] Failed to send auto-paused notification:", err);
  }
});

// ─── All DCA cycles complete ───────────────────────────────────────────────────

setNotifyAllComplete(async (telegramId, totalInvested, lpBalance) => {
  try {
    const msg = notify.allCyclesComplete(totalInvested, lpBalance);
    await bot.api.sendMessage(telegramId, msg, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("[BOT] Failed to send all-cycles-complete notification:", err);
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
    { command: "test",     description: "🧪 Run 3 real DCA cycles immediately" },
    { command: "demo",     description: "🎬 Run live demo (2 cycles × $7)" },
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
