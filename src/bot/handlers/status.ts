import { StonApiClient } from "@ston-fi/api";
import type { GramityContext } from "../session.js";
import {
  getPlanByTelegramId,
  getLastExecutions,
  getTotalInvested,
  pool,
} from "../../db/index.js";
import {
  getTonPriceUsd,
  getUsdtBalance,
  getPortfolioValueUsd,
  projectPortfolio,
  getPoolApy,
} from "../../services/tonapi.js";
import { createUserWallet } from "../../services/userWallet.js";
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

  const [allExecs, totalInvested, tonPrice, depositAddress, poolApy] =
    await Promise.all([
      getLastExecutions(plan.id, 50),
      getTotalInvested(plan.id),
      getTonPriceUsd(),
      createUserWallet(telegramId).catch(() => ""),
      getPoolApy().catch(() => ({ stakingApy: 5.0, lpApy: 0.4, totalApy: 5.4 })),
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

  // ── Full portfolio value (TON + tsTON + USDT in wallet) ───────────────────
  let portfolioData = { totalUsd: 0, breakdown: { ton: 0, tston: 0, usdt: 0, lp: 0 } };
  try {
    portfolioData = await getPortfolioValueUsd(depositAddress, tonPrice);
  } catch { /* non-critical */ }

  // LP value (from STON.fi) + non-LP wallet assets = full portfolio
  const totalPortfolioUsd = (lpValueNum ?? 0) + portfolioData.totalUsd;

  // ── Average entry price: SUM(usdt_spent) / SUM(ton_received) ──────────────
  const successExecs = allExecs.filter((e) => e.status === "success");
  const totalUsdtSpent = successExecs.reduce((s, e) => s + (e.usdt_spent ?? 0), 0);
  const totalTonReceived = successExecs.reduce((s, e) => s + (e.ton_received ?? 0), 0);
  const avgEntryPrice =
    totalTonReceived > 0 ? totalUsdtSpent / totalTonReceived : null;

  // ── P&L (relative to total invested) ─────────────────────────────────────
  const pnlAbs = totalInvested > 0 ? totalPortfolioUsd - totalInvested : null;
  const pnlPct = pnlAbs != null && totalInvested > 0 ? (pnlAbs / totalInvested) * 100 : null;

  // ── 1-year projection ─────────────────────────────────────────────────────
  const FREQ_HOURS: Record<string, number> = {
    weekly: 7 * 24,
    biweekly: 14 * 24,
    monthly: 30 * 24,
    hourly: 1,
    minutely: 1 / 60,
  };
  let projectionBlock = "";
  try {
    const intervalHours = FREQ_HOURS[plan.frequency] ?? 7 * 24;
    // cap: даже при минутном интервале считаем не более 30 DCA-циклов в месяц
    const cyclesPerMonth = Math.min(30 * 24 / Math.max(intervalHours, 1), 30);
    const monthlyDca = plan.usdt_amount * cyclesPerMonth;
    const proj = projectPortfolio({
      currentValueUsd: totalPortfolioUsd,
      monthlyDcaUsd: monthlyDca,
      annualApy: poolApy.totalApy / 100,
      months: 12,
      tonPriceUsd: tonPrice > 0 ? tonPrice : 1,
    });
    projectionBlock =
      `\n━━━━━━━━━━━━━━━\n` +
      `🔮 Через 12 месяцев при текущей стратегии:\n` +
      `   ~${proj.futureTon.toFixed(0)} TON (~$${proj.futureValueUsd.toFixed(0)})\n` +
      `   из них yield: +$${proj.yieldEarnedUsd.toFixed(0)}\n`;
  } catch { /* non-critical */ }

  // ── Strategy comparison & time saved ──────────────────────────────────────
  let comparisonBlock = "";
  let timeSavedBlock = "";
  try {
    const createdAt = new Date(plan.created_at);
    const daysActive = Math.max(1, (Date.now() - createdAt.getTime()) / (1000 * 86400));

    const execResult = await pool.query(
      "SELECT COUNT(*) as cnt FROM executions WHERE plan_id = $1 AND status = 'success'",
      [plan.id]
    );
    const cycleCount = parseInt(execResult.rows[0]?.cnt ?? "0");

    if (totalInvested > 0) {
      const bankPnl    = totalInvested * 0.02 * (daysActive / 365);
      const stakingPnl = totalInvested * 0.05 * (daysActive / 365);
      const pnlVal     = pnlAbs ?? 0;
      const pnlPctVal  = pnlPct ?? 0;

      const fmtPnl = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;

      const lines: string[] = [
        `\n━━━━━━━━━━━━━━━`,
        `📊 *Что принесли бы те же $${totalInvested.toFixed(0)} за ${Math.round(daysActive)} дн:*`,
        ``,
        `Gramity DCA:      ${fmtPnl(pnlVal)} (${pnlVal >= 0 ? "+" : ""}${pnlPctVal.toFixed(1)}%) ✅`,
        `Только стейкинг:  ${fmtPnl(stakingPnl)} (${((stakingPnl / totalInvested) * 100).toFixed(1)}%)`,
        `Банк 2%:          ${fmtPnl(bankPnl)}`,
        `Держать USDT:     $0.00 (0%)`,
        ``,
      ];
      if (avgEntryPrice != null) {
        lines.push(`DCA усреднил цену входа: $${avgEntryPrice.toFixed(3)}/TON`);
      }
      if (tonPrice > 0) {
        lines.push(`Текущая цена:            $${tonPrice.toFixed(3)}/TON`);
      }
      comparisonBlock = lines.join("\n");
    }

    const minutesPerCycle = 45;
    const hoursSaved = (cycleCount * minutesPerCycle) / 60;
    const intervalHoursVal = FREQ_HOURS[plan.frequency] ?? 7 * 24;
    // cap: максимум 365 циклов в год (раз в день), чтобы не показывать ~394200 ч
    const cyclesPerYear = Math.min((365 * 24) / Math.max(intervalHoursVal, 1), 365);
    const yearlyHours = Math.round(cyclesPerYear * minutesPerCycle / 60);

    if (cycleCount > 0) {
      const plural =
        cycleCount === 1 ? "" : cycleCount % 10 >= 2 && cycleCount % 10 <= 4 && !(cycleCount % 100 >= 11 && cycleCount % 100 <= 14) ? "а" : "ов";
      timeSavedBlock = [
        `\n⏱ *Gramity сэкономил тебе:*`,
        `${cycleCount} цикл${plural} × ${minutesPerCycle} мин = *${hoursSaved.toFixed(1)} ч*`,
        `В год при текущей частоте: ~${yearlyHours} часов`,
      ].join("\n");
    }
  } catch { /* non-critical */ }

  // ── Format strings ─────────────────────────────────────────────────────────
  const statusEmoji = plan.active ? "🟢" : "⏸";
  const freqLabel = FREQ_LABELS[plan.frequency] ?? plan.frequency;

  const nextDate = new Date(plan.next_execution_at).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  });

  const apyTotal = apy7d != null ? 5 + apy7d : poolApy.totalApy;

  const portfolioLine = totalPortfolioUsd > 0 ? `💼 Портфель: $${fmt(totalPortfolioUsd)}\n` : "";
  const investedLine = `💰 Вложено: $${fmt(totalInvested)}\n`;
  // Не показываем PnL если кошелёк пуст (средства выведены или ещё не зачислены)
  const showPnl = totalPortfolioUsd > 0.5;
  const pnlLine =
    showPnl && pnlAbs != null && pnlPct != null
      ? `📈 PnL: ${pnlAbs >= 0 ? "+" : ""}$${fmt(pnlAbs)} (${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%)\n`
      : !showPnl && totalInvested > 0
        ? `_(Средства выведены или ещё не зачислены)_\n`
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
    `LP позиция: ${lpValueNum != null ? "$" + fmt(lpValueNum) : "—"}\n\n` +
    portfolioLine +
    investedLine +
    pnlLine +
    (tonPriceLines ? `\n${tonPriceLines}` : "") +
    `\nДоходность:\n` +
    `  tsTON стейкинг: ~${poolApy.stakingApy.toFixed(1)}%\n` +
    `  LP + фарминг:   ~${apy7d != null ? fmt(apy7d, 1) : poolApy.lpApy.toFixed(1)}%\n` +
    `  *Итого APY:*    ~${fmt(apyTotal, 1)}%\n` +
    projectionBlock +
    comparisonBlock +
    timeSavedBlock +
    `\n\n⏰ Следующий: ${nextDate}`;

  const pnlSign = pnlAbs != null && pnlAbs >= 0 ? "+" : "-";
  const shareText = encodeURIComponent(
    `Gramity заработал мне ${pnlSign}$${Math.abs(pnlAbs ?? 0).toFixed(2)} на автопилоте в TON DeFi.\n` +
      `DCA + стейкинг + ликвидность. @gramity_bot`
  );
  const shareUrl = `https://t.me/share/url?url=https://t.me/gramity_bot&text=${shareText}`;

  const kb = new InlineKeyboard()
    .text(plan.active ? "⏸ Пауза" : "▶️ Возобновить", plan.active ? "pause" : "resume")
    .text("💸 Вывести", "withdraw")
    .row()
    .url("📤 Поделиться результатом", shareUrl);

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
}
