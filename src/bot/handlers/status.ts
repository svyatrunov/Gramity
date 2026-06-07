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

// Safe formatter — returns '—' for null/undefined/NaN/0
const fmt = (v: number | null | undefined, decimals = 2): string =>
  v != null && !isNaN(v) && isFinite(v) && v !== 0
    ? v.toFixed(decimals)
    : "—";

const FREQ_LABELS: Record<string, string> = {
  weekly: "еженедельно",
  biweekly: "раз в 2 нед.",
  monthly: "раз в месяц",
  minutely: "каждую минуту",
  hourly: "каждый час",
};

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

  const [allExecs, totalInvested, tonPrice, depositAddress] = await Promise.all([
    getLastExecutions(plan.id, 50),
    getTotalInvested(plan.id),
    getTonPriceUsd(),
    getDepositAddress().catch(() => ""),
  ]);

  // ── LP position from STON.fi API ───────────────────────────────────────────
  let lpValueNum: number | null = null;
  let apy7d: number | null = null;

  try {
    const apiClient = new StonApiClient({ baseUrl: STON_API_URL });
    const walletPool = await apiClient.getWalletPool({
      walletAddress: depositAddress,
      poolAddress: POOL_ADDRESS,
    });

    if (walletPool.lpBalance && walletPool.lpTotalSupplyUsd && walletPool.lpTotalSupply) {
      const share = Number(walletPool.lpBalance) / Number(walletPool.lpTotalSupply);
      lpValueNum = share * Number(walletPool.lpTotalSupplyUsd);
    } else if (walletPool.lpBalance && walletPool.lpPriceUsd) {
      lpValueNum = (Number(walletPool.lpBalance) / 1e9) * Number(walletPool.lpPriceUsd);
    }

    if (walletPool.apy7D) apy7d = Number(walletPool.apy7D);
  } catch {
    /* non-critical */
  }

  // ── Deposit balance ────────────────────────────────────────────────────────
  const depositBalance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

  // ── Average entry price: SUM(usdt_spent) / SUM(ton_received) ──────────────
  const successExecs = allExecs.filter((e) => e.status === "success");
  const totalUsdtSpent = successExecs.reduce((s, e) => s + (e.usdt_spent ?? 0), 0);
  const totalTonReceived = successExecs.reduce((s, e) => s + (e.ton_received ?? 0), 0);
  const avgEntryPrice =
    totalTonReceived > 0 ? totalUsdtSpent / totalTonReceived : null;

  // ── P&L ───────────────────────────────────────────────────────────────────
  const totalAssets =
    lpValueNum != null ? lpValueNum + depositBalance : depositBalance || null;
  const pnlAbs = totalAssets != null && totalInvested > 0 ? totalAssets - totalInvested : null;
  const pnlPct = pnlAbs != null && totalInvested > 0 ? (pnlAbs / totalInvested) * 100 : null;

  // ── Format strings ─────────────────────────────────────────────────────────
  const statusEmoji = plan.active ? "🟢" : "⏸";
  const freqLabel = FREQ_LABELS[plan.frequency] ?? plan.frequency;

  const nextDate = new Date(plan.next_execution_at).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  });

  const apyTotal = apy7d != null ? 5 + apy7d : null;

  // Build P&L line
  const pnlLine =
    pnlAbs != null && pnlPct != null
      ? `Итого P&L: ${pnlAbs >= 0 ? "+" : ""}$${fmt(pnlAbs)} (${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%)\n`
      : "";

  // TON price block — only if we have data
  const tonPriceLines =
    tonPrice > 0 || avgEntryPrice != null
      ? (avgEntryPrice != null ? `Ср. цена входа: $${fmt(avgEntryPrice)}/TON\n` : "") +
        (tonPrice > 0 ? `Текущая цена TON: $${fmt(tonPrice)}\n` : "")
      : "";

  const text =
    `📊 *Gramity — твоя позиция*\n\n` +
    `${statusEmoji} ${plan.active ? "Активна" : "Пауза"} · $${plan.usdt_amount} ${freqLabel}\n\n` +
    `Остаток на депозите: $${fmt(depositBalance)}\n` +
    `LP позиция: ${lpValueNum != null ? "$" + fmt(lpValueNum) : "—"}\n` +
    `Итого активов: ${totalAssets != null ? "$" + fmt(totalAssets) : "—"}\n\n` +
    `Вложено: $${fmt(totalInvested)}\n` +
    pnlLine +
    (tonPriceLines ? `\n${tonPriceLines}` : "") +
    `\nДоходность:\n` +
    `  tsTON стейкинг: ~5.0%\n` +
    `  LP + фарминг:   ~${apy7d != null ? fmt(apy7d, 1) : "3.5"}%\n` +
    `  *Итого APY:*    ~${apyTotal != null ? fmt(apyTotal, 1) : "8.5"}%\n\n` +
    `⏰ Следующий: ${nextDate}`;

  const kb = new InlineKeyboard()
    .text(plan.active ? "⏸ Пауза" : "▶️ Возобновить", plan.active ? "pause" : "resume")
    .text("💸 Вывести", "withdraw");

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
}
