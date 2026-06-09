/**
 * Minimal structured diagnostics — safe for Railway logs.
 * Grep: `[DIAG]` or `"cat":"auth"`
 *
 * Never log: initData, mnemonics, private keys, full wallet addresses, raw bodies.
 */

import { randomBytes } from "crypto";

export type DiagLevel = "info" | "warn" | "error";

export type DiagCategory =
  | "http"
  | "auth"
  | "portfolio"
  | "scheduler"
  | "strategy"
  | "startup"
  | "bot"
  | "client";

const REDACT_KEYS = new Set([
  "initdata",
  "init_data",
  "x-telegram-init-data",
  "authorization",
  "encrypted_mnemonic",
  "mnemonic",
  "private_key",
  "seed_phrase",
  "hash",
  "password",
  "token",
  "secret",
]);

const MAX_RING = 40;
const ring: DiagEvent[] = [];

export interface DiagEvent {
  ts: string;
  lvl: DiagLevel;
  cat: DiagCategory;
  msg: string;
  reqId?: string;
  tg?: string;
  ms?: number;
  status?: number;
  path?: string;
  err?: string;
  meta?: Record<string, unknown>;
}

/** Mask telegram id — last 4 digits only. */
export function maskTelegramId(id: number | undefined | null): string | undefined {
  if (id == null || !Number.isFinite(id)) return undefined;
  const s = String(Math.trunc(id));
  return `***${s.slice(-4)}`;
}

/** Truncate TON/EVM address for logs. */
export function maskAddress(addr: string | null | undefined): string | undefined {
  if (!addr || typeof addr !== "string") return undefined;
  const t = addr.trim();
  if (t.length <= 12) return "[addr]";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lk = k.toLowerCase();
    if (REDACT_KEYS.has(lk) || lk.includes("initdata")) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (lk.includes("address") && typeof v === "string") {
      out[k] = maskAddress(v);
      continue;
    }
    if (typeof v === "string" && v.length > 200) {
      out[k] = `${v.slice(0, 80)}…[${v.length}]`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function newRequestId(): string {
  return randomBytes(4).toString("hex");
}

export function diag(
  cat: DiagCategory,
  msg: string,
  opts?: {
    lvl?: DiagLevel;
    reqId?: string;
    tg?: number | null;
    ms?: number;
    status?: number;
    path?: string;
    err?: unknown;
    meta?: Record<string, unknown>;
  }
): void {
  const event: DiagEvent = {
    ts: new Date().toISOString(),
    lvl: opts?.lvl ?? "info",
    cat,
    msg,
    reqId: opts?.reqId,
    tg: maskTelegramId(opts?.tg ?? undefined),
    ms: opts?.ms,
    status: opts?.status,
    path: opts?.path,
    err:
      opts?.err instanceof Error
        ? opts.err.message.slice(0, 200)
        : opts?.err != null
          ? String(opts?.err).slice(0, 200)
          : undefined,
    meta: opts?.meta ? sanitizeMeta(opts.meta) : undefined,
  };

  ring.push(event);
  if (ring.length > MAX_RING) ring.shift();

  const line = JSON.stringify({ tag: "DIAG", ...event });
  if (event.lvl === "error") console.error(line);
  else if (event.lvl === "warn") console.warn(line);
  else console.log(line);
}

/** Recent events for /health/diag (no secrets). */
export function getDiagSnapshot(): {
  uptime_s: number;
  events: DiagEvent[];
} {
  return {
    uptime_s: Math.floor(process.uptime()),
    events: [...ring],
  };
}

export function isDiagAuthorized(authHeader: string | undefined): boolean {
  const secret = process.env.DIAG_SECRET?.trim();
  if (!secret) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === secret;
}
