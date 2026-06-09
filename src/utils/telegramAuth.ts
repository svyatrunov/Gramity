import { createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";

const MAX_AGE_SECONDS = 86400;

/** Validate Telegram WebApp initData and return telegram_id. Never logs initData. */
export function validateInitData(initDataStr: string): number | null {
  try {
    if (!initDataStr) return null;
    const params = new URLSearchParams(initDataStr);
    const hash = params.get("hash");
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;

    const authDate = parseInt(params.get("auth_date") ?? "0", 10);
    if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
      return null;
    }

    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData")
      .update(process.env.BOT_TOKEN ?? "")
      .digest();
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (expectedHash !== hash) return null;

    const userParam = params.get("user");
    if (!userParam) return null;
    const user = JSON.parse(userParam) as { id?: number };
    return user.id ?? null;
  } catch {
    return null;
  }
}

export function isInitDataExpired(initDataStr: string): boolean {
  try {
    const params = new URLSearchParams(initDataStr);
    const authDate = parseInt(params.get("auth_date") ?? "0", 10);
    return !authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS;
  } catch {
    return true;
  }
}

/** Express middleware: authenticate via Telegram initData */
export function tgAuth(req: Request, res: Response, next: NextFunction): void {
  const initData = (req.headers["x-telegram-init-data"] as string) ?? "";
  if (initData && isInitDataExpired(initData)) {
    res.status(401).json({ error: "INIT_DATA_EXPIRED" });
    return;
  }
  const telegramId = validateInitData(initData);
  if (!telegramId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.telegramId = telegramId;
  req.telegramUserId = telegramId;
  next();
}

declare global {
  namespace Express {
    interface Request {
      telegramId?: number;
      telegramUserId?: number;
    }
  }
}
