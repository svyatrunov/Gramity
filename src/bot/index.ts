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
import { handleSettings, handleSettingsCallback } from "./handlers/settings.js";
import {
  setNotifyUser,
  setNotifyInsufficientFunds,
  setNotifyAutoPaused,
  setNotifyAllComplete,
} from "../scheduler/index.js";
import { setPollerSender } from "./depositPoller.js";
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
bot.command("settings", handleSettings);

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📋 *Gramity*\n\n" +
      "/start — open Mini App\n" +
      "/status — portfolio & next cycle\n" +
      "/settings — amount, frequency, mode\n" +
      "/pause · /resume — control DCA\n" +
      "/withdraw — exit positions\n\n" +
      "_Run a cycle now from the Dashboard in the Mini App._",
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
    { command: "start",    description: "Open Mini App" },
    { command: "status",   description: "Portfolio & next cycle" },
    { command: "settings", description: "Amount, frequency, mode" },
    { command: "pause",    description: "Pause DCA" },
    { command: "resume",   description: "Resume DCA" },
    { command: "withdraw", description: "Withdraw funds" },
    { command: "help",     description: "Commands" },
  ]);

  bot.start({
    onStart: (info) => console.log(`[BOT] Started as @${info.username}`),
  });

  console.log("[BOT] Bot is running via long polling");
}
