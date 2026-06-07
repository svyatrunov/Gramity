/**
 * Gramity — TON-native DCA Liquidity Provisioner
 * Core Execution Engine: 5-step sequence on TON Mainnet
 *
 * ⚠  FINANCIAL RISK NOTICE ⚠
 * This software interacts with real digital assets on blockchain.
 * Errors, bugs, or misuse may lead to partial or total irreversible loss of funds.
 * Test with a small INPUT_USDT (e.g. 1) on the first run.
 *
 * Usage:
 *   cp .env.example .env   # fill in all variables
 *   npm run build && npm run start
 *   # or for development:
 *   npm run dev
 *
 * Checkpoint: state is saved to gramity-state.json after each step.
 * If the process crashes, re-run and it will resume from the last completed step.
 * To start a fresh cycle, delete gramity-state.json first.
 */

import { createWallet } from "./wallet.js";
import { step1Swap } from "./step1-swap.js";
import { step2CalculateSplit } from "./step2-split.js";
import { step3Stake } from "./step3-stake.js";
import { step4ProvideLiquidity } from "./step4-liquidity.js";
import { step5Verify } from "./step5-verify.js";
import { INPUT_USDT, TSTON_ADDRESS } from "./config.js";
import { fromNano } from "@ton/ton";
import {
  loadState,
  saveState,
  clearState,
  splitInfoFromState,
  type CycleState,
} from "./checkpoint.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║       GRAMITY — TON DCA Liquidity Provisioner            ║
║       Core Engine v0.1  |  Mainnet Run                   ║
╚══════════════════════════════════════════════════════════╝
`);

  // ── Load or create checkpoint ──────────────────────────────────────────────
  let state: CycleState = loadState() ?? {
    startedAt: Date.now(),
    completedStep: 0,
  };

  if (state.completedStep > 0) {
    console.log(
      `[CHECKPOINT] Resuming cycle from step ${state.completedStep + 1}` +
        ` (started ${new Date(state.startedAt).toISOString()})`
    );
    console.log(
      "[CHECKPOINT] Delete gramity-state.json to start a fresh cycle.\n"
    );
  } else {
    console.log(`[CHECKPOINT] Starting new cycle. Input: ${INPUT_USDT} USDT`);
  }

  // ── Initialize wallet ──────────────────────────────────────────────────────
  const walletCtx = await createWallet();

  // ── Step 1: SWAP USDT → TON ───────────────────────────────────────────────
  let tonReceived: bigint;

  if (state.completedStep >= 1 && state.tonReceived) {
    tonReceived = BigInt(state.tonReceived);
    console.log(
      `\n── STEP 1: SKIPPED (checkpoint) — TON received: ${fromNano(tonReceived)} TON`
    );
  } else {
    tonReceived = await step1Swap(walletCtx);
    state = { ...state, completedStep: 1, tonReceived: tonReceived.toString() };
    saveState(state);
  }

  // ── Step 2: CALCULATE SPLIT ───────────────────────────────────────────────
  let splitInfo: Awaited<ReturnType<typeof step2CalculateSplit>>;

  if (state.completedStep >= 2 && state.splitInfo) {
    splitInfo = splitInfoFromState(state.splitInfo);
    console.log(
      `\n── STEP 2: SKIPPED (checkpoint) — pool: ${splitInfo.poolAddress}`
    );
  } else {
    splitInfo = await step2CalculateSplit(tonReceived);
    state = {
      ...state,
      completedStep: 2,
      splitInfo: {
        stakeAmount: splitInfo.stakeAmount.toString(),
        keepAmount: splitInfo.keepAmount.toString(),
        poolRatio: splitInfo.poolRatio,
        tsTONRate: splitInfo.tsTONRate,
        poolAddress: splitInfo.poolAddress,
        token0Address: splitInfo.token0Address,
        token1Address: splitInfo.token1Address,
        reserve0: splitInfo.reserve0.toString(),
        reserve1: splitInfo.reserve1.toString(),
      },
    };
    saveState(state);
  }

  // ── Step 3: STAKE TON → tsTON ─────────────────────────────────────────────
  let tsTonReceived: bigint;
  let exchangeRate: number;
  let tsTonAddress: string;

  if (
    state.completedStep >= 3 &&
    state.tsTonReceived &&
    state.tsTonAddress != null
  ) {
    tsTonReceived = BigInt(state.tsTonReceived);
    exchangeRate = state.exchangeRate ?? 1;
    tsTonAddress = state.tsTonAddress ?? TSTON_ADDRESS;
    console.log(
      `\n── STEP 3: SKIPPED (checkpoint) — tsTON received: ${fromNano(tsTonReceived)} tsTON`
    );
  } else {
    ({ tsTonReceived, exchangeRate, tsTonAddress } = await step3Stake(
      walletCtx,
      splitInfo.stakeAmount
    ));
    state = {
      ...state,
      completedStep: 3,
      tsTonReceived: tsTonReceived.toString(),
      exchangeRate,
      tsTonAddress,
    };
    saveState(state);
  }

  const resolvedTstonAddress = tsTonAddress || TSTON_ADDRESS;
  if (resolvedTstonAddress) {
    console.log("\n[INFO] tsTON address resolved:", resolvedTstonAddress);
  }

  // ── Step 4: PROVIDE LIQUIDITY ─────────────────────────────────────────────
  let lpTokensReceived: bigint;
  let poolSharePct: string;

  if (state.completedStep >= 4 && state.lpTokensReceived) {
    lpTokensReceived = BigInt(state.lpTokensReceived);
    poolSharePct = state.poolSharePct ?? "N/A";
    console.log(
      `\n── STEP 4: SKIPPED (checkpoint) — LP tokens: ${fromNano(lpTokensReceived)}`
    );
  } else {
    ({ lpTokensReceived, poolSharePct } = await step4ProvideLiquidity(
      walletCtx,
      tsTonReceived,
      splitInfo.keepAmount,
      splitInfo,
      resolvedTstonAddress
    ));
    state = {
      ...state,
      completedStep: 4,
      lpTokensReceived: lpTokensReceived.toString(),
      poolSharePct,
    };
    saveState(state);
  }

  // ── Step 5: VERIFY POSITION ───────────────────────────────────────────────
  const { lpValueUsd, apy1d, apy7d } = await step5Verify(
    walletCtx.address,
    splitInfo
  );
  state = { ...state, completedStep: 5 };
  saveState(state);

  // ── Final Summary ─────────────────────────────────────────────────────────
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                   CYCLE COMPLETE ✓                       ║
╠══════════════════════════════════════════════════════════╣
║  Input:         ${INPUT_USDT} USDT
║  TON received:  ${fromNano(tonReceived)} TON
║  tsTON staked:  via Tonstakers (rate: ${exchangeRate.toFixed(6)})
║  LP tokens:     ${fromNano(lpTokensReceived)} LP (pool share: ${poolSharePct})
║  LP value:      $${lpValueUsd}
║  APY (1D/7D):   ${apy1d} / ${apy7d}
╚══════════════════════════════════════════════════════════╝
`);

  // Cycle completed — clear checkpoint so next run starts fresh
  clearState();
  console.log("[CHECKPOINT] State cleared. Ready for next cycle.");
}

main().catch((err) => {
  console.error("\n[FATAL]", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  console.error(
    "\n[CHECKPOINT] State saved to gramity-state.json — re-run to resume from last step."
  );
  process.exit(1);
});
