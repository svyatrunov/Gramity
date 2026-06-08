/** Gramity API client — reads Telegram initData for auth */

const BASE = "/api";

function getInitData(): string {
  const tgData = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } })
    .Telegram?.WebApp?.initData;
  if (tgData && tgData.includes("hash=")) return tgData;
  return "";
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": getInitData(),
  };
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...opts, headers: headers() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface Portfolio {
  depositAddress: string;
  usdtBalance: number;
  tonBalance: number;
  lpValue: number | null;
  totalValue: number;
  plan: {
    usdt_amount: number;
    frequency: string;
    strategy_mode: string;
    active: boolean;
    next_execution_at: string;
  } | null;
  executions: Array<{
    executed_at: string;
    usdt_spent: number | null;
    status: string;
  }>;
}

export interface WalletInfo {
  wallet_address: string;
  alias: string;
  usdtBalance: number;
  created_at: string;
}

export interface PopularToken {
  symbol: string;
  address: string;
  price_usd: number | null;
  decimals: number;
  logo_url: string | null;
  logo_id: string;
}

export interface DepositConfig {
  depositAddress: string;    // per-user agentic wallet (bridge destination)
  botWalletAddress: string;  // legacy
  omnistonWsUrl: string;
  tonUsdtAddress: string;
}

export interface EvmDepositSessionResponse {
  token: string;
  sessionId: string;
  metamaskUrl: string;
  pageUrl: string;
  expiresAt: number;
  depositAddress: string;
}

export interface EvmDepositStatus {
  status: string;
  txHash: string | null;
  amount: number | null;
  sourceChain: string | null;
  sourceToken: string | null;
  expiresAt: number;
}

async function tokenFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  portfolio: () => apiFetch<Portfolio>("/portfolio"),
  wallets: () => apiFetch<WalletInfo[]>("/wallets"),
  createWallet: (alias: string) =>
    apiFetch<{ address: string }>("/wallets", {
      method: "POST",
      body: JSON.stringify({ alias }),
    }),
  withdrawUsdt: () =>
    apiFetch<{ sent: number }>("/withdraw/usdt", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  withdrawAll: () =>
    apiFetch<{ summary: string[] }>("/withdraw/all", { method: "POST" }),
  popularTokens: () => apiFetch<PopularToken[]>("/tokens/popular"),
  buyToken: (tokenAddress: string, usdtAmount: number) =>
    apiFetch<{ txHash: string }>("/tokens/buy", {
      method: "POST",
      body: JSON.stringify({ tokenAddress, usdtAmount }),
    }),
  gasEstimate: (action: string) =>
    apiFetch<{ ton: number; usd: number | null }>(`/gas/${action}`),
  depositConfig: () => apiFetch<DepositConfig>("/deposit/config"),
  depositInitiated: (body: {
    txHash: string;
    amount: number;
    sourceChain: string;
    sourceToken: string;
  }) =>
    apiFetch<{ ok: boolean }>("/deposit-initiated", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createEvmDepositSession: () =>
    apiFetch<EvmDepositSessionResponse>("/evm-deposit/session", { method: "POST" }),
  evmDepositConfig: (token: string) =>
    tokenFetch<DepositConfig & { status: string; expiresAt: number }>(
      "/evm-deposit/session",
      token
    ),
  evmDepositStatus: (token: string) =>
    tokenFetch<EvmDepositStatus>("/evm-deposit/status", token),
  evmDepositInitiated: (
    token: string,
    body: {
      txHash: string;
      amount: number;
      sourceChain: string;
      sourceToken: string;
    }
  ) =>
    fetch(`${BASE}/evm-deposit/deposit-initiated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API /evm-deposit/deposit-initiated: ${res.status} ${text}`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    }),
};
