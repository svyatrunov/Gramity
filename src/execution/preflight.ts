/**
 * Pre-flight checks run before every DCA cycle.
 * Validates USDT balance, TON gas, and plan status
 * without touching execution state.
 */

import { GAS_RESERVE_TON } from "../constants/dca.js";
import { getUserWalletContext } from "../services/userWallet.js";
import { getUsdtBalance, getTonBalance } from "../services/tonapi.js";
import type { Plan } from "../db/index.js";
import { hasWithdrawalAddress } from "../utils/tonAddress.js";
import { formatGasTopUpMessage } from "../utils/gasLink.js";

export type PreflightFailReason =
  | "insufficient_usdt"
  | "insufficient_gas"
  | "plan_paused"
  | "wallet_error"
  | "missing_withdrawal_address";

export interface PreflightResult {
  ok: boolean;
  reason?: PreflightFailReason;
  /** Internal log message */
  message?: string;
  /** Message to send to user via Telegram (undefined → do not notify) */
  userMessage?: string;
  /** true → skip notification silently */
  silent?: boolean;
  /** Resolved agent wallet address (only set on ok: true or balance failures) */
  walletAddress?: string;
  /** Actual USDT balance found (only set on insufficient_usdt) */
  usdtBalance?: number;
  /** Actual TON balance found (only set on insufficient_gas) */
  tonBalance?: number;
}

export async function preflightCheck(plan: Plan): Promise<PreflightResult> {
  // Check 0: plan must be active (race-condition guard, scheduler also checks)
  if (!plan.active) {
    return { ok: false, reason: "plan_paused", silent: true };
  }

  if (!hasWithdrawalAddress(plan.ton_address)) {
    return {
      ok: false,
      reason: "missing_withdrawal_address",
      message: "No withdrawal address configured",
      userMessage:
        `⚠️ *Cycle skipped — no withdrawal address*\n\n` +
        `Set your TON withdrawal wallet in the Mini App before cycles can run.\n\n` +
        `👉 Open App → Settings → withdrawal address`,
    };
  }

  // Load agent wallet
  let walletAddress: string;
  try {
    const walletCtx = await getUserWalletContext(plan.telegram_id);
    walletAddress = walletCtx.address;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "wallet_error",
      message: `Failed to load wallet: ${msg}`,
      userMessage:
        `❌ *Agent wallet error*\n\n` +
        `Could not load agent wallet. Contact support if this persists.`,
    };
  }

  // Check 1: USDT balance
  let usdtBalance: number;
  try {
    usdtBalance = await getUsdtBalance(walletAddress);
  } catch {
    usdtBalance = 0;
  }

  if (usdtBalance < plan.usdt_amount) {
    return {
      ok: false,
      reason: "insufficient_usdt",
      message: `Need $${plan.usdt_amount} USDT, have $${usdtBalance.toFixed(2)}`,
      userMessage:
        `⚠️ *Cycle Skipped — Insufficient Balance*\n\n` +
        `Your agent wallet needs $${plan.usdt_amount} USDT for the next cycle.\n` +
        `Current balance: $${usdtBalance.toFixed(2)} USDT\n\n` +
        `👉 Top up your agent wallet:\n\`${walletAddress}\`\n\n` +
        `_Strategy is paused until funded._`,
      walletAddress,
      usdtBalance,
    };
  }

  // Check 2: TON for gas
  let tonBalance: number;
  try {
    const tonNano = await getTonBalance(walletAddress);
    tonBalance = Number(tonNano) / 1e9;
  } catch {
    tonBalance = 0;
  }

  if (tonBalance < GAS_RESERVE_TON) {
    return {
      ok: false,
      reason: "insufficient_gas",
      message: `Need ${GAS_RESERVE_TON} TON for gas, have ${tonBalance.toFixed(3)}`,
      userMessage: formatGasTopUpMessage(walletAddress, tonBalance),
      walletAddress,
      tonBalance,
    };
  }

  return { ok: true, walletAddress };
}
