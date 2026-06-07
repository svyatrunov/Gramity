import { StonApiClient } from "@ston-fi/api";
import type { GramityContext } from "../session.js";
import {
  getPlanByTelegramId,
  getLastExecutions,
  getTotalInvested,
} from "../../db/index.js";
import { getTonPriceUsd, getUsdtBalance } from "../../services/tonapi.js";
import { getDepositAddress } from "../../execution/index.js";
import { POOL_ADDRESS, STON_API_URL } from "../../config.js";
import { InlineKeyboard } from "grammy";

export async function handleStatus(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "У тебя пока нет активной стратегии.\n\n" +
        "Используй /start чтобы настроить Gramity."
    );
    return;
  }

  await ctx.reply("⏳ Загружаю данные...");

  const [executions, totalInvested, tonPrice, depositAddress] =
    await Promise.all([
      getLastExecutions(plan.id, 1),
      getTotalInvested(plan.id),
      getTonPriceUsd(),
      getDepositAddress().catch(() => ""),
    ]);

  const lastExec = executions[0];

  // LP position from STON.fi API
  let lpValueUsd = "N/A";
  let apy1d = "N/A";
  let apy7d = "N/A";
  let avgEntryPrice = "N/A";
  let depositBalance = 0;

  try {
    const apiClient = new StonApiClient({ baseUrl: STON_API_URL });
    const walletPool = await apiClient.getWalletPool({
      walletAddress: depositAddress,
      poolAddress: POOL_ADDRESS,
    });

    if (
      walletPool.lpBalance &&
      walletPool.lpTotalSupplyUsd &&
      walletPool.lpTotalSupply
    ) {
      const share =
        Number(walletPool.lpBalance) / Number(walletPool.lpTotalSupply);
      lpValueUsd = (share * Number(walletPool.lpTotalSupplyUsd)).toFixed(2);
    } else if (walletPool.lpBalance && walletPool.lpPriceUsd) {
      lpValueUsd = (
        (Number(walletPool.lpBalance) / 1e9) *
        Number(walletPool.lpPriceUsd)
      ).toFixed(2);
    }

    apy1d = walletPool.apy1D ?? "N/A";
    apy7d = walletPool.apy7D ?? "N/A";
  } catch {
    /* non-critical */
  }

  if (depositAddress) {
    depositBalance = await getUsdtBalance(depositAddress);
  }

  // Average entry price from executions
  const allExecs = await getLastExecutions(plan.id, 50);
  const tradesWithPrice = allExecs.filter(
    (e) => e.ton_price_usdt && e.ton_price_usdt > 0
  );
  if (tradesWithPrice.length > 0) {
    const avg =
      tradesWithPrice.reduce((s, e) => s + (e.ton_price_usdt ?? 0), 0) /
      tradesWithPrice.length;
    avgEntryPrice = `$${avg.toFixed(2)}`;
  }

  // P&L
  const lpNum = lpValueUsd !== "N/A" ? Number(lpValueUsd) : null;
  const pnl =
    lpNum !== null && totalInvested > 0
      ? ((lpNum - totalInvested) / totalInvested) * 100
      : null;

  const freqLabels: Record<string, string> = {
    weekly: "еженедельно",
    biweekly: "раз в 2 нед.",
    monthly: "раз в месяц",
  };

  const nextDate = new Date(plan.next_execution_at).toLocaleDateString(
    "ru-RU",
    {
      weekday: "short",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
    }
  );

  const tonPriceStr =
    tonPrice > 0
      ? `$${tonPrice.toFixed(2)} (${avgEntryPrice !== "N/A" && tonPrice > 0 ? ((tonPrice / Number(avgEntryPrice.replace("$", "")) - 1) * 100 > 0 ? "+" : "") + ((tonPrice / Number(avgEntryPrice.replace("$", "")) - 1) * 100).toFixed(1) + "%" : ""})`
      : "N/A";

  const statusEmoji = plan.active ? "🟢" : "⏸";

  const text =
    `📊 *Gramity — твоя позиция*\n\n` +
    `${statusEmoji} ${plan.active ? "Активна" : "Пауза"} · $${plan.usdt_amount} ${freqLabels[plan.frequency] ?? plan.frequency}\n\n` +
    `Баланс депозита: $${depositBalance.toFixed(2)} USDT\n` +
    `LP позиция: $${lpValueUsd}\n` +
    `Всего внесено: $${totalInvested.toFixed(2)}\n` +
    (pnl !== null
      ? `Прибыль: ${pnl >= 0 ? "+" : ""}$${(lpNum! - totalInvested).toFixed(2)} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%)\n`
      : "") +
    `\nСредняя цена входа: ${avgEntryPrice}/TON\n` +
    `Текущая цена TON: ${tonPriceStr}\n\n` +
    `Доходность:\n` +
    `  tsTON стейкинг: ~5.0%\n` +
    `  LP комиссии:    ~${apy1d !== "N/A" ? (Number(apy1d) * 0.7).toFixed(1) : "2.1"}%\n` +
    `  Фарминг:        ~${apy7d !== "N/A" ? (Number(apy7d) * 0.3).toFixed(1) : "1.4"}%\n` +
    `  *Итого APY:*    ~${apy7d !== "N/A" ? (5 + Number(apy7d)).toFixed(1) : "8.5"}%\n\n` +
    `⏰ Следующий запуск: ${nextDate}`;

  const kb = new InlineKeyboard()
    .text("⏸ Пауза", plan.active ? "pause" : "resume")
    .text("💸 Вывести", "withdraw");

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
}
