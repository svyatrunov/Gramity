/**
 * Step 3 — STAKE TON → tsTON via Tonstakers SDK
 *
 * Uses a backend hot-wallet connector implementing IWalletConnector.
 * The connector:
 *   - triggers onStatusChange immediately with wallet info (chain="-239" for mainnet)
 *   - implements sendTransaction by signing with the private key via @ton/ton
 *
 * After staking, polls tsTON balance via TonAPI until tokens arrive.
 */

import { Tonstakers } from "tonstakers-sdk";
import {
  Address,
  Cell,
  internal,
  SendMode,
  fromNano,
  toNano,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import type { KeyPair } from "@ton/crypto";
import type { WalletContext } from "./wallet.js";
import { sleep } from "./wallet.js";
import { TONSTAKERS_CONTRACT } from "./config.js";

interface TransactionMessage {
  address: string;
  amount: string;
  payload: string;
}

interface TransactionDetails {
  validUntil: number;
  messages: TransactionMessage[];
}

interface SendTransactionResponse {
  boc: string;
}

interface IWalletConnector {
  sendTransaction: (tx: TransactionDetails) => Promise<SendTransactionResponse>;
  onStatusChange: (cb: (wallet: unknown) => void) => void | (() => void);
}

/**
 * Backend wallet connector — satisfies Tonstakers IWalletConnector
 * without any browser/TonConnect dependency.
 */
class BackendWalletConnector implements IWalletConnector {
  constructor(private ctx: WalletContext) {}

  onStatusChange(cb: (wallet: unknown) => void): void {
    // Emit connected-wallet status synchronously (chain = "-239" for mainnet)
    setTimeout(() => {
      cb({
        account: {
          address: this.ctx.address,
          chain: "-239", // mainnet
          publicKey: Buffer.from(this.ctx.key.publicKey).toString("hex"),
        },
      });
    }, 0);
  }

  async sendTransaction(
    tx: TransactionDetails
  ): Promise<SendTransactionResponse> {
    const { key, wallet, client, contract: rawContract } = this.ctx;
    const contract = rawContract as unknown as {
      getSeqno(): Promise<number>;
      sendTransfer(p: {
        seqno: number;
        secretKey: Buffer;
        messages: ReturnType<typeof internal>[];
        sendMode: number;
      }): Promise<void>;
    };

    const messages = tx.messages.map((msg) => {
      // Tonstakers encodes payload as base64 BOC
      let body: Cell | undefined;
      if (msg.payload) {
        try {
          const buf = Buffer.from(msg.payload, "base64");
          body = Cell.fromBoc(buf)[0];
        } catch {
          // fallback: try hex
          try {
            const buf = Buffer.from(msg.payload, "hex");
            body = Cell.fromBoc(buf)[0];
          } catch {
            /* no payload */
          }
        }
      }

      return internal({
        to: Address.parse(msg.address),
        value: BigInt(msg.amount),
        body,
        bounce: true,
      });
    });

    const seqno = await contract.getSeqno();

    await contract.sendTransfer({
      seqno,
      secretKey: key.secretKey,
      messages,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
    });

    // Reconstruct BOC for return value
    const transfer = wallet.createTransfer({
      seqno,
      secretKey: key.secretKey,
      messages,
    });

    return { boc: transfer.toBoc().toString("base64") };
  }
}

export interface StakeResult {
  tsTonReceived: bigint;
  exchangeRate: number;
  tsTonAddress: string;
}

export async function step3Stake(
  ctx: WalletContext,
  stakeAmount: bigint
): Promise<StakeResult> {
  console.log("\n── STEP 3: STAKE TON → tsTON (Tonstakers SDK) ──────────────");
  console.log(`[S3] Staking: ${fromNano(stakeAmount)} TON`);
  console.log("[S3] Using mainnet staking contract:", TONSTAKERS_CONTRACT);

  const connector = new BackendWalletConnector(ctx);
  const tonstakers = new Tonstakers({ connector });

  // ── Wait for Tonstakers SDK to initialize ─────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Tonstakers init timeout")),
      15_000
    );

    if (tonstakers.ready) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    tonstakers.addEventListener("initialized", () => {
      clearTimeout(timeout);
      console.log("[S3] Tonstakers SDK initialized, isTestnet:", tonstakers.isTestnet);
      resolve();
    });
  });

  // ── Fetch exchange rate & pool info ───────────────────────────────────────
  const rates = await tonstakers.getRates();
  const exchangeRate: number = rates?.tsTONTON ?? 1.0;
  console.log(`[S3] tsTON rate: 1 tsTON = ${exchangeRate} TON`);

  const poolInfo = await tonstakers.fetchStakingPoolInfo();
  const tsTonAddress: string =
    (poolInfo.poolInfo as { liquid_jetton_master?: string })
      .liquid_jetton_master ?? "";
  console.log(`[S3] tsTON jetton master: ${tsTonAddress}`);

  // ── Record tsTON balance before staking ───────────────────────────────────
  const tsTonBalBefore = await tonstakers.getStakedBalance();
  console.log(`[S3] tsTON balance before: ${fromNano(tsTonBalBefore)} tsTON`);

  // ── Execute stake ─────────────────────────────────────────────────────────
  console.log("[S3] Sending stake transaction...");
  await tonstakers.stake(stakeAmount);
  console.log("[S3] Stake TX sent. Waiting for tsTON to arrive (up to 30 min)...");

  // ── Poll for tsTON arrival ────────────────────────────────────────────────
  // On mainnet, instant liquidity is available for small amounts.
  // If the pool lacks instant liquidity, the stake settles at the end of the
  // current staking round (~36 h). We poll for 2 hours; if still pending the
  // engine raises an error and the operator can re-run step 3 check separately.
  const POLL_INTERVAL = 30_000;      // 30 s between checks
  const TIMEOUT      = 2 * 60 * 60_000; // 2 hours
  const deadline = Date.now() + TIMEOUT;
  let tsTonBalAfter = BigInt(tsTonBalBefore);
  let pollCount = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    pollCount++;
    const bal = await tonstakers.getStakedBalance();
    const balBig = BigInt(bal);
    const elapsed = Math.floor((pollCount * POLL_INTERVAL) / 60_000);
    console.log(`[S3] tsTON balance: ${fromNano(balBig)} tsTON  (+${elapsed}m elapsed)`);
    if (balBig > BigInt(tsTonBalBefore)) {
      tsTonBalAfter = balBig;
      break;
    }
  }

  const tsTonReceived = tsTonBalAfter - BigInt(tsTonBalBefore);

  if (tsTonReceived <= 0n) {
    throw new Error(
      "tsTON balance did not increase within 2 hours. " +
        "Tonstakers may be processing a full staking round (~36 h). " +
        "Re-run with SKIP_STAKE=true once tsTON arrives."
    );
  }

  const actualRate = Number(stakeAmount) / Number(tsTonReceived);
  console.log(
    `[S3] ✓ tsTON received: ${fromNano(tsTonReceived)} tsTON` +
      ` | actual exchange rate: 1 tsTON = ${actualRate.toFixed(6)} TON`
  );

  return {
    tsTonReceived,
    exchangeRate: actualRate,
    tsTonAddress,
  };
}

// ── Standalone runner ────────────────────────────────────────────────────────
if (require.main === module) {
  // stakeAmount from step2: 1439031014 nanoton (~1.439 TON)
  const stakeAmount = BigInt(process.argv[2] ?? "1439031014");
  (async () => {
    const { createWallet } = await import("./wallet.js");
    const ctx = await createWallet();
    const result = await step3Stake(ctx, stakeAmount);
    console.log("\n[DONE] step3 finished.");
    console.log(`  tsTonReceived : ${fromNano(result.tsTonReceived)} tsTON`);
    console.log(`  exchangeRate  : 1 tsTON = ${result.exchangeRate.toFixed(6)} TON`);
    console.log(`  tsTonAddress  : ${result.tsTonAddress}`);
    process.exit(0);
  })().catch((err) => {
    console.error("\n[FATAL]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}
