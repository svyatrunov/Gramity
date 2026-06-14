/**
 * /start — shows Open App button (Mini App handles full onboarding).
 * Text-based fallback kept for edge cases / API-less environments.
 */

import { InlineKeyboard } from "grammy";
import { Address } from "@ton/ton";
import type { GramityContext } from "../context.js";
import { botTgId, readState, writeState } from "../state.js";
import { RAILWAY_PUBLIC_URL } from "../../config.js";
import { MIN_DCA_USDT } from "../../constants/dca.js";
import { getInitialPlanExecutionDate } from "../../constants/dca.js";
import {
  getPlanByTelegramId,
  getStrategiesByTelegramId,
  upsertPlan,
  type Plan,
} from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { createUserWallet } from "../../services/userWallet.js";
import {
  startDepositPoller,
  stopDepositPoller,
} from "../depositPoller.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTonAddress(input: string): string | null {
  const trimmed = input.trim();
  try {
    const addr = Address.parse(trimmed);
    return addr.toString({ urlSafe: true, bounceable: true });
  } catch {
    return null;
  }
}

function getNextCycleDate(frequency: string): Date {
  const next = new Date();
  if (frequency === "daily")        next.setDate(next.getDate() + 1);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else                              next.setDate(next.getDate() + 7); // weekly default
  return next;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

const FREQ_LABELS: Record<string, string> = {
  weekly:   "weekly",
  biweekly: "every 2 weeks",
  monthly:  "monthly",
  daily:    "daily",
  minutely: "every minute",
  hourly:   "every hour",
};

const TEST_FREQS = ["minutely", "hourly"];

function estimateYearlyUsd(weeklyAmount: number): number {
  return Math.round(weeklyAmount * 26 * 0.054);
}

// ─── /start command ───────────────────────────────────────────────────────────

export async function handleStart(ctx: GramityContext) {
  const tid = botTgId(ctx);
  if (!tid) return;
  const telegramId = Number(tid);

  const [existingPlan, strategies] = await Promise.all([
    getPlanByTelegramId(telegramId).catch(() => null),
    getStrategiesByTelegramId(telegramId).catch(() => []),
  ]);

  const hasAnyStrategy = existingPlan || strategies.length > 0;
  const appUrl = hasAnyStrategy
    ? `${RAILWAY_PUBLIC_URL}/app/dashboard.html`
    : `${RAILWAY_PUBLIC_URL}/app/onboarding.html`;

  if (existingPlan) {
    const statusLabel = existingPlan.active ? "Active" : "Paused";
    const freqLabel   = FREQ_LABELS[existingPlan.frequency] ?? existingPlan.frequency;
    const nextDate    = formatDate(new Date(existingPlan.next_execution_at));

    const kb = new InlineKeyboard()
      .webApp("Open app", appUrl)
      .text("Settings", "settings_back");

    await ctx.reply(
      `Gramity\n\n` +
        `Status     *${statusLabel}*\n` +
        `Strategy   *$${existingPlan.usdt_amount} USDT · ${freqLabel}*\n` +
        `Next       ${nextDate}`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    await writeState(tid, { step: "idle" });
    return;
  }

  // ── New user — Open App button ─────────────────────────────────────────────
  await writeState(tid, { step: "idle" });

  const kb = new InlineKeyboard()
    .webApp("Start setup", appUrl);

  await ctx.reply(
    `Automated DCA on TON.\n` +
      `Swap → stake → LP, hands-free.`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ─── Text message router ──────────────────────────────────────────────────────

export async function handleText(ctx: GramityContext) {
  const tid = botTgId(ctx);
  const text = ctx.message?.text?.trim() ?? "";
  if (!tid) return;

  if (text.startsWith("/")) {
    const { parseStrategyCommand, handlePauseStrategy, handleResumeStrategy, handleStopStrategy } =
      await import("./strategies.js");
    const cmd = parseStrategyCommand(text);
    if (cmd) {
      if (cmd.action === "pause") await handlePauseStrategy(ctx, cmd.id);
      else if (cmd.action === "resume") await handleResumeStrategy(ctx, cmd.id);
      else if (cmd.action === "stop") await handleStopStrategy(ctx, cmd.id);
      return;
    }
  }

  const telegramId = Number(tid);
  const { handleStrategyWalletInput, handleStrategyCustomAmount } =
    await import("./strategies.js");
  if (await handleStrategyWalletInput(ctx, text)) return;
  if (await handleStrategyCustomAmount(ctx, text)) return;

  const { handleAddressInput } = await import("./withdrawalWallet.js");
  if (await handleAddressInput(ctx, text)) return;

  const { step } = await readState(tid);

  if (step === "waiting_wallet") {
    await handleWalletInput(ctx, text);
  } else if (step === "waiting_deposit_confirm") {
    await handleDepositConfirm(ctx);
  } else if (step === "waiting_custom_amount") {
    await handleCustomAmount(ctx, text);
  } else if (step === "waiting_settings_amount") {
    const { handleSettingsAmountInput } = await import("./settings.js");
    await handleSettingsAmountInput(ctx, text);
  }
}

// ─── Step: wallet address input ───────────────────────────────────────────────

async function handleWalletInput(ctx: GramityContext, text: string) {
  const normalized = normalizeTonAddress(text);

  if (!normalized) {
    await ctx.reply(
      "❌ Invalid address format.\n\n" +
        "Open Tonkeeper → Receive → copy your wallet address.\n" +
        "Accepted formats: `EQ…`, `UQ…`, `0:abc123…`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await continueToDepositStep(ctx, normalized);
}

/**
 * Shared logic executed right after a TON address is confirmed — whether via
 * manual text input or the TonConnect mini-app.  Persists bot state to DB,
 * allocates the deposit wallet, starts the poller, and prompts the user to fund it.
 */
export async function continueToDepositStep(
  ctx: GramityContext,
  normalizedAddress: string
): Promise<void> {
  const tid = botTgId(ctx);
  if (!tid) return;
  const telegramId = Number(tid);

  const depositAddress = await createUserWallet(telegramId).catch(() => "unavailable");

  await writeState(tid, {
    tonAddress: normalizedAddress,
    step: "waiting_deposit_confirm",
    depositAddress,
  });

  startDepositPoller(telegramId, depositAddress);

  await ctx.reply(
    `✅ Wallet saved\n` +
      `\`${normalizedAddress.slice(0, 6)}…${normalizedAddress.slice(-4)}\`\n\n` +
      `*Fund your Gramity deposit address with USDT (on TON):*\n` +
      `\`${depositAddress}\`\n\n` +
      `Minimum: $${MIN_DCA_USDT} USDT\n\n` +
      `📡 I'm watching for your deposit and will notify you automatically.\n` +
      `You can tap the button right after sending 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("✅ Already sent", "deposit_done"),
    }
  );
}

// ─── Step: deposit confirmed ──────────────────────────────────────────────────

async function handleDepositConfirm(ctx: GramityContext) {
  const tid = botTgId(ctx);
  if (!tid) return;
  const telegramId = Number(tid);
  const state = await readState(tid);

  const depositAddress =
    state.depositAddress ??
    (await createUserWallet(telegramId).catch(() => ""));
  const balance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

  if (balance < 1) {
    await ctx.reply(
      `⏳ Currently seeing: $${balance.toFixed(2)} USDT on deposit.\n\n` +
        `Transactions take 1–2 min. Please wait a moment 🙏`
    );
    return;
  }

  stopDepositPoller(telegramId);
  await writeState(tid, {
    usdtBalance: balance,
    step: "waiting_amount",
  });
  await showAmountKeyboard(ctx, balance);
}

function buildAmountKeyboard(balance: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const presets = [10, 25, 50, 100] as const;
  const available = presets.filter((a) => a <= balance);

  for (const amt of available) {
    const yearly = estimateYearlyUsd(amt);
    kb.text(`$${amt}  (~$${yearly}/yr)`, `amount_${amt}`);
  }

  kb.row().text("✏️ Custom amount", "amount_custom");
  return kb;
}

async function showAmountKeyboard(ctx: GramityContext, balance: number) {
  await ctx.reply(
    `💰 *Received: ${balance.toFixed(2)} USDT* ✅\n\n` +
      `*How much to invest per cycle?*\n` +
      `Estimated return at ~5.4% APY (weekly, 1 year):`,
    { parse_mode: "Markdown", reply_markup: buildAmountKeyboard(balance) }
  );
}

async function handleCustomAmount(ctx: GramityContext, text: string) {
  const tid = botTgId(ctx);
  if (!tid) return;

  const amount = parseFloat(text.replace(",", ".").replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Minimum per cycle is $${MIN_DCA_USDT} USDT. Enter e.g.: \`30\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  await writeState(tid, { amount, step: "waiting_frequency" });
  await showFrequencyKeyboard(ctx);
}

// ─── Inline keyboard callbacks ────────────────────────────────────────────────

export async function handleCallbackQuery(ctx: GramityContext) {
  const data = ctx.callbackQuery?.data ?? "";
  const tid = botTgId(ctx);
  await ctx.answerCallbackQuery();

  if (data === "onboard_start") {
    const appUrl = `${RAILWAY_PUBLIC_URL}/app/onboarding.html`;
    const kb = new InlineKeyboard().webApp("🚀 Open App", appUrl);
    await ctx.reply(
      `Set up your DCA strategy in the Mini App 👇`,
      { reply_markup: kb }
    );
    return;
  }

  if (data === "deposit_done") {
    if (!tid) return;
    const telegramId = Number(tid);

    const plan = await getPlanByTelegramId(telegramId).catch(() => null);
    if (plan?.active) {
      const { handleRunNow } = await import("./runNow.js");
      await handleRunNow(
        telegramId,
        async (text, extra) => { await ctx.reply(text, extra as object); },
        1
      );
      return;
    }

    const state = await readState(tid);
    if (!state.tonAddress) {
      await ctx.reply("⚠️ Session expired.\n\nTap /start to begin again.");
      return;
    }
    await writeState(tid, { step: "waiting_deposit_confirm" });
    await handleDepositConfirm(ctx);
    return;
  }

  if (!tid) return;

  if (data.startsWith("amount_")) {
    const raw = data.slice(7);
    if (raw === "custom") {
      await writeState(tid, { step: "waiting_custom_amount" });
      await ctx.reply(`Enter amount in USDT (minimum $${MIN_DCA_USDT}):`);
    } else {
      await writeState(tid, {
        amount: Number(raw),
        step: "waiting_frequency",
      });
      await showFrequencyKeyboard(ctx);
    }
    return;
  }

  if (data.startsWith("freq_")) {
    const freq = data.slice(5) as
      | "weekly"
      | "biweekly"
      | "monthly"
      | "daily"
      | "minutely"
      | "hourly";

    const state = await readState(tid);
    if (!state.amount || !state.tonAddress) {
      await ctx.reply(
        "⚠️ Session expired (bot restarted).\n\nTap /start — takes 30 seconds."
      );
      await writeState(tid, { step: "idle" });
      return;
    }

    await writeState(tid, { frequency: freq, step: "confirming" });
    await showConfirmation(ctx);
    return;
  }

  if (data === "activate") {
    await handleActivate(ctx);
    return;
  }

  if (data === "edit_plan") {
    const state = await readState(tid);
    await writeState(tid, { step: "waiting_amount" });
    await showAmountKeyboard(ctx, state.usdtBalance ?? 0);
    return;
  }
}

async function showFrequencyKeyboard(ctx: GramityContext) {
  const kb = new InlineKeyboard()
    .text("📅 Weekly",        "freq_weekly")
    .text("🗓 Every 2 weeks", "freq_biweekly")
    .row()
    .text("📆 Monthly",       "freq_monthly");

  if (process.env.NODE_ENV !== "production") {
    kb.row()
      .text("⚡ 1 min (test)", "freq_minutely")
      .text("🕐 1 hour (test)", "freq_hourly");
  }

  await ctx.reply(
    `*Step 3/3 — Frequency*\n\n` +
      `How often should the strategy run?`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

async function showConfirmation(ctx: GramityContext) {
  const tid = botTgId(ctx);
  if (!tid) return;
  const { amount, frequency, tonAddress } = await readState(tid);
  if (!amount || !frequency || !tonAddress) return;

  const isTest    = TEST_FREQS.includes(frequency);
  const freqLabel = FREQ_LABELS[frequency] ?? frequency;
  const firstRunLine = isTest
    ? `⏰ First run: immediately after activation ⚡`
    : `⏰ First run: within 24 hours`;

  const yearly = estimateYearlyUsd(amount);

  const kb = new InlineKeyboard()
    .text("✅ Activate", "activate")
    .row()
    .text("✏️ Change amount", "edit_plan");

  await ctx.reply(
    `📋 *Your Gramity Strategy*\n\n` +
      `💵 $${amount} USDT ${freqLabel}\n` +
      `├─ Omniston: USDT → TON\n` +
      `├─ Tonstakers: TON → tsTON (~5% APY)\n` +
      `└─ STON.fi LP: tsTON + TON (~5.4% APY)\n\n` +
      `📈 Estimated return: ~$${yearly}/year\n` +
      firstRunLine +
      `\n\n` +
      `⚠️ _Funds are held in a Gramity hot wallet. LP carries impermanent loss risk. Only invest what you can afford to lose._`,
    {
      parse_mode: "Markdown",
      reply_markup: kb,
    }
  );
}

async function handleActivate(ctx: GramityContext) {
  const tid = botTgId(ctx);
  if (!tid) return;
  const telegramId = Number(tid);
  const { amount, frequency, tonAddress } = await readState(tid);

  if (!amount || !frequency || !tonAddress) {
    await ctx.reply("❌ Something went wrong. Start over: /start");
    return;
  }

  if (amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Minimum per cycle is $${MIN_DCA_USDT} USDT. Tap /start to try again.`);
    return;
  }

  const isTest    = TEST_FREQS.includes(frequency);
  const firstDate = isTest
    ? getInitialPlanExecutionDate({ frequency })
    : getNextCycleDate(frequency);

  try {
    await upsertPlan({
      telegram_id: telegramId,
      ton_address: tonAddress,
      agent_wallet: null,
      usdt_amount: amount,
      frequency: frequency as Plan["frequency"],
      strategy_mode: "full",
      active: true,
      next_execution_at: firstDate.toISOString(),
      demo_mode: false,
      cycles_completed: 0,
      max_cycles: null,
    });

    await createUserWallet(telegramId);
    await writeState(tid, { step: "idle" });

    await ctx.reply(
      `🚀 *Gramity activated!*\n\n` +
        `I'll notify you after each cycle.\n\n` +
        `/status — real-time position\n` +
        `/pause — pause strategy`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(
      `❌ Error: ${err instanceof Error ? err.message : "unknown"}\n\nPlease try again.`
    );
  }
}
