/**
 * STON.fi LP burn helper using the official dexFactory SDK.
 * Mirrors the approach in step4-liquidity.ts (provide liquidity).
 */

import { dexFactory } from "@ston-fi/sdk";
import { StonApiClient } from "@ston-fi/api";
import {
  TonClient,
  Address,
  internal,
  SendMode,
  type OpenedContract,
  WalletContractV4,
  fromNano,
} from "@ton/ton";
import type { WalletContext } from "../wallet.js";
import { STON_API_URL, TONCENTER_URL, TONCENTER_API_KEY, POOL_ADDRESS } from "../config.js";

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

/**
 * Remove all LP tokens from the STON.fi pool using the official SDK.
 * Uses pool.getBurnTxParams() which correctly sets responseAddress=null and gas=0.8 TON.
 */
export async function removeLpViaSdk(
  walletCtx: WalletContext,
  lpAmount: bigint,
  poolAddress = POOL_ADDRESS
): Promise<void> {
  const { address, key, contract } = walletCtx;
  const typedContract = contract as unknown as TypedContract;

  const apiClient = new StonApiClient({ baseUrl: STON_API_URL });

  // Resolve router from pool
  const poolInfo = await apiClient.getPool(poolAddress);
  const routerAddress = (poolInfo as unknown as { routerAddress: string }).routerAddress;
  console.log(`[LP-BURN] Router: ${routerAddress}`);

  const routerInfo = await apiClient.getRouter(routerAddress);
  const dexContracts = dexFactory(routerInfo);

  const tonClient = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  // Open pool contract via SDK
  const pool = tonClient.open(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dexContracts.Pool.create(poolAddress) as any
  ) as unknown as {
    getBurnTxParams(p: {
      amount: bigint;
      userWalletAddress: string;
      queryId?: number;
    }): Promise<{ to: Address; value: bigint; body: unknown }>;
  };

  console.log(`[LP-BURN] Building burn TX for ${fromNano(lpAmount)} LP tokens...`);
  const burnParams = await pool.getBurnTxParams({
    amount: lpAmount,
    userWalletAddress: address,
    queryId: Date.now(),
  });

  console.log(`[LP-BURN] Gas: ${fromNano(burnParams.value)} TON`);

  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(key.secretKey),
    messages: [
      internal({
        to: burnParams.to,
        value: burnParams.value,
        body: burnParams.body as Parameters<typeof internal>[0]["body"],
        bounce: true,
      }),
    ],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  console.log("[LP-BURN] Burn TX sent via STON.fi SDK.");
}
