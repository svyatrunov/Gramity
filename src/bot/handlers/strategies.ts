/**
 * Multi-strategy bot commands: /strategies, /add, /pause_N, /resume_N, /stop_N
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../context.js";
import { botTgId, clearStrategyWizard, readState, writeState } from "../state.js";
import {
  createStrategy,
  getStrategiesByTelegramId,
  getStrategyById,
  getPlanByTelegramId,
  stopStrategy,
  updateStrategyStatus,
  type Strategy,
  type StrategyType,
} from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { getUserDepositAddress, createUserWallet } from "../../services/userWallet.js";
import {
  formatPlanFrequency,
  getInitialPlanExecutionDate,
  getNextPlanExecutionDate,
  MIN_DCA_USDT,
} from "../../constants/dca.js";
import { normalizeTonAddress } from "../../utils/tonAddress.js";
import {
  registerStrategyCron,
  unregisterStrategyCron,
} from "../../scheduler/index.js";

const TYPE_LABELS: Record<StrategyType, string> = {
  dca_ton: "Buy TON",
  dca_jetton: "Buy token",
  dca_tston: "Stake (tsTON)",
  dca_lp: "LP DCA",
};

function formatStrategyLine(s: Strategy): string {
  const label =
    s.strategy_type === "dca_jetton" && s.target_token_symbol
      ? `Buy ${s.target_token_symbol}`
      : TYPE_LABELS[s.strategy_type];
  const freq = formatPlanFrequency(s.frequency);
  const mode =
    s.strategy_type === "dca_lp" ? ` (${s.output_mode})` : "";
  const status =
    s.status === "active" ? "▶ Активна" : s.status === "paused" ? "⏸ Пауза" : "⏹ Остановлена";
  const runs =
    s.total_cycles > 0
      ? `Запусков: ${s.total_cycles} · Вложено: ${Number(s.total_invested).toFixed(0)} USDT`
      : "Запусков: 0 · Не запускалась";

  return (
    `#${s.id} ${label} · ${s.amount_usdt} USDT · ${freq}${mode}\n` +
    `   ${runs}\n` +
    `   ${status} · /pause_${s.id} · /stop_${s.id}`
  );
}

export async function handleStrategies(ctx: GramityContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const strategies = await getStrategiesByTelegramId(telegramId);
  if (strategies.length === 0) {
    await ctx.reply(
      "📊 *Ваши стратегии*\n\nПока нет активных стратегий.\n\n➕ /add — добавить стратегию",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const body = strategies.map(formatStrategyLine).join("\n\n");
  await ctx.reply(
    `📊 *Ваши стратегии:*\n\n${body}\n\n➕ /add — добавить стратегию`,
    { parse_mode: "Markdown" }
  );
}

export async function handleAddStrategy(ctx: GramityContext): Promise<void> {
  const tid = botTgId(ctx);
  if (!tid) return;

  await writeState(tid, { strategyWizard: { step: "type" } });
  const kb = new InlineKeyboard()
    .text("Buy TON", "strat_type:dca_ton")
    .text("Stake (tsTON)", "strat_type:dca_tston")
    .row()
    .text("LP DCA", "strat_type:dca_lp");
  await ctx.reply("Шаг 1: *Тип стратегии?*", {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
}

export async function handleStrategyCallback(
  ctx: GramityContext,
  data: string
): Promise<boolean> {
  const tid = botTgId(ctx);
  if (!tid) return false;
  const telegramId = Number(tid);

  if (data.startsWith("strat_type:")) {
    await ctx.answerCallbackQuery();
    const type = data.split(":")[1] as StrategyType;
    await writeState(tid, { strategyWizard: { step: "amount", strategy_type: type } });
    const kb = new InlineKeyboard()
      .text("$5", "strat_amt:5")
      .text("$10", "strat_amt:10")
      .text("$25", "strat_amt:25")
      .row()
      .text("$50", "strat_amt:50")
      .text("Своя", "strat_amt:custom");
    await ctx.editMessageText("Шаг 2: *Сумма в USDT?*", {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
    return true;
  }

  if (data.startsWith("strat_amt:")) {
    await ctx.answerCallbackQuery();
    const raw = data.split(":")[1];
    const state = await readState(tid);
    if (raw === "custom") {
      await writeState(tid, {
        strategyWizard: {
          ...state.strategyWizard,
          step: "custom_amount",
        },
      });
      await ctx.editMessageText(`Введите сумму (мин. $${MIN_DCA_USDT} USDT):`);
      return true;
    }
    await writeState(tid, {
      strategyWizard: {
        ...state.strategyWizard,
        step: "frequency",
        amount_usdt: Number(raw),
      },
    });
    await showFrequencyStep(ctx);
    return true;
  }

  if (data.startsWith("strat_freq:")) {
    await ctx.answerCallbackQuery();
    const frequency = data.split(":")[1];
    const state = await readState(tid);
    const w = {
      ...state.strategyWizard,
      step: "output_or_wallet" as const,
      frequency,
    };
    await writeState(tid, { strategyWizard: w });

    if (w.strategy_type === "dca_lp") {
      const kb = new InlineKeyboard()
        .text("Reinvest", "strat_out:reinvest")
        .text("Withdraw LP", "strat_out:withdraw");
      await ctx.editMessageText("Шаг 5: *Что делать с LP?*", {
        parse_mode: "Markdown",
        reply_markup: kb,
      });
    } else {
      await writeState(tid, {
        strategyWizard: { ...w, step: "wallet" },
      });
      await ctx.editMessageText(
        "Шаг 4: *Куда выводить?*\n\nОтправьте TON-адрес кошелька сообщением."
      );
    }
    return true;
  }

  if (data.startsWith("strat_out:")) {
    await ctx.answerCallbackQuery();
    const output_mode = data.split(":")[1] as "reinvest" | "withdraw";
    const state = await readState(tid);
    const w = {
      ...state.strategyWizard,
      output_mode,
      step: output_mode === "withdraw" ? ("wallet" as const) : ("confirm" as const),
    };
    await writeState(tid, { strategyWizard: w });

    if (output_mode === "withdraw") {
      await ctx.editMessageText(
        "Шаг 4: *Куда выводить LP?*\n\nОтправьте TON-адрес кошелька сообщением."
      );
    } else {
      await finalizeStrategy(ctx, telegramId);
    }
    return true;
  }

  return false;
}

async function showFrequencyStep(ctx: GramityContext, useReply = false): Promise<void> {
  const kb = new InlineKeyboard()
    .text("Каждый час", "strat_freq:hourly")
    .text("Каждый день", "strat_freq:daily")
    .row()
    .text("Раз в неделю", "strat_freq:weekly");
  const text = "Шаг 3: *Как часто?*";
  const opts = { parse_mode: "Markdown" as const, reply_markup: kb };
  if (useReply) await ctx.reply(text, opts);
  else await ctx.editMessageText(text, opts);
}

export async function handleStrategyWalletInput(
  ctx: GramityContext,
  address: string
): Promise<boolean> {
  const tid = botTgId(ctx);
  if (!tid) return false;
  const state = await readState(tid);
  const w = state.strategyWizard;
  if (!w || w.step !== "wallet") return false;

  const normalized = normalizeTonAddress(address.trim());
  if (!normalized) {
    await ctx.reply("❌ Неверный TON-адрес. Попробуйте снова.");
    return true;
  }

  await writeState(tid, {
    strategyWizard: {
      ...w,
      withdrawal_wallet: normalized,
      step: "confirm",
    },
  });
  await finalizeStrategy(ctx, ctx.from!.id!);
  return true;
}

export async function handleStrategyCustomAmount(
  ctx: GramityContext,
  text: string
): Promise<boolean> {
  const tid = botTgId(ctx);
  if (!tid) return false;
  const state = await readState(tid);
  const w = state.strategyWizard;
  if (!w || w.step !== "custom_amount") return false;

  const amount = Number(text.replace(/[^0-9.]/g, ""));
  if (!amount || amount < MIN_DCA_USDT) {
    await ctx.reply(`❌ Минимум $${MIN_DCA_USDT} USDT.`);
    return true;
  }

  await writeState(tid, {
    strategyWizard: {
      ...w,
      step: "frequency",
      amount_usdt: amount,
    },
  });
  await showFrequencyStep(ctx, true);
  return true;
}

async function finalizeStrategy(
  ctx: GramityContext,
  telegramId: number
): Promise<void> {
  const tid = botTgId(ctx);
  if (!tid) return;
  const w = (await readState(tid)).strategyWizard;
  if (!w?.strategy_type || !w.amount_usdt || !w.frequency) {
    await ctx.reply("❌ Не хватает данных. Начните с /add");
    return;
  }

  const needsWallet =
    w.strategy_type !== "dca_lp" || w.output_mode === "withdraw";
  if (needsWallet && !w.withdrawal_wallet) {
    await ctx.reply("❌ Укажите адрес вывода.");
    return;
  }

  const nextRun = getInitialPlanExecutionDate({ frequency: w.frequency });
  const strategy = await createStrategy({
    telegram_id: telegramId,
    strategy_type: w.strategy_type,
    amount_usdt: w.amount_usdt,
    frequency: w.frequency,
    withdrawal_wallet: w.withdrawal_wallet ?? null,
    output_mode: w.output_mode ?? "withdraw",
    next_run_at: nextRun,
  });

  await createUserWallet(telegramId);
  registerStrategyCron({ ...strategy, telegram_id: telegramId });
  await clearStrategyWizard(tid);

  await ctx.reply(
    `✅ *Стратегия #${strategy.id} создана*\n\n` +
      `${TYPE_LABELS[strategy.strategy_type]} · $${strategy.amount_usdt} · ${formatPlanFrequency(strategy.frequency)}\n` +
      `Первый запуск ~ через 2 мин после депозита.\n\n` +
      `/strategies — список`,
    { parse_mode: "Markdown" }
  );
}

export async function handlePauseStrategy(
  ctx: GramityContext,
  strategyId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const updated = await updateStrategyStatus(strategyId, telegramId, "paused");
  if (!updated) {
    await ctx.reply("❌ Стратегия не найдена.");
    return;
  }
  unregisterStrategyCron(strategyId);
  await ctx.reply(`⏸ Стратегия #${strategyId} на паузе. /resume_${strategyId} — возобновить`);
}

export async function handleResumeStrategy(
  ctx: GramityContext,
  strategyId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const strategy = await getStrategyById(strategyId, telegramId);
  if (!strategy) {
    await ctx.reply("❌ Стратегия не найдена.");
    return;
  }

  const next = getNextPlanExecutionDate({ frequency: strategy.frequency });
  const updated = await updateStrategyStatus(
    strategyId,
    telegramId,
    "active",
    next
  );
  if (!updated) {
    await ctx.reply("❌ Не удалось возобновить.");
    return;
  }
  registerStrategyCron({ ...updated, telegram_id: telegramId });
  await ctx.reply(`▶ Стратегия #${strategyId} активна.`);
}

export async function handleStopStrategy(
  ctx: GramityContext,
  strategyId: number
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const ok = await stopStrategy(strategyId, telegramId);
  if (!ok) {
    await ctx.reply("❌ Стратегия не найдена.");
    return;
  }
  unregisterStrategyCron(strategyId);
  await ctx.reply(`⏹ Стратегия #${strategyId} удалена.`);
}

export async function handleStrategiesStatus(ctx: GramityContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const [strategies, plan, depositAddress] = await Promise.all([
    getStrategiesByTelegramId(telegramId),
    getPlanByTelegramId(telegramId).catch(() => null),
    getUserDepositAddress(telegramId).catch(() => null),
  ]);

  const usdt = depositAddress ? await getUsdtBalance(depositAddress).catch(() => 0) : 0;
  const active = strategies.filter((s) => s.status === "active");

  let text =
    `📊 *Сводка*\n\n` +
    `Баланс: *$${usdt.toFixed(2)}* USDT\n` +
    `Активных стратегий: *${active.length}*\n`;

  if (plan?.active) {
    text += `\nLegacy plan: $${plan.usdt_amount} · ${formatPlanFrequency(plan.frequency)}`;
  }

  if (active.length > 0) {
    text += "\n\n" + active.map(formatStrategyLine).join("\n\n");
  }

  await ctx.reply(text, { parse_mode: "Markdown" });
}

/** Parse /pause_3, /stop_2, /resume_1 */
export function parseStrategyCommand(
  text: string
): { action: "pause" | "resume" | "stop"; id: number } | null {
  const m = text.match(/^\/(pause|resume|stop)_(\d+)$/);
  if (!m) return null;
  return { action: m[1] as "pause" | "resume" | "stop", id: Number(m[2]) };
}
