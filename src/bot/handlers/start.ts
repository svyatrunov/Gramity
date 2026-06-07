/**
 * /start onboarding flow — multi-step state machine
 *
 * Steps:
 *  1. Welcome + ask TON wallet address
 *  2. Validate address → show deposit address + ask to fund
 *  3. Check USDT balance → ask investment amount
 *  4. Ask frequency
 *  5. Show summary + activation button
 */

import { InlineKeyboard } from "grammy";
import { Address } from "@ton/ton";
import type { GramityContext } from "../session.js";
import {
  getPlanByTelegramId,
  upsertPlan,
  getLastExecutions,
} from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { getDepositAddress } from "../../execution/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidTonAddress(addr: string): boolean {
  try {
    Address.parse(addr);
    return true;
  } catch {
    return false;
  }
}

function getFirstExecutionDate(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = ((5 - dayOfWeek + 7) % 7) || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilFriday);
  next.setUTCHours(9, 0, 0, 0); // 12:00 Moscow = 09:00 UTC
  return next;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

function getNextExecution(frequency: string, firstDate: Date): Date {
  if (frequency === "weekly") return firstDate;
  if (frequency === "biweekly") return firstDate;
  if (frequency === "monthly") return firstDate;
  return firstDate;
}

const FREQ_LABELS: Record<string, string> = {
  weekly: "Еженедельно",
  biweekly: "Раз в 2 недели",
  monthly: "Раз в месяц",
};

// ─── /start command ───────────────────────────────────────────────────────────

