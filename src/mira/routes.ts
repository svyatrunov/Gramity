import type { Express, Request, Response } from "express";
import { createHmac } from "crypto";
import { getPlanByTelegramId } from "../db/index.js";
import {
  createContextHandoff,
  consumeContextToken,
} from "./context.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { handleMcpRequest, getMcpManifest } from "./tools.js";
import { sanitizeForMira } from "./utils.js";

function validateInitData(initDataStr: string): number | null {
  try {
    if (!initDataStr) return null;
    const params = new URLSearchParams(initDataStr);
    const hash = params.get("hash");
    if (!hash) return null;
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

function resolveTelegramId(req: Request): number | null {
  const devBypass = process.env.MIRA_DEV_BYPASS === "true";
  const bodyId = req.body?.telegram_id;
  if (devBypass && bodyId != null) {
    const id = Number(bodyId);
    if (id && !isNaN(id)) return id;
  }

  const initData =
    (req.headers["x-telegram-init-data"] as string) ??
    (req.body?.initData as string) ??
    "";
  return validateInitData(initData);
}

export function registerMiraRoutes(app: Express): void {
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json(getMcpManifest());
  });

  app.post("/api/mira/create-context", async (req, res) => {
    try {
      const telegramId = resolveTelegramId(req);
      if (!telegramId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const plan = await getPlanByTelegramId(telegramId);
      if (!plan) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const handoff = await createContextHandoff(telegramId);
      res.json(handoff);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/mira/context/:token", async (req, res) => {
    try {
      const consumed = await consumeContextToken(req.params.token);
      if (!consumed) {
        res.status(410).json({ error: "Token expired or already used" });
        return;
      }

      const portfolio = await buildMiraPortfolio(consumed.telegramId);
      res.json(sanitizeForMira({
        telegram_id: portfolio.telegram_id,
        total_usd: portfolio.total_usd,
        strategies: portfolio.strategies,
        agent_wallet_address: portfolio.agent_wallet_address,
      }));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "User not found") {
        res.status(404).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  app.post("/mcp", async (req, res) => {
    const response = await handleMcpRequest(req.body ?? {});
    res.json(response);
  });
}

export type { Request, Response };
