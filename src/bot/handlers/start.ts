/**
 * /start onboarding flow — multi-step state machine
 *
 * Steps:
 *  1. Welcome (with [🚀 Начать] button)
 *  2. Ask TON address (reframed: "where to withdraw later")
 *  3. Validate → show deposit address → start background poller
 *  4. Deposit detected (auto or manual) → amount selection with APY framing
 *  5. Frequency selection (test options behind /dev or non-prod)
 *  6. Summary + risk disclosure → [✅ Активировать]
 */

import { InlineKeyboard } from "grammy";
import { Address } from "@ton/ton";
import type { GramityContext } from "../session.js";
import { RAILWAY_PUBLIC_URL } from "../../config.js";
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

function getFirstFriday(): Date {
  const now = new Date();
  const daysUntilFriday = ((5 - now.getDay() + 7) % 7) || 7;
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

const FREQ_LABELS: Record<string, string> = {
  weekly: "еженедельно",
  biweekly: "раз в 2 нед.",
  monthly: "раз в месяц",
  minutely: "каждую минуту",
  hourly: "каждый час",
};

const TEST_FREQS = ["minutely", "hourly"];

/** Estimated annual yield at a given weekly amount and 8% APY on average deployed capital */
function estimateYearlyUsd(weeklyAmount: number): number {
  // Average capital ≈ 26 weeks of deposits × amount; 8% APY
  return Math.round(weeklyAmount * 26 * 0.08);
}

// ─── /start command ───────────────────────────────────────────────────────────

export async function handleStart(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existingPlan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (existingPlan) {
    const status = existingPlan.active ? "🟢 Активна" : "⏸ Пауза";
    const nextDate = new Date(existingPlan.next_execution_at);
    const execs = await getLastExecutions(existingPlan.id, 1).catch(() => []);
    const lastExec = execs[0];

    const kb = new InlineKeyboard()
      .text("📊 Статус", "status_check")
      .text("⏸ Пауза", existingPlan.active ? "pause" : "resume");

    await ctx.reply(
      `👋 С возвращением!\n\n` +
        `📊 *Твоя стратегия Gramity*\n\n` +
        `Статус: ${status}\n` +
        `Сумма: $${existingPlan.usdt_amount} ${FREQ_LABELS[existingPlan.frequency] ?? existingPlan.frequency}\n` +
        `Кошелёк: \`${existingPlan.ton_address.slice(0, 6)}…${existingPlan.ton_address.slice(-4)}\`\n` +
        (lastExec
          ? `Последний запуск: ${new Date(lastExec.executed_at).toLocaleDateString("ru-RU")}\n`
          : "") +
        `Следующий: ${formatDate(nextDate)}\n\n` +
        `Команды: /status · /pause · /resume · /reset`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    ctx.session.step = "idle";
    return;
  }

  // ── Fresh onboarding ───────────────────────────────────────────────────────
  ctx.session.step = "idle";

  const kb = new InlineKeyboard().text("🚀 Начать", "onboard_start");

  await ctx.reply(
    `👋 Привет! Я *Gramity* — авто-инвестирование в TON DeFi.\n\n` +
      `*Как работает:*\n` +
      `💵 Ты кладёшь USDT на депозит\n` +
      `⚡ Каждую неделю я автоматически:\n` +
      `  › меняю USDT → TON (Omniston)\n` +
      `  › стейкаю часть → tsTON (~5% APY)\n` +
      `  › добавляю в пул STON.fi (~8% APY)\n\n` +
      `*Ожидаемый доход: ~8% годовых*\n` +
      `Без комиссий платформы. Только газ.\n\n` +
      `Настройка займёт 2 минуты 👇`,
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
    // User typed something while waiting — re-check balance
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
      "❌ Неверный формат адреса.\n\n" +
        "Открой Tonkeeper → Получить → скопируй адрес кошелька.\n" +
        "Принимаю форматы: `EQ…`, `UQ…`, `0:abc123…`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  ctx.session.tonAddress = normalized;
  ctx.session.step = "waiting_deposit_confirm";

  const telegramId = ctx.from!.id;
  const depositAddress = await createUserWallet(telegramId).catch(() => "недоступен");
  ctx.session.depositAddress = depositAddress;

  startDepositPoller(telegramId, depositAddress);

  await ctx.reply(
    `✅ Кошелёк сохранён\n` +
      `\`${normalized.slice(0, 6)}…${normalized.slice(-4)}\`\n\n` +
      `*Пополни депозитный адрес Gramity в USDT (TON):*\n` +
      `\`${depositAddress}\`\n\n` +
      `Минимум: $25 USDT\n\n` +
      `📡 Я слежу за поступлением и уведомлю тебя автоматически.\n` +
      `Можешь нажать кнопку сразу после отправки 👇`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text(
        "✅ Уже пополнил",
        "deposit_done"
      ),
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
      `⏳ Пока вижу: $${balance.toFixed(2)} USDT на депозите.\n\n` +
        `Транзакция занимает 1–2 мин. Подожди немного 🙏`
    );
    return;
  }

  // Deposit arrived — stop the background poller (if still running)
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
    kb.text(`$${amt}  (~$${yearly}/год)`, `amount_${amt}`);
  }

  // Start a new row for Custom
  kb.row().text("✏️ Своя сумма", "amount_custom");
  return kb;
}

async function showAmountKeyboard(ctx: GramityContext, balance: number) {
  await ctx.reply(
    `💰 *Получено: ${balance.toFixed(2)} USDT* ✅\n\n` +
      `*Сколько вкладывать за один цикл?*\n` +
      `Оценка дохода при ~8% APY (еженедельно, 1 год):`,
    { parse_mode: "Markdown", reply_markup: buildAmountKeyboard(balance) }
  );
}

// ─── Step: custom amount input ────────────────────────────────────────────────

async function handleCustomAmount(ctx: GramityContext, text: string) {
  const amount = parseFloat(text.replace(",", ".").replace(/[^0-9.]/g, ""));

  if (isNaN(amount) || amount < 1) {
    await ctx.reply("❌ Введи сумму в долларах, например: `30`", {
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

  // ── Welcome → start onboarding
  if (data === "onboard_start") {
    ctx.session.step = "waiting_wallet";

    const miniAppUrl = `${RAILWAY_PUBLIC_URL}/app?mode=connect`;

    const kb = new InlineKeyboard()
      .webApp("🔗 Подключить кошелёк", miniAppUrl);

    await ctx.reply(
      `*Шаг 1/3 — Кошелёк для вывода*\n\n` +
        `На какой TON-адрес выводить средства при /withdraw?\n\n` +
        `Нажми кнопку ниже или введи адрес вручную (UQ... или EQ...):`,
      { parse_mode: "Markdown", reply_markup: kb }
    );
    return;
  }

  // ── Deposit confirmed (button or auto-poller button)
  if (data === "deposit_done") {
    if (!ctx.session.tonAddress) {
      await ctx.reply(
        "⚠️ Сессия устарела.\n\nНажми /start чтобы начать заново."
      );
      return;
    }
    ctx.session.step = "waiting_deposit_confirm";
    await handleDepositConfirm(ctx);
    return;
  }

  // ── Amount selection
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

  // ── Frequency selection
  if (data.startsWith("freq_")) {
    const freq = data.slice(5) as
      | "weekly"
      | "biweekly"
      | "monthly"
      | "minutely"
      | "hourly";

    if (!ctx.session.amount || !ctx.session.tonAddress) {
      await ctx.reply(
        "⚠️ Сессия устарела (бот перезапустился).\n\nНажми /start — займёт 30 секунд."
      );
      ctx.session.step = "idle";
      return;
    }

    ctx.session.frequency = freq;
    ctx.session.step = "confirming";
    await showConfirmation(ctx);
    return;
  }

  // ── Activate
  if (data === "activate") {
    await handleActivate(ctx);
    return;
  }

  // ── Edit plan
  if (data === "edit_plan") {
    ctx.session.step = "waiting_amount";
    const balance = ctx.session.usdtBalance ?? 0;
    await showAmountKeyboard(ctx, balance);
    return;
  }
}

// ─── Frequency keyboard ───────────────────────────────────────────────────────

async function showFrequencyKeyboard(ctx: GramityContext) {
  const kb = new InlineKeyboard()
    .text("📅 Еженедельно", "freq_weekly")
    .text("🗓 Раз в 2 нед.", "freq_biweekly")
    .row()
    .text("📆 Раз в месяц", "freq_monthly");

  // Test frequencies: only if dev mode is ON in session, or non-prod environment
  if (ctx.session.devMode || process.env.NODE_ENV !== "production") {
    kb.row()
      .text("⚡ 1 мин (тест)", "freq_minutely")
      .text("🕐 1 час (тест)", "freq_hourly");
  }

  await ctx.reply(
    `*Шаг 3/3 — Частота*\n\n` +
      `Как часто запускать стратегию?`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ─── Confirmation + risk disclosure ──────────────────────────────────────────

async function showConfirmation(ctx: GramityContext) {
  const { amount, frequency, tonAddress } = ctx.session;
  if (!amount || !frequency || !tonAddress) return;

  const isTest = TEST_FREQS.includes(frequency);
  const freqLabel = FREQ_LABELS[frequency] ?? frequency;
  const firstRunLine = isTest
    ? `⏰ Первый запуск: сразу после активации ⚡`
    : `⏰ Первый запуск: ${formatDate(getFirstFriday())}`;

  const yearly = estimateYearlyUsd(amount);

  const kb = new InlineKeyboard()
    .text("✅ Активировать", "activate")
    .row()
    .text("✏️ Изменить сумму", "edit_plan");

  await ctx.reply(
    `📋 *Твоя стратегия Gramity*\n\n` +
      `💵 $${amount} USDT ${freqLabel}\n` +
      `├─ Omniston: USDT → TON\n` +
      `├─ Tonstakers: TON → tsTON (~5%)\n` +
      `└─ STON.fi LP: tsTON + TON (~8%)\n\n` +
      `📈 Ожидаемый доход: ~$${yearly}/год\n` +
      firstRunLine +
      `\n\n` +
      `⚠️ _Средства хранятся на горячем кошельке Gramity. LP несёт риск непостоянных потерь. Не вкладывай больше, чем готов потерять._`,
    {
      parse_mode: "Markdown",
      reply_markup: kb,
    }
  );
}

// ─── Activation ───────────────────────────────────────────────────────────────

async function handleActivate(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  const { amount, frequency, tonAddress } = ctx.session;

  if (!telegramId || !amount || !frequency || !tonAddress) {
    await ctx.reply("❌ Что-то пошло не так. Начни заново: /start");
    return;
  }

  const isTest = TEST_FREQS.includes(frequency);
  const firstDate = isTest ? new Date() : getFirstFriday();

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
    });

    // Ensure isolated wallet exists (idempotent — safe to call again)
    await createUserWallet(telegramId);

    ctx.session.step = "idle";

    await ctx.reply(
      `🚀 *Gramity запущен!*\n\n` +
        `Буду писать после каждого цикла.\n\n` +
        `/status — позиция в реальном времени\n` +
        `/pause — поставить на паузу`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.reply(
      `❌ Ошибка: ${err instanceof Error ? err.message : "unknown"}\n\nПопробуй ещё раз.`
    );
  }
}
