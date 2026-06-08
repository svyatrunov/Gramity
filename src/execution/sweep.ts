/**
 * Sweep all verified jettons + remaining TON from agent wallet → user's ton_address.
 * Scam / unverified tokens are ignored.
 */

import {
  Address,
  internal,
  SendMode,
  toNano,
  fromNano,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import type { WalletContext } from "../wallet.js";
import { sendJettonTransfer } from "../services/jetton.js";
import { getAllVerifiedJettons, getTonBalance } from "../services/tonapi.js";
import { isPopularJettonAddress } from "../shared/popular-ton-jettons.js";
import { sleep } from "../wallet.js";

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

/** Minimum TON to keep for gas fees (0.3 TON) */
const GAS_RESERVE = toNano("0.3");

export interface SweepResult {
  /** Total USDT equivalent swept (rough estimate) */
  jettonsSent: string[];
  tonSentNano: bigint;
}

/**
 * Transfer all whitelist-verified jettons and remaining TON to `toAddress`.
 * Sends one transaction per jetton with 2s gap to avoid seqno collision.
 */
export async function sweepAllTokens(
  walletCtx: WalletContext,
  toAddress: string
): Promise<SweepResult> {
  const { key, contract, address } = walletCtx;
  const typedContract = contract as unknown as TypedContract;

  console.log(`[SWEEP] Starting sweep from ${address} → ${toAddress}`);

  const jettons = (await getAllVerifiedJettons(address)).filter((j) =>
    isPopularJettonAddress(j.jettonAddress)
  );
  console.log(`[SWEEP] Found ${jettons.length} popular jetton(s):`, jettons.map((j) => j.symbol).join(", ") || "none");

  const jettonsSent: string[] = [];

  // Send each jetton with a 2-second gap between transactions
  for (const jetton of jettons) {
    if (jetton.balanceRaw === 0n) continue;
    try {
      await sendJettonTransfer(walletCtx, jetton.jettonAddress, jetton.balanceRaw, toAddress);
      jettonsSent.push(`${jetton.balance.toFixed(4)} ${jetton.symbol}`);
      console.log(`[SWEEP] Sent ${jetton.balance.toFixed(4)} ${jetton.symbol}`);
      await sleep(2_000);
    } catch (err) {
      console.error(`[SWEEP] Failed to send ${jetton.symbol}:`, err);
    }
  }

  // Send remaining TON (minus gas reserve)
  const tonBalance = await getTonBalance(address);
  const tonSendable = tonBalance > GAS_RESERVE ? tonBalance - GAS_RESERVE : 0n;
  let tonSentNano = 0n;

  if (tonSendable > toNano("0.01")) {
    try {
      const seqno = await typedContract.getSeqno();
      await typedContract.sendTransfer({
        seqno,
        secretKey: Buffer.from(key.secretKey),
        messages: [
          internal({
            to: Address.parse(toAddress),
            value: tonSendable,
            bounce: false,
          }),
        ],
        sendMode: SendMode.PAY_GAS_SEPARATELY,
      });
      tonSentNano = tonSendable;
      console.log(`[SWEEP] Sent ${fromNano(tonSendable)} TON`);
    } catch (err) {
      console.error("[SWEEP] Failed to send TON:", err);
    }
  }

  return { jettonsSent, tonSentNano };
}