export async function handleStart(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Check if user already has a plan
  const existingPlan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (existingPlan) {
    const status = existingPlan.active ? "🟢 Активна" : "⏸ Пауза";
    const nextDate = new Date(existingPlan.next_execution_at);
    const execs = await getLastExecutions(existingPlan.id, 1).catch(() => []);
    const lastExec = execs[0];

    await ctx.reply(
      `👋 С возвращением!\n\n` +
        `📊 *Твоя стратегия Gramity*\n\n` +
        `Статус: ${status}\n` +
        `Сумма: $${existingPlan.usdt_amount} ${FREQ_LABELS[existingPlan.frequency] ?? existingPlan.frequency}\n` +
        `Кошелёк: \`${existingPlan.ton_address.slice(0, 6)}...${existingPlan.ton_address.slice(-4)}\`\n` +
        (lastExec
          ? `Последний запуск: ${new Date(lastExec.executed_at).toLocaleDateString("ru-RU")}\n`
          : "") +
        `Следующий: ${formatDate(nextDate)}\n\n` +
        `/status — детальная позиция\n` +
        `/pause — поставить на паузу`,
      { parse_mode: "Markdown" }
    );
    ctx.session.step = "idle";
    return;
  }

  // Start onboarding
  ctx.session.step = "waiting_wallet";

  await ctx.reply(
    `👋 Привет! Я *Gramity*.\n\n` +
      `Твои USDT на TON автоматически\n` +
      `превращаются в ликвидность STON.fi —\n` +
      `каждую неделю, без твоего участия.\n\n` +
      `*Как работает:*\n` +
      `💵 USDT → TON (Omniston)\n` +
      `🔒 TON → tsTON (Tonstakers ~5% APY)\n` +
      `🏊 tsTON + TON → STON.fi LP (~8% APY)\n\n` +
      `Отправь мне адрес своего TON кошелька 👇`,
    { parse_mode: "Markdown" }
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
  if (!isValidTonAddress(text)) {
    await ctx.reply(
      "❌ Некорректный адрес TON кошелька.\n\n" +
        "Пожалуйста, отправь адрес в формате `EQ...` или `UQ...`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  ctx.session.tonAddress = text;
  ctx.session.step = "waiting_deposit_confirm";

  const depositAddress = await getDepositAddress().catch(
    () => "Адрес не доступен"
  );

  await ctx.reply(
    `✅ Кошелёк подключён\n` +
      `Адрес: \`${text.slice(0, 6)}...${text.slice(-4)}\`\n\n` +
      `Пополни депозитный адрес USDT для старта:\n` +
      `\`${depositAddress}\`\n\n` +
      `Минимум: $25 USDT\n\n` +
      `Напиши мне когда пополнишь 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("✅ Я пополнил", "deposit_done"),
    }
  );
}

// ─── Step: deposit confirmed ──────────────────────────────────────────────────

async function handleDepositConfirm(ctx: GramityContext) {
  const depositAddress = await getDepositAddress().catch(() => "");
  const balance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

  ctx.session.usdtBalance = balance;

  if (balance < 1) {
    await ctx.reply(
      `⏳ Баланс пока: $${balance.toFixed(2)} USDT\n\n` +
        `Транзакция может занять 1–2 минуты.\n` +
        `Напиши снова после пополнения 👇`
    );
    return;
  }

  ctx.session.step = "waiting_amount";
  await showAmountKeyboard(ctx, balance);
}

async function showAmountKeyboard(ctx: GramityContext, balance: number) {
  const options: Array<[number, string]> = [];

  if (balance >= 10) options.push([10, "$10"]);
  if (balance >= 25) options.push([25, "$25"]);
  if (balance >= 50) options.push([50, "$50"]);
  if (balance >= 100) options.push([100, "$100"]);

  const kb = new InlineKeyboard();
  for (const [amt, label] of options) {
    kb.text(label, `amount_${amt}`);
  }
  kb.text("✏️ Своя сумма", "amount_custom");

  await ctx.reply(
    `Получено: ${balance.toFixed(2)} USDT ✅\n\n` +
      `Сколько инвестировать за раз?`,
    { reply_markup: kb }
  );
}

// ─── Step: custom amount input ────────────────────────────────────────────────

async function handleCustomAmount(ctx: GramityContext, text: string) {
  const amount = parseFloat(text.replace(",", ".").replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount < 1) {
    await ctx.reply("❌ Введи сумму в долларах, например: 30");
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

  if (data === "deposit_done") {
    ctx.session.step = "waiting_deposit_confirm";
    await handleDepositConfirm(ctx);
    return;
  }

  if (data.startsWith("amount_")) {
    const raw = data.slice(7);
    if (raw === "custom") {
      ctx.session.step = "waiting_custom_amount";
      await ctx.reply("Введи сумму в USDT (минимум $1):");
    } else {
      ctx.session.amount = Number(raw);
      ctx.session.step = "waiting_frequency";
      await showFrequencyKeyboard(ctx);
    }
    return;
  }

  if (data.startsWith("freq_")) {
    const freq = data.slice(5) as "weekly" | "biweekly" | "monthly";
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
    .text("📅 Еженедельно", "freq_weekly")
    .text("🗓 Раз в 2 нед.", "freq_biweekly")
    .row()
    .text("📆 Раз в месяц", "freq_monthly");

  await ctx.reply("Как часто?", { reply_markup: kb });
}

async function showConfirmation(ctx: GramityContext) {
  const { amount, frequency, tonAddress } = ctx.session;
  if (!amount || !frequency || !tonAddress) return;

  const firstDate = getFirstExecutionDate();
  const freqLabel = FREQ_LABELS[frequency] ?? frequency;

  const kb = new InlineKeyboard()
    .text("✅ Активировать", "activate")
    .text("✏️ Изменить", "edit_plan");

  await ctx.reply(
    `📋 *Твоя стратегия Gramity*\n\n` +
      `💵 $${amount} USDT ${freqLabel}\n` +
      `├─ Omniston: USDT → TON\n` +
      `├─ Tonstakers: 50%+ → tsTON\n` +
      `└─ STON.fi: tsTON/TON LP + фарминг\n\n` +
      `📈 Ожидаемый APY: ~8%\n` +
      `⏰ Первый запуск: ${formatDate(firstDate)}`,
    {
      parse_mode: "Markdown",
      reply_markup: kb,
    }
  );
}

// ─── Step: activation ─────────────────────────────────────────────────────────

async function handleActivate(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  const { amount, frequency, tonAddress } = ctx.session;

  if (!telegramId || !amount || !frequency || !tonAddress) {
    await ctx.reply("❌ Что-то пошло не так. Начни заново: /start");
    return;
  }

  const firstDate = getFirstExecutionDate();

  try {
    await upsertPlan({
      telegram_id: telegramId,
      ton_address: tonAddress,
      agent_wallet: null,
      usdt_amount: amount,
      frequency,
      active: true,
      next_execution_at: firstDate.toISOString(),
    });

    ctx.session.step = "idle";

    await ctx.reply(
      `🚀 *Gramity запущен!*\n\n` +
        `Буду писать каждый раз когда действую.\n` +
        `/status — твоя позиция в любой момент`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(
      `❌ Ошибка сохранения: ${err instanceof Error ? err.message : "unknown"}\n\nПопробуй ещё раз.`
    );
  }
}
