/**
 * Full position exit orchestrator.
 *
 * Flow:
 *   1. Burn LP tokens — balance checked DIRECTLY on-chain via JettonWallet,
 *      not via STON.fi API (which can return empty for some wallets).
 *   2. Burn tsTON → TON (Tonstakers instant unstake)
 *   3. Wait for assets to settle
 *   4. Sweep ALL jettons (verified + LP proceeds) + remaining TON → user's ton_address
 */

import {
  Address,
  JettonMaster,
  JettonWallet,
  fromNano,
  toNano,
  type OpenedContract,
  WalletContractV4,
  internal,
  SendMode,
} from "@ton/ton";
import type { Plan } from "../db/index.js";
import { getUserWalletContext } from "../services/userWallet.js";
import { sendJettonTransfer, burnJetton } from "../services/jetton.js";
import { removeLpViaSdk } from "../services/stonfi.js";
import { getAllVerifiedJettons, getTonBalance } from "../services/tonapi.js";
import { POOL_ADDRESS, TSTON_ADDRESS, USDT_ADDRESS, USDT_DECIMALS } from "../config.js";
import { sleep } from "../wallet.js";
import type { WalletContext } from "../wallet.js";

export interface ExitResult {
  usdtSent: number;
  summary: string[];
}

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

/** Query LP token balance directly on-chain (bypasses STON.fi API) */
async function getLpBalanceOnChain(
  walletCtx: WalletContext,
  lpMasterAddr: string
): Promise<bigint> {
  try {
    const lpMaster = walletCtx.client.open(
      JettonMaster.create(Address.parse(lpMasterAddr))
    );
    const userLpWalletAddr = await lpMaster.getWalletAddress(
      Address.parse(walletCtx.address)
    );
    const userLpWallet = walletCtx.client.open(
      JettonWallet.create(userLpWalletAddr)
    );
    return await userLpWallet.getBalance();
  } catch {
    return 0n;
  }
}

/** Query any jetton balance directly on-chain */
async function getJettonBalanceOnChain(
  walletCtx: WalletContext,
  jettonMasterAddr: string
): Promise<bigint> {
  try {
    const master = walletCtx.client.open(
      JettonMaster.create(Address.parse(jettonMasterAddr))
    );
    const userWalletAddr = await master.getWalletAddress(
      Address.parse(walletCtx.address)
    );
    const userWallet = walletCtx.client.open(
      JettonWallet.create(userWalletAddr)
    );
    return await userWallet.getBalance();
  } catch {
    return 0n;
  }
}

export async function executeFullExit(plan: Plan): Promise<ExitResult> {
  const telegramId = plan.telegram_id;
  console.log(`[EXIT] Starting full exit for user ${telegramId}`);

  const walletCtx = await getUserWalletContext(telegramId);
  const { address } = walletCtx;
  const typedContract = walletCtx.contract as unknown as TypedContract;

  const summary: string[] = [];

  // ── Step 1: Burn LP tokens via STON.fi SDK (on-chain balance check) ─────────
  try {
    console.log("[EXIT] Step 1: Checking LP balance on-chain...");
    const lpBalance = await getLpBalanceOnChain(walletCtx, POOL_ADDRESS);
    console.log(`[EXIT] LP balance: ${fromNano(lpBalance)} LP tokens`);

    if (lpBalance > 0n) {
      console.log("[EXIT] Removing LP via STON.fi SDK...");
      await removeLpViaSdk(walletCtx, lpBalance);
      console.log("[EXIT] LP burn TX sent. Waiting 90s for TON + tsTON to arrive...");
      await sleep(90_000);
    } else {
      console.log("[EXIT] No LP tokens found.");
    }
  } catch (err) {
    console.warn("[EXIT] Step 1 LP burn error (non-fatal):", (err as Error).message);
  }

  // ── Step 2: Unstake tsTON (on-chain balance check) ──────────────────────────
  try {
    console.log("[EXIT] Step 2: Checking tsTON balance on-chain...");
    const tstonBalance = await getJettonBalanceOnChain(walletCtx, TSTON_ADDRESS);
    console.log(`[EXIT] tsTON balance: ${fromNano(tstonBalance)} tsTON`);

    if (tstonBalance > 0n) {
      console.log("[EXIT] Burning tsTON for instant unstake...");
      await burnJetton(walletCtx, TSTON_ADDRESS, tstonBalance, toNano("0.5"));
      console.log("[EXIT] tsTON burn sent. Waiting 30s...");
      await sleep(30_000);
    } else {
      console.log("[EXIT] No tsTON found.");
    }
  } catch (err) {
    console.warn("[EXIT] Step 2 tsTON unstake error (non-fatal):", (err as Error).message);
  }

  // ── Step 3: Send USDT (on-chain check) ──────────────────────────────────────
  try {
    console.log("[EXIT] Step 3: Checking USDT balance...");
    const usdtBalance = await getJettonBalanceOnChain(walletCtx, USDT_ADDRESS);
    console.log(`[EXIT] USDT balance: ${Number(usdtBalance) / 1e6} USDT`);

    if (usdtBalance > 0n) {
      await sendJettonTransfer(walletCtx, USDT_ADDRESS, usdtBalance, plan.ton_address);
      const usdtHuman = Number(usdtBalance) / Math.pow(10, USDT_DECIMALS);
      summary.push(`${usdtHuman.toFixed(2)} USDT`);
      console.log(`[EXIT] Sent ${usdtHuman.toFixed(2)} USDT`);
      await sleep(2_000);
    }
  } catch (err) {
    console.warn("[EXIT] Step 3 USDT send error (non-fatal):", (err as Error).message);
  }

  // ── Step 4: Send remaining TON ───────────────────────────────────────────────
  try {
    const GAS_RESERVE = toNano("0.3");
    const tonBalance = await getTonBalance(address);
    const sendable = tonBalance > GAS_RESERVE ? tonBalance - GAS_RESERVE : 0n;
    console.log(`[EXIT] TON balance: ${fromNano(tonBalance)}, sendable: ${fromNano(sendable)}`);

    if (sendable > toNano("0.05")) {
      const seqno = await typedContract.getSeqno();
      await typedContract.sendTransfer({
        seqno,
        secretKey: Buffer.from(walletCtx.key.secretKey),
        messages: [
          internal({
            to: Address.parse(plan.ton_address),
            value: sendable,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY,
      });
      summary.push(`${Number(fromNano(sendable)).toFixed(3)} TON`);
      console.log(`[EXIT] Sent ${fromNano(sendable)} TON`);
    }
  } catch (err) {
    console.warn("[EXIT] Step 4 TON send error (non-fatal):", (err as Error).message);
  }

  const usdtSent = summary
    .filter((s) => s.endsWith("USDT"))
    .reduce((acc, s) => acc + parseFloat(s), 0);

  console.log(`[EXIT] Complete. Sent: ${summary.join(", ") || "nothing"}`);
  return { usdtSent, summary };
}
