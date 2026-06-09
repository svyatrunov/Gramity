import { createHmac, randomUUID } from "crypto";
import { getPool } from "../db/index.js";
import { maskAddress } from "./sanitize.js";

export { maskAddress };

function base64url(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getContextSecret(): string {
  return (
    process.env.MIRA_CONTEXT_SECRET ??
    process.env.MASTER_ENCRYPTION_KEY ??
    "gramity-mira-dev"
  );
}

export function signContextToken(telegramId: number, jti: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: String(telegramId),
      jti,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    })
  );
  const sig = createHmac("sha256", getContextSecret())
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.${sig}`;
}

export function verifyContextToken(
  token: string
): { telegramId: number; jti: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = createHmac("sha256", getContextSecret())
      .update(`${header}.${payload}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (sig !== expected) return null;
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { sub?: string; jti?: string; exp?: number };
    if (!body.sub || !body.jti) return null;
    const now = Math.floor(Date.now() / 1000);
    if (body.exp == null || body.exp < now) return null;
    const telegramId = Number(body.sub);
    if (!telegramId || isNaN(telegramId)) return null;
    return { telegramId, jti: body.jti };
  } catch {
    return null;
  }
}

export function newContextJti(): string {
  return randomUUID();
}

export function buildMiraDeeplink(token: string): string {
  return `https://t.me/mira?start=gramity_${encodeURIComponent(token)}`;
}

export function buildMiraBotDeeplink(telegramId: number | string): string {
  return `https://t.me/mira?start=gramity_${telegramId}`;
}

export function buildMiraOnboardingDeeplink(telegramId: number): string {
  return `https://t.me/mira?start=gramity_onboard_${telegramId}`;
}

/** Numeric telegram_id string, max 20 chars. */
export function parseTelegramId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim();
  if (str.length > 20 || !/^\d+$/.test(str)) return null;
  const id = Number(str);
  if (isNaN(id)) return null;
  return id;
}

export function strategyModeToSlug(
  mode: string
): "ton-lp" | "ton" | "ston" {
  const map: Record<string, "ton-lp" | "ton" | "ston"> = {
    full: "ton-lp",
    stake_only: "ton",
    accumulate: "ston",
  };
  return map[mode] ?? "ton-lp";
}

export async function createContextToken(
  telegramId: number
): Promise<{ token: string; mira_deeplink: string }> {
  const jti = newContextJti();
  await getPool().query(
    `INSERT INTO mira_context_tokens (jti, telegram_id) VALUES ($1, $2)`,
    [jti, telegramId]
  );
  const token = signContextToken(telegramId, jti);
  console.log(`[MIRA] Context token created jti=${jti} user=${telegramId}`);
  return {
    token,
    mira_deeplink: buildMiraDeeplink(token),
  };
}

/** Returns telegram_id if token is valid and not yet consumed; marks as consumed. */
export async function consumeContextToken(
  token: string
): Promise<{ telegramId: number } | null> {
  const parsed = verifyContextToken(token);
  if (!parsed) return null;

  const { rows } = await getPool().query<{ consumed_at: string | null }>(
    `UPDATE mira_context_tokens
     SET consumed_at = now()
     WHERE jti = $1 AND consumed_at IS NULL
     RETURNING consumed_at`,
    [parsed.jti]
  );
  if (rows.length === 0) return null;

  console.log(`[MIRA] Context token consumed jti=${parsed.jti}`);
  return { telegramId: parsed.telegramId };
}

export async function isContextTokenConsumed(token: string): Promise<boolean> {
  const parsed = verifyContextToken(token);
  if (!parsed) return true;
  const { rows } = await getPool().query<{ consumed_at: string | null }>(
    `SELECT consumed_at FROM mira_context_tokens WHERE jti = $1`,
    [parsed.jti]
  );
  return !rows[0] || rows[0].consumed_at !== null;
}
