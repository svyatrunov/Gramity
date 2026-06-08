import { BSC_RPC_URL } from "../config.js";
import type { EvmWalletBalancePayload, EvmWalletToken } from "./evmWalletSession.js";

const BALANCE_OF_SELECTOR = "0x70a08231";

interface KnownBep20 {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  coingeckoId: string;
  stableUsd?: number;
}

const POPULAR_BEP20: KnownBep20[] = [
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0x55d398326f99059ff775485246999027b3197955",
    decimals: 18,
    coingeckoId: "tether",
    stableUsd: 1,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x8ac76a51cc950d9892ead0805284023c2f5fee",
    decimals: 18,
    coingeckoId: "usd-coin",
    stableUsd: 1,
  },
  {
    symbol: "BUSD",
    name: "Binance USD",
    address: "0xe9e7cea3dedca5984780b0c5bd69cf6480",
    decimals: 18,
    coingeckoId: "binance-usd",
    stableUsd: 1,
  },
  {
    symbol: "WBNB",
    name: "Wrapped BNB",
    address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    decimals: 18,
    coingeckoId: "wbnb",
  },
  {
    symbol: "CAKE",
    name: "PancakeSwap",
    address: "0x0e09fabb73bf3ade0a17ecc321fd13a19e81ce82",
    decimals: 18,
    coingeckoId: "pancakeswap-token",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    decimals: 18,
    coingeckoId: "ethereum",
  },
  {
    symbol: "BTCB",
    name: "Bitcoin BEP20",
    address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
    decimals: 18,
    coingeckoId: "bitcoin",
  },
  {
    symbol: "DAI",
    name: "DAI",
    address: "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc0",
    decimals: 18,
    coingeckoId: "dai",
    stableUsd: 1,
  },
];

function trimBalance(value: number): string {
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  if (value >= 0.0001) return value.toFixed(6);
  return value.toFixed(8);
}

async function bscRpc<T>(method: string, params: unknown[]): Promise<T | null> {
  const res = await fetch(BSC_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: T; error?: unknown };
  if (data.error || data.result == null) return null;
  return data.result;
}

function hexToAmount(hex: string, decimals: number): number {
  const wei = BigInt(hex);
  const scale = 10n ** BigInt(decimals);
  const whole = Number(wei / scale);
  const frac = Number(wei % scale) / Number(scale);
  return whole + frac;
}

async function fetchCoingeckoPrices(ids: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const out: Record<string, number> = {};
    for (const [id, row] of Object.entries(data)) {
      if (row.usd != null && row.usd > 0) out[id] = row.usd;
    }
    return out;
  } catch {
    return {};
  }
}

function sortTokens(tokens: EvmWalletToken[]): EvmWalletToken[] {
  return tokens.sort((a, b) => {
    if (a.type === "NATIVE" && b.type !== "NATIVE") return -1;
    if (b.type === "NATIVE" && a.type !== "NATIVE") return 1;
    return b.balanceUsd - a.balanceUsd;
  });
}

/** Scan native BNB + popular BEP20 via public BSC RPC (no API key). */
export async function fetchBscRpcWalletBalances(
  address: string,
  sessionId = ""
): Promise<EvmWalletBalancePayload> {
  const padded = address.toLowerCase().slice(2).padStart(64, "0");

  const [nativeHex, ...tokenHexes] = await Promise.all([
    bscRpc<string>("eth_getBalance", [address, "latest"]),
    ...POPULAR_BEP20.map((token) =>
      bscRpc<string>("eth_call", [{ to: token.address, data: BALANCE_OF_SELECTOR + padded }, "latest"])
    ),
  ]);

  const priceIds = ["binancecoin", ...POPULAR_BEP20.map((t) => t.coingeckoId)];
  const prices = await fetchCoingeckoPrices(priceIds);

  const tokens: EvmWalletToken[] = [];

  if (nativeHex && nativeHex !== "0x0" && nativeHex !== "0x") {
    const amount = hexToAmount(nativeHex, 18);
    if (amount > 0) {
      const usdPrice = prices.binancecoin ?? 0;
      tokens.push({
        symbol: "BNB",
        name: "BNB",
        balance: trimBalance(amount),
        balanceUsd: amount * usdPrice,
        type: "NATIVE",
        icon: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png",
      });
    }
  }

  POPULAR_BEP20.forEach((token, index) => {
    const hex = tokenHexes[index];
    if (!hex || hex === "0x" || hex.length <= 2) return;
    const amount = hexToAmount(hex, token.decimals);
    if (amount <= 0) return;

    const usdPrice =
      token.stableUsd ??
      prices[token.coingeckoId] ??
      (token.symbol === "USDT" || token.symbol === "USDC" ? 1 : 0);

    tokens.push({
      symbol: token.symbol,
      name: token.name,
      balance: trimBalance(amount),
      balanceUsd: usdPrice > 0 ? amount * usdPrice : 0,
      type: "BEP20",
      icon: "",
    });
  });

  const sorted = sortTokens(tokens);
  const totalUsd = sorted.reduce((sum, t) => sum + t.balanceUsd, 0);

  return {
    type: "wallet_balance",
    sessionId,
    address,
    chain: "bsc",
    tokens: sorted,
    totalUsd,
  };
}
