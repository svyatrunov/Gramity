/**
 * Multi-strategy execution engine — wraps existing swap / stake / LP steps.
 */

import {
  Address,
  SendMode,
  fromNano,
  internal,
  toNano,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import { step1Swap } from "./step1-swap.js";
import { step2CalculateSplit } from "./step2-split.js";
import { step3Stake } from "./step3-stake.js";
import { step4ProvideLiquidity } from "./step4-liquidity.js";
import { getUserWalletContext } from "./services/userWallet.js";
import { sendJettonTransfer } from "./services/jetton.js";
import { getLastTxHash, getTonBalance } from "./services/tonapi.js";
import { TSTON_ADDRESS, POOL_ADDRESS } from "./config.js";
import {
  updateStrategyStats,
  setStrategyLastError,
  type Strategy,
  type StrategyType,
} from "./db/index.js";
import type { WalletContext } from "./wallet.js";
import { sleep } from "./wallet.js";

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

const GAS_RESERVE = toNano("0.3");

async function sendTon(
  walletCtx: WalletContext,
  toAddress: string,
  amountNano: bigint
): Promise<string> {
  if (amountNano <= toNano("0.01")) {
    throw new Error("TON amount too small to send");
  }
  const typedContract = walletCtx.contract as unknown as TypedContract;
  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(walletCtx.key.secretKey),
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: amountNano,
        bounce: false,
      }),
    ],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
  await sleep(2_000);
  return (await getLastTxHash(walletCtx.address, 5_000)) ?? "ton_transfer";
}

async function sendJetton(
  walletCtx: WalletContext,
  jettonMaster: string,
  amountRaw: bigint,
  toAddress: string
): Promise<string> {
  await sendJettonTransfer(walletCtx, jettonMaster, amountRaw, toAddress);
  await sleep(2_000);
  return (await getLastTxHash(walletCtx.address, 5_000)) ?? "jetton_transfer";
}

export async function swapUsdtToTon(
  telegramId: number,
  amountUsdt: number
): Promise<{ tonNano: bigint; txHash: string | null }> {
  const walletCtx = await getUserWalletContext(telegramId);
  const result = await step1Swap(walletCtx, amountUsdt);
  const tonNano = result.kind === "native" ? result.amountNano : 0n;
  const txHash = await getLastTxHash(walletCtx.address, 3_000);
  return { tonNano, txHash };
}

export async function swapUsdtToJetton(
  telegramId: number,
  amountUsdt: number,
  jettonMaster: string
): Promise<{ amountRaw: bigint; txHash: string | null }> {
  const walletCtx = await getUserWalletContext(telegramId);
  const result = await step1Swap(walletCtx, amountUsdt, {
    targetJettonAddress: jettonMaster,
  });
  const amountRaw = result.kind === "jetton" ? result.amountRaw : 0n;
  const txHash = await getLastTxHash(walletCtx.address, 3_000);
  return { amountRaw, txHash };
}

export async function swapUsdtToTston(
  telegramId: number,
  amountUsdt: number
): Promise<{ tstonNano: bigint; txHash: string | null }> {
  const walletCtx = await getUserWalletContext(telegramId);
  const swapResult = await step1Swap(walletCtx, amountUsdt);
  const tonNano = swapResult.kind === "native" ? swapResult.amountNano : 0n;
  const splitInfo = await step2CalculateSplit(tonNano);
  const { tsTonReceived } = await step3Stake(walletCtx, splitInfo.stakeAmount);
  const txHash = await getLastTxHash(walletCtx.address, 3_000);
  return { tstonNano: tsTonReceived, txHash };
}

export async function addLiquidityFromUsdt(
  telegramId: number,
  amountUsdt: number
): Promise<{ lpTokensNano: bigint; txHash: string | null }> {
  const walletCtx = await getUserWalletContext(telegramId);
  const swapResult = await step1Swap(walletCtx, amountUsdt);
  const tonNano = swapResult.kind === "native" ? swapResult.amountNano : 0n;
  const splitInfo = await step2CalculateSplit(tonNano);
  const { tsTonReceived, tsTonAddress } = await step3Stake(walletCtx, splitInfo.stakeAmount);
  const resolvedTston = tsTonAddress || TSTON_ADDRESS;
  const { lpTokensReceived } = await step4ProvideLiquidity(
    walletCtx,
    tsTonReceived,
    splitInfo.keepAmount,
    splitInfo,
    resolvedTston
  );
  const txHash = await getLastTxHash(walletCtx.address, 3_000);
  return { lpTokensNano: lpTokensReceived, txHash };
}

export async function executeMultiStrategy(
  strategy: Strategy,
  telegramId: number
): Promise<void> {
  const startTime = Date.now();

  try {
    console.log(
      `[EXEC] Strategy #${strategy.id} type=${strategy.strategy_type} user=${telegramId}`
    );

    const walletCtx = await getUserWalletContext(telegramId);
    const withdrawal = strategy.withdrawal_wallet?.trim();
    let txHash: string | null = null;

    switch (strategy.strategy_type) {
      case "dca_ton": {
        if (!withdrawal) throw new Error("withdrawal_wallet required for dca_ton");
        const { tonNano } = await swapUsdtToTon(telegramId, strategy.amount_usdt);
        const balance = await getTonBalance(walletCtx.address);
        const sendable =
          balance > GAS_RESERVE ? (tonNano < balance - GAS_RESERVE ? tonNano : balance - GAS_RESERVE) : 0n;
        txHash = await sendTon(walletCtx, withdrawal, sendable);
        break;
      }

      case "dca_tston": {
        if (!withdrawal) throw new Error("withdrawal_wallet required for dca_tston");
        const { tstonNano } = await swapUsdtToTston(telegramId, strategy.amount_usdt);
        if (strategy.output_mode === "withdraw" && tstonNano > 0n) {
          txHash = await sendJetton(walletCtx, TSTON_ADDRESS, tstonNano, withdrawal);
        } else {
          txHash = "held_custodial";
        }
        break;
      }

      case "dca_lp": {
        const { lpTokensNano } = await addLiquidityFromUsdt(telegramId, strategy.amount_usdt);
        if (strategy.output_mode === "withdraw") {
          if (!withdrawal) throw new Error("withdrawal_wallet required for dca_lp withdraw");
          txHash = await sendJetton(walletCtx, POOL_ADDRESS, lpTokensNano, withdrawal);
        } else {
          txHash = "lp_reinvest";
        }
        break;
      }

      case "dca_jetton": {
        if (!withdrawal) throw new Error("withdrawal_wallet required for dca_jetton");
        const jettonMaster = strategy.target_token_address?.trim();
        if (!jettonMaster) throw new Error("target_token_address required for dca_jetton");
        const { amountRaw } = await swapUsdtToJetton(
          telegramId,
          strategy.amount_usdt,
          jettonMaster
        );
        if (amountRaw > 0n) {
          txHash = await sendJetton(walletCtx, jettonMaster, amountRaw, withdrawal);
        } else {
          throw new Error("Swap returned zero jetton amount");
        }
        break;
      }

      default:
        throw new Error(`Unknown strategy type: ${strategy.strategy_type}`);
    }

    await updateStrategyStats(strategy.id, strategy.amount_usdt, null);
    console.log(
      `[EXEC] Strategy #${strategy.id} done in ${Date.now() - startTime}ms tx=${txHash ?? "n/a"}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[EXEC] Strategy #${strategy.id} failed:`, message);
    await setStrategyLastError(strategy.id, message);
    throw error;
  }
}
