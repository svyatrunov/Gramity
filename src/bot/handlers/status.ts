import { StonApiClient } from "@ston-fi/api";
import type { GramityContext } from "../context.js";
import { getPlanByTelegramId } from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { createUserWallet } from "../../services/userWallet.js";
import { POOL_ADDRESS, STON_API_URL, RAILWAY_PUBLIC_URL } from "../../config.js";
import { InlineKeyboard } from "grammy";

const dashboardUrl = `${RAILWAY_PUBLIC_URL}/app/dashboard.html`;

const fmt = (v: number | null | undefined, decimals = 2): string =>
  v != null && !isNaN(v) && isFinite(v)
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

function formatNextDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
    hour:    "2-digit",
    minute:  "2-digit",
    timeZone: "UTC",
  });
}

export async function handleStatus(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  if (!plan) {
    await ctx.reply("No active strategy yet.\n\nUse /start to set up Gramity.");
    return;
  }

  const depositAddress = await createUserWallet(telegramId).catch(() => "");
  const depositBalance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

  let lpValueNum: number | null = null;
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
  } catch {
    /* non-critical */
  }

  const lpPositionUsd = lpValueNum ?? 0;
  const totalAssetsUsd = depositBalance + lpPositionUsd;
  const freqLabel = FREQ_LABELS[plan.frequency] ?? plan.frequency;
  const statusLabel = plan.active ? "active" : "paused";
  const nextDate = formatNextDate(plan.next_execution_at);

  const text =
    `Portfolio\n\n` +
    `Deposit    *$${fmt(depositBalance)}* USDT\n` +
    `LP         *$${fmt(lpPositionUsd)}*\n` +
    `Total      *$${fmt(totalAssetsUsd)}*\n\n` +
    `Strategy   *$${plan.usdt_amount} / ${freqLabel}* · ${statusLabel}\n` +
    `Next       ${nextDate}`;

  const kb = new InlineKeyboard().webApp("Dashboard", dashboardUrl);

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
}
