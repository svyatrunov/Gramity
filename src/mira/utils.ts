import { createHmac, randomUUID } from "crypto";

const SENSITIVE_KEYS = new Set([
  "mnemonic",
  "private_key",
  "encrypted_mnemonic",
  "wallet_id",
]);

export function maskAddress(address: string): string {
  if (!address || address.length < 10) return "—";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/** Strip sensitive fields before any Mira-facing response. */
export function sanitizeForMira<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForMira(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    out[key] = sanitizeForMira(val);
  }
  return out as T;
}

function base64url(data: string | Buffer): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getContextSecret(): string {
  return process.env.MIRA_CONTEXT_SECRET ?? process.env.MASTER_ENCRYPTION_KEY ?? "gramity-mira-dev";
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

export function verifyContextToken(token: string): { telegramId: number; jti: string } | null {
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

    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      jti?: string;
      exp?: number;
    };
    if (!body.sub || !body.jti) return null;
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;

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

export function parseTelegramId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const str = String(raw).trim();
  if (!/^\d+$/.test(str)) return null;
  const id = Number(str);
  if (isNaN(id)) return null;
  return id;
}

export function strategyModeToSlug(mode: string): string {
  const map: Record<string, string> = {
    full: "ton-lp",
    stake_only: "ton",
    accumulate: "ston",
  };
  return map[mode] ?? "ton-lp";
}
