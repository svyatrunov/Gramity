/**
 * Step 4 — PROVIDE LIQUIDITY to tsTON/TON pool (STON.fi DEX SDK v2)
 *
 * API-driven pattern:
 *  1. simulateLiquidityProvision to get minLpUnits
 *  2. Build TX params via dexFactory
 *  3. Send both legs (TON leg + tsTON leg) as 2 messages in one wallet transfer
 *  4. Poll LP token balance until tokens arrive
 */

import { dexFactory } from "@ston-fi/sdk";
import { StonApiClient } from "@ston-fi/api";
import {
  TonClient,
  Address,
  fromNano,
  internal,
  SendMode,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import type { WalletContext } from "./wallet.js";
import { sleep } from "./wallet.js";
import {
  STON_API_URL,
  TSTON_ADDRESS,
  TONCENTER_URL,
  TONCENTER_API_KEY,
} from "./config.js";
import type { SplitResult } from "./step2-split.js";

export interface LiquidityResult {
  lpTokensReceived: bigint;
  poolSharePct: string;
}

type TxParam = { to: Address; value: bigint; body?: unknown };

type RouterLike = {
  getProvideLiquidityJettonTxParams(p: unknown): Promise<TxParam>;
  getProvideLiquidityTonTxParams(p: unknown): Promise<TxParam>;
};

export async function step4ProvideLiquidity(
  ctx: WalletContext,
  tsTonAmount: bigint,
  keepAmount: bigint,
  splitInfo: SplitResult,
  tsTonAddress: string
): Promise<LiquidityResult> {
  console.log("\n── STEP 4: PROVIDE LIQUIDITY (STON.fi DEX SDK v2) ──────────");
  console.log(`[S4] tsTON to provide: ${fromNano(tsTonAmount)} tsTON`);
  console.log(`[S4] TON to provide:   ${fromNano(keepAmount)} TON`);

  const tstonAddr = tsTonAddress || TSTON_ADDRESS;
  if (!tstonAddr) {
    throw new Error(
      "tsTON address unknown. Set TSTON_ADDRESS in .env or ensure Tonstakers SDK " +
        "returned the jetton master address in step 3."
    );
  }

  const apiClient = new StonApiClient({ baseUrl: STON_API_URL });
  const { address, key, wallet, contract: rawContract } = ctx;

  const contract = rawContract as unknown as {
    getSeqno(): Promise<number>;
    sendTransfer(p: {
      seqno: number;
      secretKey: Buffer;
      messages: ReturnType<typeof internal>[];
      sendMode: number;
    }): Promise<void>;
  };

  // ── Simulate LP provision to get minLpUnits ────────────────────────────────
  let minLpUnits = "1"; // fallback — accept any amount of LP
  let routerAddress = "";
  let ptonMasterAddress = "";
  let poolAddress = splitInfo.poolAddress;

  try {
    console.log("[S4] Simulating LP provision via STON.fi API...");
    const sim = await apiClient.simulateLiquidityProvision({
      tokenA: tstonAddr,
      tokenB: "ton",
      provisionType: "Arbitrary",
      poolAddress: splitInfo.poolAddress,
      tokenAUnits: tsTonAmount.toString(),
      tokenBUnits: keepAmount.toString(),
      slippageTolerance: "0.01",
      walletAddress: address,
    });

    minLpUnits = sim.minLpUnits;
    routerAddress = sim.router.address;
    ptonMasterAddress = sim.router.ptonMasterAddress;
    poolAddress = sim.poolAddress;

    console.log(`[S4] Simulation: estimated LP = ${sim.estimatedLpUnits}`);
    console.log(`[S4] Simulation: min LP units = ${minLpUnits}`);
    console.log(`[S4] Simulation: router = ${routerAddress}`);
    console.log(`[S4] Simulation: priceImpact = ${sim.priceImpact}`);
  } catch (err) {
    console.warn(
      "[S4] LP simulation failed (pool may be WeightedStableSwap), falling back to pool/router query:",
      (err as Error).message
    );
  }

  // ── If simulation failed, resolve router from pool data ───────────────────
  if (!routerAddress) {
    console.log("[S4] Resolving router from pool data...");
    const poolInfo = await apiClient.getPool(poolAddress);
    routerAddress = (poolInfo as unknown as { routerAddress: string }).routerAddress;
    console.log(`[S4] Router from pool: ${routerAddress}`);
  }

  if (!ptonMasterAddress) {
    console.log("[S4] Resolving pTON master from router data...");
    const routerInfo = await apiClient.getRouter(routerAddress);
    ptonMasterAddress = routerInfo.ptonMasterAddress;
    console.log(`[S4] pTON master: ${ptonMasterAddress}`);
  }

  // ── Build transaction via dexFactory ─────────────────────────────────────
  const tonClient = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  let jettonTxParams: TxParam | null = null;
  let tonTxParams: TxParam | null = null;

  try {
    const routerInfo = await apiClient.getRouter(routerAddress);
    const dexContracts = dexFactory(routerInfo);

    const router = tonClient.open(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dexContracts.Router.create(routerAddress) as any
    ) as unknown as RouterLike;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxyTon = dexContracts.pTON.create(ptonMasterAddress) as any;

    console.log(`[S4] Building LP TX: router=${routerAddress}`);
    console.log(`[S4] Building LP TX: pTON=${ptonMasterAddress}`);

    [jettonTxParams, tonTxParams] = await Promise.all([
      router.getProvideLiquidityJettonTxParams({
        userWalletAddress: address,
        sendTokenAddress: tstonAddr,
        sendAmount: tsTonAmount,
        otherTokenAddress: proxyTon.address.toString(),
        minLpOut: minLpUnits,
        queryId: Date.now(),
      }),
      router.getProvideLiquidityTonTxParams({
        userWalletAddress: address,
        proxyTon,
        sendAmount: keepAmount,
        otherTokenAddress: tstonAddr,
        minLpOut: minLpUnits,
        queryId: Date.now() + 1,
      }),
    ]);
    console.log("[S4] Built LP TX via API-driven dexFactory");
  } catch (err) {
    throw new Error(
      `[S4] Failed to build LP transaction: ${(err as Error).message}`
    );
  }

  if (!jettonTxParams || !tonTxParams) {
    throw new Error("Failed to build LP transaction parameters");
  }

  // ── Get LP token balance before ────────────────────────────────────────────
  const lpBalBefore = await getLpBalance(apiClient, address, poolAddress);
  console.log(`[S4] LP balance before: ${fromNano(lpBalBefore)}`);

  // ── Send both LP legs as a single wallet transfer (TON leg + jetton leg) ───
  const seqno = await contract.getSeqno();

  const buildMsg = (p: TxParam) =>
    internal({
      to: p.to,
      value: p.value,
      body: p.body as Parameters<typeof internal>[0]["body"],
      bounce: true,
    });

  await contract.sendTransfer({
    seqno,
    secretKey: key.secretKey,
    messages: [
      buildMsg(tonTxParams),    // TON leg first
      buildMsg(jettonTxParams), // tsTON leg second
    ],
    sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
  });

  console.log("[S4] LP provision TX sent. Waiting for LP tokens...");

  // ── Poll for LP token arrival ──────────────────────────────────────────────
  const deadline = Date.now() + 10 * 60_000;
  let lpBalAfter = lpBalBefore;

  while (Date.now() < deadline) {
    await sleep(10_000);
    const bal = await getLpBalance(apiClient, address, poolAddress);
    console.log(`[S4] LP balance: ${fromNano(bal)}`);
    if (bal > lpBalBefore) {
      lpBalAfter = bal;
      break;
    }
  }

  const lpTokensReceived = lpBalAfter - lpBalBefore;

  if (lpTokensReceived <= 0n) {
    throw new Error("LP tokens did not arrive within 10 minutes");
  }

  // ── Calculate pool share ────────────────────────────────────────────────────
  let poolSharePct = "N/A";
  try {
    const poolData = await apiClient.getPool(poolAddress);
    const totalSupply = BigInt(poolData.lpTotalSupply);
    if (totalSupply > 0n) {
      poolSharePct =
        ((Number(lpTokensReceived) / Number(totalSupply)) * 100).toFixed(4) +
        "%";
    }
  } catch {
    /* ignore */
  }

  console.log(
    `[S4] ✓ LP tokens received: ${fromNano(lpTokensReceived)}` +
      ` | pool share: ${poolSharePct}`
  );

  return { lpTokensReceived, poolSharePct };
}

/** Get LP token balance via STON.fi API getWalletPool */
async function getLpBalance(
  apiClient: StonApiClient,
  walletAddress: string,
  poolAddress: string
): Promise<bigint> {
  if (!poolAddress) return 0n;
  try {
    const walletPool = await apiClient.getWalletPool({
      walletAddress,
      poolAddress,
    });
    return walletPool.lpBalance ? BigInt(walletPool.lpBalance) : 0n;
  } catch {
    return 0n;
  }
}

// ── Standalone runner ────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const { createWallet } = await import("./wallet.js");

    // Values from previous steps
    const tsTonAmount  = BigInt(process.argv[2] ?? "1285255870");  // step3: 1.28525587 tsTON
    const keepAmount   = BigInt(process.argv[3] ?? "1439031013");  // step2: 1.439031013 TON

    // Normalize raw tsTON address → EQ user-friendly format
    const rawTstonAddr = "0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000";
    const tsTonAddress = Address.parse(rawTstonAddr)
      .toString({ bounceable: true, urlSafe: true });
    console.log(`[S4-runner] tsTON address (normalized): ${tsTonAddress}`);

    const splitInfo = {
      stakeAmount:  1439031014n,
      keepAmount,
      poolRatio:    1.33603828,
      tsTONRate:    0.74848155,
      poolAddress:  "EQBjiBVhFLQVCMS8mKMA3gS823m9Xeu9aXiZUYD4TP8GDvui",
      token0Address: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
      token1Address: tsTonAddress,
      reserve0:     96543524900221n,
      reserve1:     128985845048531n,
    };

    const ctx = await createWallet();
    const result = await step4ProvideLiquidity(
      ctx,
      tsTonAmount,
      keepAmount,
      splitInfo,
      tsTonAddress
    );

    console.log("\n[DONE] step4 finished.");
    console.log(`  lpTokensReceived : ${fromNano(result.lpTokensReceived)} LP`);
    console.log(`  poolSharePct     : ${result.poolSharePct}`);
    process.exit(0);
  })().catch((err) => {
    console.error("\n[FATAL]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
}
