import { StonApiClient } from "@ston-fi/api";
import {
  getPlanByTelegramId,
  getLastExecutions,
  getTotalInvested,
} from "../db/index.js";
import { GAS_RESERVE_TON } from "../constants/dca.js";
import { preflightCheck } from "../execution/preflight.js";
import {
  getTonPriceUsd,
  getUsdtBalance,
  getPortfolioValueUsd,
} from "../services/tonapi.js";
import { createUserWallet } from "../services/userWallet.js";
import { POOL_ADDRESS, STON_API_URL } from "../config.js";
import { maskAddress } from "./utils.js";
import type { Plan } from "../db/index.js";

const STRATEGY_LABELS: Record<string, string> = {
  full: "TON+LP",
  stake_only: "TON",
  accumulate: "STON",
};

const FREQ_LABELS: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
};

function mapStrategyMode(mode: string): string {
  return STRATEGY_LABELS[mode] ?? "TON+LP";
}

function planToStrategy(plan: Plan) {
  return {
    id: plan.id,
    amount_usdt: Number(plan.usdt_amount),
    frequency: plan.frequency,
    frequency_label: FREQ_LABELS[plan.frequency] ?? plan.frequency,
    strategy: mapStrategyMode(plan.strategy_mode),
    status: plan.active ? "active" : "paused",
    cycles_done: plan.cycles_completed,
    next_cycle_at: plan.next_execution_at,
  };
}

export async function buildMiraPortfolio(telegramId: number) {
  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) {
    throw new Error("User not found");
  }

  const depositAddress = await createUserWallet(telegramId).catch(() => "");
  const tonPrice = await getTonPriceUsd().catch(() => 0);

  let portfolioData = { totalUsd: 0, breakdown: { ton: 0, tston: 0, usdt: 0, lp: 0 } };
  try {
    portfolioData = await getPortfolioValueUsd(depositAddress, tonPrice);
  } catch {
    /* fallback below */
  }

  let lpValue = 0;
  if (depositAddress) {
    try {
      const sc = new StonApiClient({ baseUrl: STON_API_URL });
      const wp = await sc.getWalletPool({
        walletAddress: depositAddress,
        poolAddress: POOL_ADDRESS,
      });
      if (wp?.lpBalance && wp.lpTotalSupplyUsd && wp.lpTotalSupply) {
        const share = Number(wp.lpBalance) / Number(wp.lpTotalSupply);
        lpValue = share * Number(wp.lpTotalSupplyUsd);
      }
    } catch {
      /* non-fatal */
    }
  }

  const usdtBalance = depositAddress ? await getUsdtBalance(depositAddress).catch(() => 0) : 0;
  const tonBalanceUsd = portfolioData.breakdown.ton + portfolioData.breakdown.tston;
  const estValueUsd = (lpValue || 0) + portfolioData.totalUsd + usdtBalance;
  const totalUsd = estValueUsd > 0 ? estValueUsd : usdtBalance;

  const totalInvested = await getTotalInvested(plan.id).catch(() => 0);
  const executions = await getLastExecutions(plan.id, 10).catch(() => []);

  const nextCycleRequiresUsdt = Number(plan.usdt_amount);
  const preflight = await preflightCheck(plan);
  const canRunNextCycle = preflight.ok;
  const topUpHint = canRunNextCycle
    ? undefined
    : `Top up agent wallet with $${nextCycleRequiresUsdt} USDT + ${GAS_RESERVE_TON} TON gas`;

  return {
    telegram_id: telegramId,
    total_usd: totalUsd,
    est_value_usd: estValueUsd,
    ton_balance_usd: tonBalanceUsd,
    usdt_balance: usdtBalance,
    next_cycle_requires_usdt: nextCycleRequiresUsdt,
    next_cycle_requires_gas_ton: GAS_RESERVE_TON,
    can_run_next_cycle: canRunNextCycle,
    top_up_hint: topUpHint,
    lp_value_usd: lpValue,
    total_invested_usd: totalInvested,
    cycles_done: plan.cycles_completed,
    next_cycle_at: plan.next_execution_at,
    withdrawal_address_masked: maskAddress(plan.ton_address),
    agent_wallet_address: depositAddress,
    strategies: [planToStrategy(plan)],
    recent_executions: executions.map((e) => ({
      executed_at: e.executed_at,
      usdt_spent: e.usdt_spent,
      status: e.status,
    })),
  };
}
