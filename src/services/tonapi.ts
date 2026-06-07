/**
 * TonAPI helpers — USDT balance check, TON price
 */

import { USDT_ADDRESS, TON_API_URL } from "../config.js";

const USDT_DECIMALS = 6;

interface JettonBalance {
  balance: string;
  price?: { prices?: { USD?: number } };
}

/** Get USDT balance (in USDT, not raw units) for any TON address */
export async function getUsdtBalance(address: string): Promise<number> {
  try {
    const url = `${TON_API_URL}/accounts/${encodeURIComponent(address)}/jettons/${encodeURIComponent(USDT_ADDRESS)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return 0;
    const data = (await res.json()) as JettonBalance;
    return Number(data.balance) / Math.pow(10, USDT_DECIMALS);
  } catch {
    return 0;
  }
}

/** Get TON price in USD from TonAPI rates */
export async function getTonPriceUsd(): Promise<number> {
  try {
    const url = `${TON_API_URL}/rates?tokens=ton&currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      rates?: { TON?: { prices?: { USD?: number } } };
    };
    return data.rates?.TON?.prices?.USD ?? 0;
  } catch {
    return 0;
  }
}
