import { randomUUID } from "crypto";
import { RAILWAY_PUBLIC_URL } from "../config.js";
import { signDepositToken, verifyDepositToken } from "./evmDepositSession.js";

export type EvmWalletSessionStatus = "pending" | "opened" | "connected" | "failed";

export interface EvmWalletSession {
  id: string;
  telegramId: number;
  status: EvmWalletSessionStatus;
  evmAddress?: string;
  chainId?: number;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, EvmWalletSession>();

function purgeExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
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
  patch: Partial<Pick<EvmWalletSession, "status" | "evmAddress" | "chainId">>
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
