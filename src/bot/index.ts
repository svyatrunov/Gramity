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
  handleWithdrawCancel,
} from "./handlers/withdraw.js";
import { handleSettings, handleSettingsCallback } from "./handlers/settings.js";
import {
  awaitingWalletData,
  handleSettingsWallet,
  handleChainSelected,
} from "./handlers/withdrawalWallet.js";
import type { WithdrawalChain } from "../constants/chains.js";
import { getPlanByTelegramId } from "../db/index.js";
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
import { hasWithdrawalAddress } from "../utils/tonAddress.js";

const dashboardUrl = `${RAILWAY_PUBLIC_URL}/app/dashboard.html`;
const depositUrl   = `${RAILWAY_PUBLIC_URL}/app/dashboard.html?tab=deposit`;
const settingsUrl  = `${RAILWAY_PUBLIC_URL}/app/dashboard.html?tab=more`;

function failureWebAppButton(error?: string): { label: string; url: string } {
  const err = (error ?? "").toLowerCase();
  if (err.includes("withdrawal address") || err.includes("withdrawal wallet")) {
    return { label: "Set wallet", url: settingsUrl };
  }
  if (err.includes("low gas") || err.includes("⛽")) {
    return { label: "Top up gas", url: depositUrl };
  }
  return { label: "Status", url: dashboardUrl };
}

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
    "*Gramity*\n\n" +
      "/start — open Mini App\n" +
      "/status — portfolio and next cycle\n" +
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

  if (data.startsWith("wallet_chain:")) {
    await ctx.answerCallbackQuery();
    const chain = data.split(":")[1];
    if (chain === "back") {
      const telegramId = ctx.from?.id;
      if (telegramId) awaitingWalletData.delete(String(telegramId));
      const plan = telegramId
        ? await getPlanByTelegramId(telegramId).catch(() => null)
        : null;
      await handleSettingsWallet(ctx, plan);
      return;
    }
    await handleChainSelected(ctx, chain as WithdrawalChain);
    return;
  }
  if (data === "settings:wallet") {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from?.id;
    const plan = telegramId
      ? await getPlanByTelegramId(telegramId).catch(() => null)
      : null;
    await handleSettingsWallet(ctx, plan);
    return;
  }
  if (data === "settings_back") {
    await ctx.answerCallbackQuery();
    await handleSettings(ctx);
    return;
  }
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
  if (data === "withdraw:usdt:confirm" || data === "withdraw_usdt_confirm") {
    await ctx.answerCallbackQuery();
    await handleWithdrawUsdtConfirm(ctx);
    return;
  }
  if (data === "withdraw:cancel" || data === "withdraw_cancel") {
    await ctx.answerCallbackQuery();
    await handleWithdrawCancel(ctx);
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

      const { getPlanByTelegramId, setWithdrawalAddress } = await import("../db/index.js");
      const existingPlan = await getPlanByTelegramId(telegramId);

      if (existingPlan && hasWithdrawalAddress(existingPlan.ton_address)) {
        const { sanitizeLog } = await import("../utils/sanitizeLog.js");
        console.warn(
          "[web_app_data] Attempt to change locked withdrawal address",
          sanitizeLog({ telegramId, ton_address: friendlyAddress })
        );
        return;
      }

      // If in onboarding OR session was reset after deploy (step is idle/empty) → go to deposit step
      const isOnboarding =
        !ctx.session.step ||
        ctx.session.step === "idle" ||
        ctx.session.step === "waiting_wallet";

      if (isOnboarding) {
        await continueToDepositStep(ctx, friendlyAddress);
      } else if (existingPlan && !hasWithdrawalAddress(existingPlan.ton_address)) {
        const updated = await setWithdrawalAddress(telegramId, friendlyAddress);
        if (updated) {
          const { awaitingWalletData } = await import("./handlers/withdrawalWallet.js");
          awaitingWalletData.delete(String(telegramId));
          ctx.session.tonAddress = friendlyAddress;
          await ctx.reply(
            `✅ Withdrawal address set\n\n` +
              `\`${friendlyAddress.slice(0, 6)}...${friendlyAddress.slice(-4)}\`\n\n` +
              `Locked.`,
            { parse_mode: "Markdown" }
          );
        }
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
    // Resolve plan for cycle count (best-effort)
    let cyclesDone = 1;
    let totalCycles: number | null = null;
    try {
      const { getPlanByTelegramId } = await import("../db/index.js");
      const plan = await getPlanByTelegramId(telegramId);
      if (plan) {
        cyclesDone = plan.cycles_completed + 1;
        totalCycles = plan.max_cycles;
      }
    } catch { /* non-critical */ }

    // ── Failed cycle ───────────────────────────────────────────────────────
    if (!result || result.status === "failed") {
      const errText = error ?? result?.failedStep ?? "unknown error";
      const msg = result?.failedStep
        ? notify.stepFailed(result.failedStep, errText)
        : notify.cycleFailed(errText);
      const btn = failureWebAppButton(error);

      await bot.api.sendMessage(telegramId, msg, {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
        reply_markup: new InlineKeyboard().webApp(btn.label, btn.url),
      });
      return;
    }

    if (result.status === "partial") {
      const msg =
        `Cycle failed\n\n` +
        `Reason   partial — ${result.failedStep ?? "unknown step"}\n\n` +
        `$${result.usdtSpent.toFixed(2)} USDT swapped → ${result.tonReceived.toFixed(3)} TON`;

      await bot.api.sendMessage(telegramId, msg, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().webApp("Status", dashboardUrl),
      });
      return;
    }

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
      .webApp("View position", dashboardUrl)
      .text("Pause", "pause");

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
    const kb = new InlineKeyboard()
      .webApp("Deposit", depositUrl);

    await bot.api.sendMessage(
      telegramId,
      `Cycle skipped\n\n` +
        `Insufficient USDT on agent wallet.\n` +
        `Have     *$${balance.toFixed(2)}*\n` +
        `Required *$${required.toFixed(2)}*\n\n` +
        `Strategy paused. Top up and /resume`,
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
    await bot.api.sendMessage(telegramId, msg, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().webApp("Top up gas", depositUrl),
    });
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
