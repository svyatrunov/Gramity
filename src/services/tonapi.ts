/**
 * TonAPI helpers — USDT balance check, TON price
 */

import { USDT_ADDRESS, TSTON_ADDRESS, TON_API_URL } from "../config.js";

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

// ─── Jetton balance list ───────────────────────────────────────────────────────

export interface VerifiedJetton {
  /** Jetton master contract address (raw) */
  jettonAddress: string;
  /** Human-readable symbol */
  symbol: string;
  /** Decimals */
  decimals: number;
  /** Raw balance string */
  balanceRaw: bigint;
  /** Balance in human units */
  balance: number;
}

/**
 * Returns all jettons on `address` that TON API marks as `whitelist`.
 * Scam / unverified tokens are silently ignored.
 */
export async function getAllVerifiedJettons(
  address: string
): Promise<VerifiedJetton[]> {
  try {
    const url = `${TON_API_URL}/accounts/${encodeURIComponent(address)}/jettons?currencies=usd&supported_extensions=custom_payload`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      balances: Array<{
        balance: string;
        jetton: {
          address: string;
          symbol: string;
          decimals: number;
          verification: string;
        };
      }>;
    };

    return data.balances
      .filter((b) => b.jetton.verification === "whitelist")
      .map((b) => {
        const raw = BigInt(b.balance);
        const dec = b.jetton.decimals;
        return {
          jettonAddress: b.jetton.address,
          symbol: b.jetton.symbol,
          decimals: dec,
          balanceRaw: raw,
          balance: Number(raw) / Math.pow(10, dec),
        };
      })
      .filter((j) => j.balance > 0);
  } catch {
    return [];
  }
}

/**
 * Returns TON balance in nanotons for `address`.
 */
export async function getTonBalance(address: string): Promise<bigint> {
  try {
    const url = `${TON_API_URL}/accounts/${encodeURIComponent(address)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return 0n;
    const data = (await res.json()) as { balance?: string };
    return BigInt(data.balance ?? "0");
  } catch {
    return 0n;
  }
}

// ─── Portfolio valuation ───────────────────────────────────────────────────────

/**
 * Возвращает общую стоимость портфеля в USD:
 * TON баланс + tsTON баланс (≈ TON) + USDT баланс.
 * LP позиция учитывается отдельно в вызывающем коде (через STON.fi API).
 */
export async function getPortfolioValueUsd(
  walletAddress: string,
  tonPriceUsd: number
): Promise<{
  totalUsd: number;
  breakdown: { ton: number; tston: number; usdt: number; lp: number };
}> {
  if (!walletAddress) {
    return { totalUsd: 0, breakdown: { ton: 0, tston: 0, usdt: 0, lp: 0 } };
  }

  const [tonNano, jettons] = await Promise.all([
    getTonBalance(walletAddress),
    getAllVerifiedJettons(walletAddress),
  ]);

  const tonBalance = Number(tonNano) / 1e9;

  const tstonJetton = jettons.find(
    (j) =>
      j.jettonAddress.toLowerCase() === TSTON_ADDRESS.toLowerCase() ||
      j.symbol === "tsTON"
  );
  const usdtJetton = jettons.find(
    (j) =>
      j.jettonAddress.toLowerCase() === USDT_ADDRESS.toLowerCase() ||
      j.symbol === "USD₮"
  );

  const tstonBalance = tstonJetton?.balance ?? 0;
  const usdtBalance = usdtJetton?.balance ?? 0;

  const ton = tonBalance * tonPriceUsd;
  const tston = tstonBalance * tonPriceUsd;
  const usdt = usdtBalance;

  return {
    totalUsd: ton + tston + usdt,
    breakdown: { ton, tston, usdt, lp: 0 },
  };
}

/** Проекция портфеля через N месяцев (compound interest + monthly DCA) */
export function projectPortfolio(params: {
  currentValueUsd: number;
  monthlyDcaUsd: number;
  annualApy: number;
  months: number;
  tonPriceUsd: number;
}): { futureValueUsd: number; futureTon: number; yieldEarnedUsd: number } {
  const r = params.annualApy / 12;
  const n = params.months;
  const growth = Math.pow(1 + r, n);

  const futureValueUsd =
    params.currentValueUsd * growth +
    (r > 0
      ? (params.monthlyDcaUsd * (growth - 1)) / r
      : params.monthlyDcaUsd * n);

  const totalDcaUsd = params.monthlyDcaUsd * n;
  const yieldEarnedUsd = futureValueUsd - params.currentValueUsd - totalDcaUsd;
  const futureTon = params.tonPriceUsd > 0 ? futureValueUsd / params.tonPriceUsd : 0;

  return { futureValueUsd, futureTon, yieldEarnedUsd };
}
