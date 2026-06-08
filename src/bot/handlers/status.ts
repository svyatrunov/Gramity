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
import { POOL_ADDRESS, STON_API_URL, RAILWAY_PUBLIC_URL } from "../../config.js";
import { InlineKeyboard } from "grammy";

const MINI_APP_URL = `${RAILWAY_PUBLIC_URL}/app`;

const fmt = (v: number | null | undefined, decimals = 2): string =>
  v != null && !isNaN(v) && isFinite(v) && v !== 0
    ? v.toFixed(decimals)
    : "—";

const FREQ_LABELS: Record<string, string> = {
  weekly:   "weekly",
  biweekly: "every 2 weeks",
  monthly:  "monthly",
  daily:    "daily",
  minutely: "every minute",
  hourly:   "every hour",
};

export async function handleStatus(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply(
      "No active strategy yet.\n\nUse /start to set up Gramity."
    );
    return;
  }

  await ctx.reply("⏳ Loading your position...");

  const [allExecs, totalInvested, tonPrice, depositAddress, poolApy] =
    await Promise.all([
      getLastExecutions(plan.id, 50),
      getTotalInvested(plan.id),
      getTonPriceUsd(),
      createUserWallet(telegramId).catch(() => ""),
      getPoolApy().catch(() => ({ stakingApy: 5.0, lpApy: 0.4, totalApy: 5.4 })),
    ]);

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

  const depositBalance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

  let portfolioData = { totalUsd: 0, breakdown: { ton: 0, tston: 0, usdt: 0, lp: 0 } };
  try {
    portfolioData = await getPortfolioValueUsd(depositAddress, tonPrice);
  } catch { /* non-critical */ }

  const totalPortfolioUsd = (lpValueNum ?? 0) + portfolioData.totalUsd;

  const successExecs    = allExecs.filter((e) => e.status === "success");
  const totalUsdtSpent  = successExecs.reduce((s, e) => s + (e.usdt_spent ?? 0), 0);
  const totalTonReceived = successExecs.reduce((s, e) => s + (e.ton_received ?? 0), 0);
  const avgEntryPrice   = totalTonReceived > 0 ? totalUsdtSpent / totalTonReceived : null;

  const pnlAbs = totalInvested > 0 ? totalPortfolioUsd - totalInvested : null;
  const pnlPct = pnlAbs != null && totalInvested > 0 ? (pnlAbs / totalInvested) * 100 : null;

  // ── 1-year projection ──────────────────────────────────────────────────────
  const FREQ_HOURS: Record<string, number> = {
    weekly:   7 * 24,
    biweekly: 14 * 24,
    monthly:  30 * 24,
    daily:    24,
    hourly:   1,
    minutely: 1 / 60,
  };

  let projectionBlock = "";
  try {
    const intervalHours   = FREQ_HOURS[plan.frequency] ?? 7 * 24;
    const cyclesPerMonth  = Math.min(30 * 24 / Math.max(intervalHours, 1), 30);
    const monthlyDca      = plan.usdt_amount * cyclesPerMonth;
    const proj = projectPortfolio({
      currentValueUsd: totalPortfolioUsd,
      monthlyDcaUsd:   monthlyDca,
      annualApy:       poolApy.totalApy / 100,
      months:          12,
      tonPriceUsd:     tonPrice > 0 ? tonPrice : 1,
    });
    projectionBlock =
      `\n━━━━━━━━━━━━━━━\n` +
      `🔮 In 12 months at current strategy:\n` +
      `   ~${proj.futureTon.toFixed(0)} TON (~$${proj.futureValueUsd.toFixed(0)})\n` +
      `   yield: +$${proj.yieldEarnedUsd.toFixed(0)}\n`;
  } catch { /* non-critical */ }

  // ── Strategy comparison & time saved ──────────────────────────────────────
  let comparisonBlock = "";
  let timeSavedBlock  = "";
  try {
    const createdAt  = new Date(plan.created_at);
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
        `📊 *Same $${totalInvested.toFixed(0)} over ${Math.round(daysActive)} days:*`,
        ``,
        `Gramity DCA:    ${fmtPnl(pnlVal)} (${pnlVal >= 0 ? "+" : ""}${pnlPctVal.toFixed(1)}%) ✅`,
        `Staking only:   ${fmtPnl(stakingPnl)} (${((stakingPnl / totalInvested) * 100).toFixed(1)}%)`,
        `Bank 2%:        ${fmtPnl(bankPnl)}`,
        `Hold USDT:      $0.00 (0%)`,
        ``,
      ];
      if (avgEntryPrice != null) {
        lines.push(`DCA avg entry: $${avgEntryPrice.toFixed(3)}/TON`);
      }
      if (tonPrice > 0) {
        lines.push(`Current price: $${tonPrice.toFixed(3)}/TON`);
      }
      comparisonBlock = lines.join("\n");
    }

    const minutesPerCycle = 7;
    const hoursSaved      = (cycleCount * minutesPerCycle) / 60;
    const intervalHoursVal = FREQ_HOURS[plan.frequency] ?? 7 * 24;
    const cyclesPerYear    = Math.min((365 * 24) / Math.max(intervalHoursVal, 1), 365);
    const yearlyHours      = Math.round(cyclesPerYear * minutesPerCycle / 60);

    if (cycleCount > 0) {
      timeSavedBlock = [
        `\n⏱ *Time saved by Gramity:*`,
        `${cycleCount} cycle${cycleCount !== 1 ? "s" : ""} × ${minutesPerCycle} min = *${hoursSaved.toFixed(1)} h*`,
        `At this frequency: ~${yearlyHours} hours/year`,
      ].join("\n");
    }
  } catch { /* non-critical */ }

  const statusEmoji = plan.active ? "🟢" : "⏸";
  const freqLabel   = FREQ_LABELS[plan.frequency] ?? plan.frequency;
  const nextDate    = new Date(plan.next_execution_at).toLocaleDateString("en-US", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
    timeZone: "UTC",
  });
  const apyTotal = apy7d != null ? 5 + apy7d : poolApy.totalApy;

  const portfolioLine = totalPortfolioUsd > 0 ? `💼 Portfolio: $${fmt(totalPortfolioUsd)}\n` : "";
  const investedLine  = `💰 Invested: $${fmt(totalInvested)}\n`;
  const showPnl       = totalPortfolioUsd > 0.5;
  const pnlLine =
    showPnl && pnlAbs != null && pnlPct != null
      ? `📈 PnL: ${pnlAbs >= 0 ? "+" : ""}$${fmt(pnlAbs)} (${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%)\n`
      : !showPnl && totalInvested > 0
        ? `_(Funds withdrawn or not yet credited)_\n`
        : "";

  const tonPriceLines =
    tonPrice > 0 || avgEntryPrice != null
      ? (avgEntryPrice != null ? `Avg entry: $${fmt(avgEntryPrice)}/TON\n` : "") +
        (tonPrice > 0 ? `Current TON: $${fmt(tonPrice)}\n` : "")
      : "";

  const text =
    `📊 *Gramity — Your Position*\n\n` +
    `${statusEmoji} ${plan.active ? "Active" : "Paused"} · $${plan.usdt_amount} USDT ${freqLabel}\n\n` +
    `Deposit balance: $${fmt(depositBalance)}\n` +
    `LP position: ${lpValueNum != null ? "$" + fmt(lpValueNum) : "—"}\n\n` +
    portfolioLine +
    investedLine +
    pnlLine +
    (tonPriceLines ? `\n${tonPriceLines}` : "") +
    `\nYield breakdown:\n` +
    `  tsTON staking: ~${poolApy.stakingApy.toFixed(1)}%\n` +
    `  LP + farming:  ~${apy7d != null ? fmt(apy7d, 1) : poolApy.lpApy.toFixed(1)}%\n` +
    `  *Total APY:*   ~${fmt(apyTotal, 1)}%\n` +
    projectionBlock +
    comparisonBlock +
    timeSavedBlock +
    `\n\n⏰ Next cycle: ${nextDate}`;

  const pnlSign  = pnlAbs != null && pnlAbs >= 0 ? "+" : "-";
  const shareText = encodeURIComponent(
    `Gramity earned me ${pnlSign}$${Math.abs(pnlAbs ?? 0).toFixed(2)} on auto-pilot in TON DeFi.\n` +
      `DCA + staking + liquidity. @gramity_bot`
  );
  const shareUrl = `https://t.me/share/url?url=https://t.me/gramity_bot&text=${shareText}`;

  const dashboardUrl = `${MINI_APP_URL}/dashboard.html#strategy-${plan.id}`;

  const kb = new InlineKeyboard()
    .webApp("📱 Open Dashboard", dashboardUrl)
    .row()
    .text(plan.active ? "⏸ Pause" : "▶️ Resume", plan.active ? "pause" : "resume")
    .webApp("+ New Strategy", `${MINI_APP_URL}/onboarding.html`);

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
}
