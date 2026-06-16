/**
 * Auto-payout — sends a percentage of the accumulated TARGET asset to the
 * user's withdrawal wallet every N cycles. Unlike exit.ts (full unwind), this
 * withdraws the target asset "as is" (no LP burn / unstake):
 *
 *   strategy_mode === "accumulate" → native TON
 *   strategy_mode === "stake_only" → tsTON jetton
 *   strategy_mode === "full"       → STON.fi LP jetton
 *
 * Triggered from the scheduler after a successful cycle when
 * cycles_completed % payout_every_n_cycles === 0.
 */

import {
  Address,
  JettonMaster,
  JettonWallet,
  internal,
  SendMode,
  toNano,
  fromNano,
  WalletContractV4,
  type OpenedContract,
} from "@ton/ton";
import type { Plan } from "../db/index.js";
import { getUserWalletContext } from "../services/userWallet.js";
import type { WalletContext } from "../wallet.js";
import { sendJettonTransfer } from "../services/jetton.js";
import { getTonBalance } from "../services/tonapi.js";
import { TSTON_ADDRESS, POOL_ADDRESS } from "../config.js";
import { hasWithdrawalAddress } from "../utils/tonAddress.js";

/** TON kept on the agent wallet for gas (never paid out). */
const GAS_RESERVE = toNano("0.3");
/** Minimum native TON worth sending (avoids dust transactions). */
const MIN_TON_PAYOUT = toNano("0.05");

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

export type PayoutAssetKind = "ton" | "tston" | "lp";

export interface PayoutTarget {
  kind: PayoutAssetKind;
  symbol: string;
  /** Jetton master address — undefined for native TON. */
  master?: string;
}

export interface PayoutResult {
  sent: boolean;
  /** Human-readable amount actually sent (e.g. "1.2345"). */
  amount: string;
  symbol: string;
  /** Reason when sent === false. */
  reason?: string;
}

/**
 * Pure predicate: should a payout fire after this cycle?
 * `cyclesCompleted` is the post-cycle counter.
 */
export function shouldPayout(
  plan: Pick<Plan, "payout_enabled" | "payout_percent" | "payout_every_n_cycles" | "ton_address">,
  cyclesCompleted: number
): boolean {
  if (!plan.payout_enabled) return false;
  if (!hasWithdrawalAddress(plan.ton_address)) return false;
  const pct = Number(plan.payout_percent) || 0;
  if (pct <= 0) return false;
  const n = Math.max(1, Math.floor(Number(plan.payout_every_n_cycles) || 1));
  if (cyclesCompleted <= 0) return false;
  return cyclesCompleted % n === 0;
}

/** Resolve which asset the strategy accumulates. */
export function resolvePayoutTarget(plan: Pick<Plan, "strategy_mode">): PayoutTarget {
  switch (plan.strategy_mode) {
    case "accumulate":
      return { kind: "ton", symbol: "TON" };
    case "full":
      return { kind: "lp", symbol: "LP", master: POOL_ADDRESS };
    case "stake_only":
    default:
      return { kind: "tston", symbol: "tsTON", master: TSTON_ADDRESS };
  }
}

/** Clamp percent to [0,100] and apply to a raw balance using integer math. */
export function applyPercentRaw(balanceRaw: bigint, percent: number): bigint {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (pct <= 0 || balanceRaw <= 0n) return 0n;
  if (pct >= 100) return balanceRaw;
  return (balanceRaw * BigInt(pct)) / 100n;
}

/** Query a jetton balance directly on-chain (works for LP + tsTON). */
async function getJettonBalanceOnChain(
  walletCtx: WalletContext,
  jettonMasterAddr: string
): Promise<bigint> {
  try {
    const master = walletCtx.client.open(
      JettonMaster.create(Address.parse(jettonMasterAddr))
    );
    const userJettonWalletAddr = await master.getWalletAddress(
      Address.parse(walletCtx.address)
    );
    const userJettonWallet = walletCtx.client.open(
      JettonWallet.create(userJettonWalletAddr)
    );
    return await userJettonWallet.getBalance();
  } catch (err) {
    console.error(
      `[PAYOUT] Failed to read jetton balance (${jettonMasterAddr.slice(0, 8)}…):`,
      err instanceof Error ? err.message : String(err)
    );
    return 0n;
  }
}

async function sendNativeTon(
  walletCtx: WalletContext,
  amountNano: bigint,
  toAddress: string
): Promise<void> {
  const typedContract = walletCtx.contract as unknown as TypedContract;
  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(walletCtx.key.secretKey),
    messages: [
      internal({ to: Address.parse(toAddress), value: amountNano, bounce: false }),
    ],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
}

/**
 * Execute a single auto-payout for `plan`. Assumes shouldPayout() already
 * returned true. Never throws — returns a structured result.
 */
export async function executePayout(plan: Plan): Promise<PayoutResult> {
  const target = resolvePayoutTarget(plan);
  const toAddress = (plan.ton_address ?? "").trim();

  if (!hasWithdrawalAddress(toAddress)) {
    return { sent: false, amount: "0", symbol: target.symbol, reason: "no_withdrawal_address" };
  }

  try {
    const walletCtx = await getUserWalletContext(plan.telegram_id);

    if (target.kind === "ton") {
      const balance = await getTonBalance(walletCtx.address);
      const spendable = balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n;
      const amount = applyPercentRaw(spendable, plan.payout_percent);
      if (amount < MIN_TON_PAYOUT) {
        return { sent: false, amount: "0", symbol: "TON", reason: "below_minimum" };
      }
      await sendNativeTon(walletCtx, amount, toAddress);
      const human = fromNano(amount);
      console.log(`[PAYOUT] Plan ${plan.id}: sent ${human} TON → ${toAddress.slice(0, 8)}…`);
      return { sent: true, amount: human, symbol: "TON" };
    }

    // Jetton payout (tsTON or LP)
    const master = target.master as string;
    const balanceRaw = await getJettonBalanceOnChain(walletCtx, master);
    const amountRaw = applyPercentRaw(balanceRaw, plan.payout_percent);
    if (amountRaw <= 0n) {
      return { sent: false, amount: "0", symbol: target.symbol, reason: "zero_balance" };
    }
    await sendJettonTransfer(walletCtx, master, amountRaw, toAddress);
    const human = fromNano(amountRaw);
    console.log(
      `[PAYOUT] Plan ${plan.id}: sent ${human} ${target.symbol} → ${toAddress.slice(0, 8)}…`
    );
    return { sent: true, amount: human, symbol: target.symbol };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PAYOUT] Plan ${plan.id} payout failed:`, msg);
    return { sent: false, amount: "0", symbol: target.symbol, reason: msg };
  }
}
