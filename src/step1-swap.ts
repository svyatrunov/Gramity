/**
 * Step 1 — SWAP USDT → TON or jetton via Omniston v1beta8
 */

import {
  Omniston,
  isSwapQuote,
  type ChainAddress,
  type AssetId,
  type QuoteRequest,
  type SettlementParams,
  type SwapSettlementParams,
  type Quote,
  TradeStatus,
} from "@ston-fi/omniston-sdk";
import {
  Address,
  Cell,
  internal,
  SendMode,
  loadStateInit,
  fromNano,
  TonClient,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import type { WalletContext } from "./wallet.js";
import {
  USDT_ADDRESS,
  USDT_DECIMALS,
  INTEGRATOR_FEE_PIPS,
  OMNISTON_WS_URL,
  REFERRER_WALLET,
  INPUT_USDT,
} from "./config.js";
import { sleep } from "./wallet.js";
import { getJettonBalanceRaw, getTonBalance } from "./services/tonapi.js";

export type SwapOutput =
  | { kind: "native"; amountNano: bigint }
  | { kind: "jetton"; amountRaw: bigint; jettonAddress: string };

export interface Step1SwapOptions {
  /** Jetton master address; omit for native TON output */
  targetJettonAddress?: string | null;
}

function buildOutputAsset(targetJettonAddress?: string | null): AssetId {
  if (targetJettonAddress && targetJettonAddress.trim()) {
    return {
      chain: {
        $case: "ton",
        value: { kind: { $case: "jetton", value: targetJettonAddress.trim() } },
      },
    };
  }
  return {
    chain: {
      $case: "ton",
      value: { kind: { $case: "native", value: {} } },
    },
  };
}

function outputLabel(targetJettonAddress?: string | null): string {
  return targetJettonAddress?.trim() ? "jetton" : "TON";
}

export async function step1Swap(
  ctx: WalletContext,
  inputUsdt?: number,
  options?: Step1SwapOptions
): Promise<SwapOutput> {
  const targetJetton = options?.targetJettonAddress?.trim() || null;
  const outLabel = outputLabel(targetJetton);

  console.log(`\n── STEP 1: SWAP USDT → ${outLabel.toUpperCase()} (Omniston) ──────────────`);
  const { key, wallet, client, contract: rawContract, address } = ctx;
  const contract = rawContract as unknown as OpenedContract<WalletContractV4> & {
    getSeqno(): Promise<number>;
    sendTransfer(p: {
      seqno: number;
      secretKey: Buffer;
      messages: ReturnType<typeof internal>[];
      sendMode: number;
    }): Promise<void>;
  };

  const omniston = new Omniston({ apiUrl: OMNISTON_WS_URL });

  const amount = inputUsdt ?? INPUT_USDT;
  const inputUnits = String(amount * Math.pow(10, USDT_DECIMALS));
  console.log(`[S1] Input: ${amount} USDT (${inputUnits} smallest units)`);
  console.log(`[S1] Output: ${targetJetton ?? "native TON"}`);

  const inputAsset: AssetId = {
    chain: {
      $case: "ton",
      value: { kind: { $case: "jetton", value: USDT_ADDRESS } },
    },
  };

  const outputAsset = buildOutputAsset(targetJetton);

  const traderAddress: ChainAddress = {
    chain: { $case: "ton", value: address },
  };

  const integratorAddress: ChainAddress = {
    chain: {
      $case: "ton",
      value: REFERRER_WALLET || address,
    },
  };

  const settlementParams: SettlementParams[] = [
    {
      params: {
        $case: "swap",
        value: {
          maxPriceSlippagePips: 10_000,
          flexibleIntegratorFee: false,
        } satisfies SwapSettlementParams,
      },
    },
  ];

  const quoteRequest: QuoteRequest = {
    inputAsset,
    outputAsset,
    amount: { $case: "inputUnits", value: inputUnits },
    settlementParams,
    integratorAddress,
    integratorFeePips: INTEGRATOR_FEE_PIPS,
  };

  const quote = await new Promise<Quote>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("RFQ timeout: no quote after 30s")),
      30_000
    );

    const sub = omniston.requestForQuote(quoteRequest).subscribe({
      next(event) {
        switch (event?.$case) {
          case "ack":
            console.log("[S1] RFQ acknowledged, rfqId:", event.value.rfqId);
            break;
          case "quoteUpdated": {
            const q = event.value;
            console.log(
              `[S1] Quote received: outputUnits=${q.outputUnits}` +
                ` (inputUnits=${q.inputUnits})`
            );
            if (isSwapQuote(q)) {
              clearTimeout(timeout);
              sub.unsubscribe();
              resolve(q);
            } else {
              console.log("[S1] Non-swap quote, waiting for swap quote...");
            }
            break;
          }
          case "noQuote":
            clearTimeout(timeout);
            sub.unsubscribe();
            reject(new Error(`No quote available: ${JSON.stringify(event)}`));
            break;
          case "unsubscribed":
            clearTimeout(timeout);
            reject(new Error("RFQ stream closed before quote"));
            break;
        }
      },
      error(err) {
        clearTimeout(timeout);
        reject(err);
      },
    });
  });

  console.log(
    `[S1] Best quote: outputUnits=${quote.outputUnits}` +
      ` | integratorFee=${quote.integratorFeeUnits} | protocolFee=${quote.protocolFeeUnits}`
  );

  const swapTx = await omniston.tonBuildSwap({
    quoteId: quote.quoteId,
    transferSrcAddress: traderAddress,
    traderDstAddress: traderAddress,
    gasExcessAddress: traderAddress,
    refundSrcAddress: traderAddress,
  });

  console.log(`[S1] Built swap TX with ${swapTx.messages.length} message(s)`);

  const balBefore = targetJetton
    ? await getJettonBalanceRaw(address, targetJetton)
    : await getTonBalance(address);

  const seqno = await contract.getSeqno();
  const internalMessages = swapTx.messages.map((msg) => {
    const bodyCell = msg.payload
      ? Cell.fromBoc(Buffer.from(msg.payload, "hex"))[0]
      : undefined;

    let stateInit = undefined;
    if (msg.jettonWalletStateInit) {
      const siCell = Cell.fromBoc(
        Buffer.from(msg.jettonWalletStateInit, "hex")
      )[0];
      stateInit = loadStateInit(siCell.beginParse());
    }

    return internal({
      to: Address.parse(msg.targetAddress),
      value: BigInt(msg.sendAmount),
      body: bodyCell,
      init: stateInit,
      bounce: true,
    });
  });

  const transferCell = (wallet as unknown as {
    createTransfer(p: {
      seqno: number;
      secretKey: Buffer;
      messages: ReturnType<typeof internal>[];
      sendMode: number;
    }): import("@ton/core").Cell;
  }).createTransfer({
    seqno,
    secretKey: key.secretKey,
    messages: internalMessages,
    sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
  });

  const txHashHex = transferCell.toBoc().toString("base64");

  await client.sendExternalMessage(
    wallet as unknown as import("@ton/ton").Contract,
    transferCell
  );

  console.log("[S1] Swap transaction sent, tracking settlement...");

  let trackResolve: (v: void) => void;
  let trackReject: (e: Error) => void;
  const settled = new Promise<void>((res, rej) => {
    trackResolve = res;
    trackReject = rej;
  });

  const trackTimeout = setTimeout(() => {
    trackReject(
      new Error("swapTrack timeout: no FULLY_FILLED within 5 minutes")
    );
  }, 5 * 60_000);

  const trackSub = omniston
    .swapTrack({
      quoteId: quote.quoteId,
      traderAddress,
      outgoingTxQuery: txHashHex,
    })
    .subscribe({
      next(event) {
        switch (event?.$case) {
          case "awaitingTransfer":
            console.log("[S1] Swap: awaiting transfer...");
            break;
          case "progress": {
            const status = event.value.status;
            console.log("[S1] Swap progress status:", status);
            if (
              status === TradeStatus.TRADE_STATUS_FULLY_FILLED ||
              status === TradeStatus.TRADE_STATUS_PARTIALLY_FILLED
            ) {
              clearTimeout(trackTimeout);
              trackSub.unsubscribe();
              trackResolve();
            } else if (
              status === TradeStatus.TRADE_STATUS_CANCELLED ||
              status === TradeStatus.TRADE_STATUS_FAILED
            ) {
              clearTimeout(trackTimeout);
              trackSub.unsubscribe();
              trackReject(new Error(`Swap failed with status: ${status}`));
            }
            break;
          }
          case "unsubscribed":
            clearTimeout(trackTimeout);
            trackResolve();
            break;
        }
      },
      error(err) {
        clearTimeout(trackTimeout);
        trackReject(err);
      },
    });

  try {
    await Promise.race([
      settled,
      pollForSettlement(client, address, balBefore, targetJetton, 5 * 60_000),
    ]);
  } catch (err) {
    console.warn("[S1] Track/poll warning:", (err as Error).message);
  }

  clearTimeout(trackTimeout);
  try {
    trackSub.unsubscribe();
  } catch {}

  if (targetJetton) {
    const balAfter = await getJettonBalanceRaw(address, targetJetton);
    const received = balAfter - balBefore;
    const finalRaw = received > 0n ? received : BigInt(quote.outputUnits);
    console.log(`[S1] ✓ Jetton received: ${finalRaw} raw units`);
    return { kind: "jetton", amountRaw: finalRaw, jettonAddress: targetJetton };
  }

  const balAfter = await getTonBalance(address);
  const tonReceived = balAfter - balBefore;
  const finalTonReceived =
    tonReceived > 0n ? tonReceived : BigInt(quote.outputUnits);

  console.log(
    `[S1] ✓ TON received: ${fromNano(finalTonReceived)} TON` +
      ` (balance: ${fromNano(balBefore)} → ${fromNano(balAfter)} TON)`
  );

  return { kind: "native", amountNano: finalTonReceived };
}

if (require.main === module) {
  (async () => {
    const { createWallet } = await import("./wallet.js");
    const ctx = await createWallet();
    const result = await step1Swap(ctx);
    console.log("\n[DONE] step1 finished.", result);
    process.exit(0);
  })().catch((err) => {
    console.error("\n[FATAL]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}

async function pollForSettlement(
  client: TonClient,
  address: string,
  initialBalance: bigint,
  targetJetton: string | null,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(6_000);
    const bal = targetJetton
      ? await getJettonBalanceRaw(address, targetJetton)
      : await getTonBalance(address);
    if (bal !== initialBalance) {
      console.log("[S1] Balance changed — swap likely settled");
      return;
    }
  }
  throw new Error("pollForSettlement: timeout");
}
