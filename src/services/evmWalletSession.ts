import { randomUUID } from "crypto";
import { RAILWAY_PUBLIC_URL } from "../config.js";
import { signDepositToken, verifyDepositToken } from "./evmDepositSession.js";

export type EvmWalletSessionStatus = "pending" | "opened" | "connected" | "failed";
export type EvmWalletBalanceStatus = "pending" | "ready" | "failed";

export interface EvmWalletToken {
  symbol: string;
  name: string;
  balance: string;
  balanceUsd: number;
  type: "NATIVE" | "BEP20";
  icon: string;
}

export interface EvmWalletBalancePayload {
  type: "wallet_balance";
  sessionId: string;
  address: string;
  chain: string;
  tokens: EvmWalletToken[];
  totalUsd: number;
}

export interface EvmWalletSession {
  id: string;
  telegramId: number;
  status: EvmWalletSessionStatus;
  evmAddress?: string;
  chainId?: number;
  balanceStatus?: EvmWalletBalanceStatus;
  walletBalance?: EvmWalletBalancePayload;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, EvmWalletSession>();

interface AnkrAsset {
  tokenName?: string;
  tokenSymbol?: string;
  balance?: string;
  balanceUsd?: string;
  tokenType?: string;
  thumbnail?: string;
}

function purgeExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function replaceExistingSession(telegramId: number): void {
  for (const [id, session] of sessions) {
    if (session.telegramId === telegramId) {
      sessions.delete(id);
      console.log(`[EVM-WALLET] Replaced session for user=${telegramId}`);
    }
  }
}

export function getEvmWalletSession(sessionId: string): EvmWalletSession | null {
  purgeExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function updateEvmWalletSession(
  sessionId: string,
  patch: Partial<
    Pick<
      EvmWalletSession,
      "status" | "evmAddress" | "chainId" | "balanceStatus" | "walletBalance"
    >
  >
): EvmWalletSession | null {
  const session = getEvmWalletSession(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  return session;
}

function buildMetaMaskUrls(token: string): { pageUrl: string; metamaskUrl: string } {
  const host = new URL(RAILWAY_PUBLIC_URL).host;
  const pagePath = `/app/evm-wallet.html?token=${encodeURIComponent(token)}`;
  return {
    pageUrl: `${RAILWAY_PUBLIC_URL}${pagePath}`,
    metamaskUrl: `https://link.metamask.io/dapp/${host}${pagePath}`,
  };
}

export function createEvmWalletSession(telegramId: number): {
  token: string;
  sessionId: string;
  metamaskUrl: string;
  pageUrl: string;
  expiresAt: number;
} {
  purgeExpiredSessions();
  replaceExistingSession(telegramId);

  const sessionId = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const expSec = Math.floor(expiresAt / 1000);
  const token = signDepositToken(sessionId, telegramId, expSec);

  sessions.set(sessionId, {
    id: sessionId,
    telegramId,
    status: "pending",
    createdAt: Date.now(),
    expiresAt,
  });

  const urls = buildMetaMaskUrls(token);
  return { token, sessionId, expiresAt, ...urls };
}

export function resolveWalletToken(
  token: string | undefined
): { session: EvmWalletSession; telegramId: number } | null {
  if (!token) return null;
  const verified = verifyDepositToken(token);
  if (!verified) return null;
  const session = getEvmWalletSession(verified.sessionId);
  if (!session || session.telegramId !== verified.telegramId) return null;
  return { session, telegramId: verified.telegramId };
}

function parseAnkrAssets(
  sessionId: string,
  address: string,
  assets: AnkrAsset[]
): EvmWalletBalancePayload {
  const tokens: EvmWalletToken[] = assets
    .map((asset) => {
      const balance = asset.balance ?? "0";
      const balanceUsd = parseFloat(asset.balanceUsd ?? "0") || 0;
      // Ankr labels BSC fungible tokens as "ERC20" — on BNB Chain that is BEP20.
      const tokenType = asset.tokenType === "NATIVE" ? "NATIVE" : "BEP20";
      return {
        symbol: asset.tokenSymbol ?? "?",
        name: asset.tokenName ?? asset.tokenSymbol ?? "?",
        balance,
        balanceUsd,
        type: tokenType as "NATIVE" | "BEP20",
        icon: asset.thumbnail ?? "",
      };
    })
    .filter((t) => parseFloat(t.balance) > 0)
    .sort((a, b) => {
      if (a.type === "NATIVE" && b.type !== "NATIVE") return -1;
      if (b.type === "NATIVE" && a.type !== "NATIVE") return 1;
      return b.balanceUsd - a.balanceUsd;
    });

  const totalUsd = tokens.reduce((sum, t) => sum + t.balanceUsd, 0);

  return {
    type: "wallet_balance",
    sessionId,
    address,
    chain: "bsc",
    tokens,
    totalUsd,
  };
}

export async function fetchAnkrWalletBalances(
  address: string,
  sessionId = ""
): Promise<EvmWalletBalancePayload> {
  console.log(`[EVM-WALLET] Fetching balances... address=${address.slice(0, 10)}…`);

  const res = await fetch("https://rpc.ankr.com/multichain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "ankr_getAccountBalance",
        params: {
          walletAddress: address,
          blockchain: ["bsc"],
          onlyWhitelisted: false,
          nativeFirst: true,
        },
      id: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ankr HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    error?: { message?: string };
    result?: { assets?: AnkrAsset[] };
  };

  if (data.error) {
    throw new Error(data.error.message ?? "Ankr RPC error");
  }

  const assets = data.result?.assets ?? [];
  const walletBalance = parseAnkrAssets(sessionId, address, assets);

  console.log(
    `[EVM-WALLET] Balances loaded tokens=${walletBalance.tokens.length} totalUsd=${walletBalance.totalUsd.toFixed(2)}`
  );
  return walletBalance;
}

export async function fetchAndStoreEvmWalletBalances(
  sessionId: string,
  address: string
): Promise<EvmWalletBalancePayload | null> {
  const session = getEvmWalletSession(sessionId);
  if (!session) return null;

  updateEvmWalletSession(sessionId, { balanceStatus: "pending" });

  try {
    const walletBalance = await fetchAnkrWalletBalances(address, sessionId);
    updateEvmWalletSession(sessionId, {
      balanceStatus: "ready",
      walletBalance,
    });
    return walletBalance;
  } catch (err) {
    updateEvmWalletSession(sessionId, { balanceStatus: "failed" });
    console.error("[EVM-WALLET] Balance fetch failed:", (err as Error).message);
    return null;
  }
}
