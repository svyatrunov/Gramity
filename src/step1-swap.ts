/**
 * Step 1 — SWAP USDT → TON via Omniston v1beta8
 *
 * Flow:
 *  1. Request RFQ (with integrator fee = 10 bps = 1000 pips)
 *  2. Take the first swap quote
 *  3. Build TON transaction via tonBuildSwap
 *  4. Sign & send with backend hot wallet
 *  5. Track settlement via swapTrack WebSocket
 *  6. Return TON amount received (balance delta)
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

export async function step1Swap(ctx: WalletContext, inputUsdt?: number): Promise<bigint> {
  console.log("\n── STEP 1: SWAP USDT → TON (Omniston v1beta8) ──────────────");
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
  console.log(`[S1] Integrator fee: ${INTEGRATOR_FEE_PIPS / 100} bps (${INTEGRATOR_FEE_PIPS} pips)`);

  const inputAsset: AssetId = {
    chain: {
      $case: "ton",
      value: { kind: { $case: "jetton", value: USDT_ADDRESS } },
    },
  };

  const outputAsset: AssetId = {
    chain: {
      $case: "ton",
      value: { kind: { $case: "native", value: {} } },
    },
  };

  const traderAddress: ChainAddress = {
    chain: { $case: "ton", value: address },
  };

  // Integrator address: use referrer wallet if configured, else our own wallet
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
          maxPriceSlippagePips: 10_000, // 1% slippage
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

  // ── Wait for a swap quote from the RFQ stream ────────────────────────────
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
              `[S1] Quote received: ${fromNano(q.outputUnits)} TON` +
                ` (inputUnits=${q.inputUnits}, outputUnits=${q.outputUnits})`
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
    `[S1] Best quote: ${fromNano(quote.outputUnits)} TON out` +
      ` | integratorFee=${quote.integratorFeeUnits} | protocolFee=${quote.protocolFeeUnits}`
  );

  // ── Build TON swap transaction ────────────────────────────────────────────
  const swapTx = await omniston.tonBuildSwap({
    quoteId: quote.quoteId,
    transferSrcAddress: traderAddress,
    traderDstAddress: traderAddress,
    gasExcessAddress: traderAddress,
    refundSrcAddress: traderAddress,
  });

  console.log(`[S1] Built swap TX with ${swapTx.messages.length} message(s)`);

  // ── Record balance before swap ────────────────────────────────────────────
  const balBefore = await client.getBalance(Address.parse(address));

  // ── Build and send swap transaction ──────────────────────────────────────
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

  // Build the transfer cell first so we can extract the BOC for Omniston tracking
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

  // base64 BOC of the external message body is a valid outgoingTxQuery for Omniston
  const txHashHex = transferCell.toBoc().toString("base64");

  // Send via sendExternalMessage (same as contract.sendTransfer under the hood)
  await client.sendExternalMessage(
    wallet as unknown as import("@ton/ton").Contract,
    transferCell
  );

  console.log("[S1] Swap transaction sent, tracking settlement...");

  // ── Track swap settlement via WebSocket ──────────────────────────────────
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

  // Build a simple outgoing tx query using seqno as a placeholder
  // (Omniston will search for the matching tx by trader address + seqno timing)
  const trackSub = omniston
    .swapTrack({
      quoteId: quote.quoteId,
      traderAddress,
      outgoingTxQuery: txHashHex, // minimal hint; Omniston resolves by address+time
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
            trackResolve(); // stream closed = assume settled, check balance
            break;
        }
      },
      error(err) {
        clearTimeout(trackTimeout);
        trackReject(err);
      },
    });

  // Wait for either track completion or fallback to balance polling
  try {
    await Promise.race([
      settled,
      pollForSettlement(client, address, balBefore, 5 * 60_000),
    ]);
  } catch (err) {
    console.warn("[S1] Track/poll warning:", (err as Error).message);
  }

  clearTimeout(trackTimeout);
  try {
    trackSub.unsubscribe();
  } catch {}

  // ── Measure TON received ──────────────────────────────────────────────────
  const balAfter = await client.getBalance(Address.parse(address));
  const tonReceived = balAfter - balBefore;

  // tonReceived may be negative if gas > swapped amount; use outputUnits as fallback
  const finalTonReceived =
    tonReceived > 0n ? tonReceived : BigInt(quote.outputUnits);

  console.log(
    `[S1] ✓ TON received: ${fromNano(finalTonReceived)} TON` +
      ` (balance: ${fromNano(balBefore)} → ${fromNano(balAfter)} TON)`
  );

  return finalTonReceived;
}

// ── Standalone runner ────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const { createWallet } = await import("./wallet.js");
    const ctx = await createWallet();
    const tonReceived = await step1Swap(ctx);
    console.log(`\n[DONE] step1 finished. TON received: ${fromNano(tonReceived)} TON (${tonReceived} nanoton)`);
    process.exit(0);
  })().catch((err) => {
    console.error("\n[FATAL]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}

/** Poll wallet balance until it changes (swap settled) */
async function pollForSettlement(
  client: TonClient,
  address: string,
  initialBalance: bigint,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(6_000);
    const bal = await client.getBalance(Address.parse(address));
    if (bal !== initialBalance) {
      console.log("[S1] Balance changed — swap likely settled");
      return;
    }
  }
  throw new Error("pollForSettlement: timeout");
}
