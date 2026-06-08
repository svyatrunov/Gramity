import { StonApiClient } from "@ston-fi/api";
import {
  getPlanByTelegramId,
  getLastExecutions,
  getTotalInvested,
} from "../db/index.js";
import { GAS_RESERVE_TON, formatPlanFrequency } from "../constants/dca.js";
import { preflightCheck } from "../execution/preflight.js";
import {
  getTonPriceUsd,
  getUsdtBalance,
  getPortfolioValueUsd,
} from "../services/tonapi.js";
import { createUserWallet } from "../services/userWallet.js";
import { POOL_ADDRESS, STON_API_URL } from "../config.js";
import { maskAddress } from "./utils.js";
import { hasWithdrawalAddress } from "../utils/tonAddress.js";
import type { Plan } from "../db/index.js";

const STRATEGY_LABELS: Record<string, string> = {
  full: "TON+LP",
  stake_only: "TON",
  accumulate: "STON",
};

function mapStrategyMode(mode: string): string {
  return STRATEGY_LABELS[mode] ?? "TON+LP";
}

function planToStrategy(plan: Plan) {
  return {
    id: plan.id,
    amount_usdt: Number(plan.usdt_amount),
    frequency: plan.frequency,
    frequency_label: formatPlanFrequency(plan.frequency, plan.demo_mode),
    quick_mode: plan.demo_mode,
    demo_mode: plan.demo_mode,
    max_cycles: plan.max_cycles,
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
  const withdrawalAddressSet = hasWithdrawalAddress(plan.ton_address);

  let topUpHint: string | undefined;
  let cycleBlockedReason: string | undefined;
  let suggestedAction: string | undefined;

  if (!canRunNextCycle) {
    if (preflight.reason === "missing_withdrawal_address") {
      cycleBlockedReason = "missing_withdrawal_address";
      topUpHint =
        "Set TON withdrawal address via set_withdrawal_address or Mini App before cycles can run.";
      suggestedAction = "set_withdrawal_address";
    } else if (preflight.reason === "insufficient_usdt") {
      cycleBlockedReason = "insufficient_usdt";
      topUpHint = `Top up agent wallet with $${nextCycleRequiresUsdt} USDT`;
    } else if (preflight.reason === "insufficient_gas") {
      cycleBlockedReason = "insufficient_gas";
      topUpHint = `Send ${GAS_RESERVE_TON} TON to agent wallet for gas`;
    } else {
      topUpHint = `Top up agent wallet with $${nextCycleRequiresUsdt} USDT + ${GAS_RESERVE_TON} TON gas`;
    }
  }

  const status = plan.active ? "active" : "paused";
  const canRunNow =
    withdrawalAddressSet && usdtBalance >= Number(plan.usdt_amount);

  return {
    telegram_id: telegramId,
    total_usd: totalUsd,
    est_value_usd: estValueUsd,
    ton_balance_usd: tonBalanceUsd,
    usdt_balance: usdtBalance,
    next_cycle_requires_usdt: nextCycleRequiresUsdt,
    next_cycle_requires_gas_ton: GAS_RESERVE_TON,
    can_run_next_cycle: canRunNextCycle,
    can_run_now: canRunNow,
    top_up_hint: topUpHint,
    cycle_blocked_reason: cycleBlockedReason,
    suggested_action: suggestedAction,
    lp_value_usd: lpValue,
    total_invested_usd: totalInvested,
    total_invested_usdt: totalInvested,
    cycles_done: plan.cycles_completed,
    cycles_completed: plan.cycles_completed,
    next_cycle_at: plan.next_execution_at,
    next_cycle: plan.active ? plan.next_execution_at : null,
    frequency: plan.frequency,
    amount_usdt: Number(plan.usdt_amount),
    status,
    agent_wallet_balance_usdt: usdtBalance,
    withdrawal_address: plan.ton_address ? maskAddress(plan.ton_address) : null,
    withdrawal_address_masked: plan.ton_address ? maskAddress(plan.ton_address) : null,
    withdrawal_address_set: withdrawalAddressSet,
    agent_wallet_address: depositAddress,
    quick_mode: plan.demo_mode,
    demo_mode: plan.demo_mode,
    max_cycles: plan.max_cycles,
    strategies: [planToStrategy(plan)],
    recent_executions: executions.map((e) => ({
      executed_at: e.executed_at,
      usdt_spent: e.usdt_spent,
      status: e.status,
    })),
  };
}
