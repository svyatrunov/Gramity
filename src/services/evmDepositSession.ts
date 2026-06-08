import { createHmac, randomUUID } from "crypto";
import { RAILWAY_PUBLIC_URL, OMNISTON_WS_URL, USDT_ADDRESS } from "../config.js";
import { createUserWallet } from "./userWallet.js";

export type EvmDepositSessionStatus =
  | "pending"
  | "opened"
  | "connected"
  | "completed"
  | "failed";

export interface EvmDepositSession {
  id: string;
  telegramId: number;
  depositAddress: string;
  status: EvmDepositSessionStatus;
  txHash?: string;
  amount?: number;
  sourceChain?: string;
  sourceToken?: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, EvmDepositSession>();

function base64url(data: string | Buffer): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getSecret(): string {
  return process.env.MASTER_ENCRYPTION_KEY ?? "gramity-evm-deposit-dev";
}

export function signDepositToken(
  sessionId: string,
  telegramId: number,
  expSec: number
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sid: sessionId,
      sub: String(telegramId),
      exp: expSec,
      iat: Math.floor(Date.now() / 1000),
    })
  );
  const sig = createHmac("sha256", getSecret())
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

export function verifyDepositToken(
  token: string
): { sessionId: string; telegramId: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = createHmac("sha256", getSecret())
      .update(`${header}.${payload}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (sig !== expected) return null;

    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sid?: string;
      sub?: string;
      exp?: number;
    };
    if (!body.sid || !body.sub) return null;
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;

    const telegramId = Number(body.sub);
    if (!Number.isFinite(telegramId)) return null;
    return { sessionId: body.sid, telegramId };
  } catch {
    return null;
  }
}

function purgeExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

export function getEvmDepositSession(sessionId: string): EvmDepositSession | null {
  purgeExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function updateEvmDepositSession(
  sessionId: string,
  patch: Partial<
    Pick<
      EvmDepositSession,
      "status" | "txHash" | "amount" | "sourceChain" | "sourceToken"
    >
  >
): EvmDepositSession | null {
  const session = getEvmDepositSession(sessionId);
  if (!session) return null;
  Object.assign(session, patch);
  return session;
}

export async function createEvmDepositSession(telegramId: number): Promise<{
  token: string;
  sessionId: string;
  metamaskUrl: string;
  pageUrl: string;
  expiresAt: number;
  depositAddress: string;
}> {
  purgeExpiredSessions();
  const depositAddress = await createUserWallet(telegramId);
  const sessionId = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const expSec = Math.floor(expiresAt / 1000);
  const token = signDepositToken(sessionId, telegramId, expSec);

  sessions.set(sessionId, {
    id: sessionId,
    telegramId,
    depositAddress,
    status: "pending",
    createdAt: Date.now(),
    expiresAt,
  });

  const host = new URL(RAILWAY_PUBLIC_URL).host;
  const pagePath = `/app/evm-deposit.html?token=${encodeURIComponent(token)}`;
  const pageUrl = `${RAILWAY_PUBLIC_URL}${pagePath}`;
  const metamaskUrl = `https://link.metamask.io/dapp/${host}${pagePath}`;

  return {
    token,
    sessionId,
    metamaskUrl,
    pageUrl,
    expiresAt,
    depositAddress,
  };
}

export function getEvmDepositConfigForSession(session: EvmDepositSession) {
  return {
    depositAddress: session.depositAddress,
    omnistonWsUrl: OMNISTON_WS_URL,
    tonUsdtAddress: USDT_ADDRESS,
    status: session.status,
    expiresAt: session.expiresAt,
  };
}

export function resolveDepositToken(
  token: string | undefined
): { session: EvmDepositSession; telegramId: number } | null {
  if (!token) return null;
  const verified = verifyDepositToken(token);
  if (!verified) return null;
  const session = getEvmDepositSession(verified.sessionId);
  if (!session || session.telegramId !== verified.telegramId) return null;
  return { session, telegramId: verified.telegramId };
}
