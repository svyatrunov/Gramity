/**
 * /start — shows Open App button (Mini App handles full onboarding).
 * Text-based fallback kept for edge cases / API-less environments.
 */

import { InlineKeyboard } from "grammy";
import { Address } from "@ton/ton";
import type { GramityContext } from "../session.js";
import { RAILWAY_PUBLIC_URL } from "../../config.js";
import { MIN_DCA_USDT } from "../../constants/dca.js";
import {
  getPlanByTelegramId,
  upsertPlan,
  getLastExecutions,
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
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existingPlan = await getPlanByTelegramId(telegramId).catch(() => null);
  const appUrl = `${RAILWAY_PUBLIC_URL}/app/onboarding.html`;

  if (existingPlan) {
    const statusEmoji = existingPlan.active ? "🟢" : "⏸";
    const statusLabel = existingPlan.active ? "Active" : "Paused";
    const freqLabel   = FREQ_LABELS[existingPlan.frequency] ?? existingPlan.frequency;
    const nextDate    = formatDate(new Date(existingPlan.next_execution_at));
    const execs       = await getLastExecutions(existingPlan.id, 1).catch(() => []);
    const lastExec    = execs[0];

    const kb = new InlineKeyboard()
      .text("📊 Status", "status_check")
      .text(existingPlan.active ? "⏸ Pause" : "▶️ Resume", existingPlan.active ? "pause" : "resume")
      .row()
      .webApp("🚀 Open App", appUrl);

    await ctx.reply(
      `👋 Welcome back!\n\n` +
        `📊 *Your Gramity Strategy*\n\n` +
        `${statusEmoji} ${statusLabel} · $${existingPlan.usdt_amount} USDT ${freqLabel}\n` +
        `Wallet: \`${existingPlan.ton_address.slice(0, 6)}…${existingPlan.ton_address.slice(-4)}\`\n` +
        (lastExec
          ? `Last run: ${new Date(lastExec.executed_at).toLocaleDateString("en-US")}\n`
          : "") +
        `Next: ${nextDate}\n\n` +
        `Commands: /status · /pause · /withdraw`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    ctx.session.step = "idle";
    return;
  }

  // ── New user — Open App button ─────────────────────────────────────────────
  ctx.session.step = "idle";

  const kb = new InlineKeyboard()
    .webApp("🚀 Open App", appUrl);

  await ctx.reply(
    `👋 Welcome to *Gramity* — automated DCA on TON.\n\n` +
      `*How it works:*\n` +
      `💵 Deposit USDT once (any chain: ETH, Base, BNB, Polygon or TON)\n` +
      `⚡ Every cycle, Gramity automatically:\n` +
      `  › Swaps USDT → TON via Omniston\n` +
      `  › Stakes → tsTON via Tonstakers (~5% APY)\n` +
      `  › Provides liquidity on STON.fi (~5.4% APY)\n\n` +
      `*LP tokens go directly to your wallet.*\n` +
      `~5.4% APY · 0% platform fee\n\n` +
      `After setup, manage via *@Mira* (portfolio, pause, update).\n\n` +
      `Tap *Open App* to set up in ~2 minutes 👇`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ─── Text message router ──────────────────────────────────────────────────────

export async function handleText(ctx: GramityContext) {
  const step = ctx.session.step;
  const text = ctx.message?.text?.trim() ?? "";

  if (step === "waiting_wallet") {
    await handleWalletInput(ctx, text);
  } else if (step === "waiting_deposit_confirm") {
    await handleDepositConfirm(ctx);
  } else if (step === "waiting_custom_amount") {
    await handleCustomAmount(ctx, text);
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
 * manual text input or the TonConnect mini-app.  Sets the session to
 * `waiting_deposit_confirm`, allocates the deposit wallet, starts the poller,
 * and prompts the user to fund it.
 */
export async function continueToDepositStep(
  ctx: GramityContext,
  normalizedAddress: string
): Promise<void> {
  const telegramId = ctx.from!.id;

  ctx.session.tonAddress = normalizedAddress;
  ctx.session.step = "waiting_deposit_confirm";

  const depositAddress = await createUserWallet(telegramId).catch(() => "unavailable");
  ctx.session.depositAddress = depositAddress;

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
  const telegramId = ctx.from!.id;
  const depositAddress =
    ctx.session.depositAddress ??
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
  ctx.session.usdtBalance = balance;
  ctx.session.step = "waiting_amount";
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
  const amount = parseFloat(text.replace(",", ".").replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Minimum per cycle is $${MIN_DCA_USDT} USDT. Enter e.g.: \`30\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  ctx.session.amount = amount;
  ctx.session.step = "waiting_frequency";
  await showFrequencyKeyboard(ctx);
}

// ─── Inline keyboard callbacks ────────────────────────────────────────────────

export async function handleCallbackQuery(ctx: GramityContext) {
  const data = ctx.callbackQuery?.data ?? "";
  await ctx.answerCallbackQuery();

  if (data === "onboard_start") {
    // Legacy: redirect to Mini App instead of bot-based onboarding
    const appUrl = `${RAILWAY_PUBLIC_URL}/app/onboarding.html`;
    const kb = new InlineKeyboard().webApp("🚀 Open App", appUrl);
    await ctx.reply(
      `Set up your DCA strategy in the Mini App 👇`,
      { reply_markup: kb }
    );
    return;
  }

  if (data === "deposit_done") {
    if (!ctx.session.tonAddress) {
      await ctx.reply("⚠️ Session expired.\n\nTap /start to begin again.");
      return;
    }
    ctx.session.step = "waiting_deposit_confirm";
    await handleDepositConfirm(ctx);
    return;
  }

  if (data.startsWith("amount_")) {
    const raw = data.slice(7);
    if (raw === "custom") {
      ctx.session.step = "waiting_custom_amount";
      await ctx.reply(`Enter amount in USDT (minimum $${MIN_DCA_USDT}):`);
    } else {
      ctx.session.amount = Number(raw);
      ctx.session.step = "waiting_frequency";
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

    if (!ctx.session.amount || !ctx.session.tonAddress) {
      await ctx.reply(
        "⚠️ Session expired (bot restarted).\n\nTap /start — takes 30 seconds."
      );
      ctx.session.step = "idle";
      return;
    }

    ctx.session.frequency = freq;
    ctx.session.step = "confirming";
    await showConfirmation(ctx);
    return;
  }

  if (data === "activate") {
    await handleActivate(ctx);
    return;
  }

  if (data === "edit_plan") {
    ctx.session.step = "waiting_amount";
    const balance = ctx.session.usdtBalance ?? 0;
    await showAmountKeyboard(ctx, balance);
    return;
  }
}

async function showFrequencyKeyboard(ctx: GramityContext) {
  const kb = new InlineKeyboard()
    .text("📅 Weekly",        "freq_weekly")
    .text("🗓 Every 2 weeks", "freq_biweekly")
    .row()
    .text("📆 Monthly",       "freq_monthly");

  if (ctx.session.devMode || process.env.NODE_ENV !== "production") {
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
  const { amount, frequency, tonAddress } = ctx.session;
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
  const telegramId = ctx.from?.id;
  const { amount, frequency, tonAddress } = ctx.session;

  if (!telegramId || !amount || !frequency || !tonAddress) {
    await ctx.reply("❌ Something went wrong. Start over: /start");
    return;
  }

  if (amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Minimum per cycle is $${MIN_DCA_USDT} USDT. Tap /start to try again.`);
    return;
  }

  const isTest    = TEST_FREQS.includes(frequency);
  const firstDate = isTest ? new Date() : getNextCycleDate(frequency);

  try {
    await upsertPlan({
      telegram_id: telegramId,
      ton_address: tonAddress,
      agent_wallet: null,
      usdt_amount: amount,
      frequency,
      strategy_mode: "full",
      active: true,
      next_execution_at: firstDate.toISOString(),
      demo_mode: false,
      cycles_completed: 0,
      max_cycles: null,
    });

    await createUserWallet(telegramId);
    ctx.session.step = "idle";

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
