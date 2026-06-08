import type { Express, Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";
import { getPlanByTelegramId } from "../db/index.js";
import {
  createContextHandoff,
  consumeContextToken,
} from "./context.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { handleMcpRequest, getMcpManifest } from "./tools.js";
import {
  sanitizeForMira,
  parseTelegramId,
  buildMiraBotDeeplink,
  strategyModeToSlug,
} from "./utils.js";
import { hasWithdrawalAddress } from "../utils/tonAddress.js";

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
  const bodyId = req.body?.telegram_id ?? req.body?.telegramId;
  if (devBypass && bodyId != null) {
    return parseTelegramId(bodyId);
  }

  const initData =
    (req.headers["x-telegram-init-data"] as string) ??
    (req.body?.initData as string) ??
    "";
  return validateInitData(initData);
}

function mcpCors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  next();
}

async function buildMiraContext(telegramId: number) {
  const plan = await getPlanByTelegramId(telegramId);
  const telegram_id = String(telegramId);
  const deeplink = buildMiraBotDeeplink(telegram_id);

  if (!plan) {
    return {
      telegram_id,
      has_strategy: false,
      amount_usdt: 0,
      frequency: null as string | null,
      strategy: null as string | null,
      cycles_completed: 0,
      deeplink,
    };
  }

  return {
    telegram_id,
    has_strategy: true,
    amount_usdt: Number(plan.usdt_amount),
    frequency: plan.frequency,
    strategy: strategyModeToSlug(plan.strategy_mode),
    cycles_completed: plan.cycles_completed,
    withdrawal_address_set: hasWithdrawalAddress(plan.ton_address),
    deeplink,
  };
}

export function registerMiraRoutes(app: Express): void {
  app.get("/.well-known/mcp.json", (_req, res) => {
    res.json(getMcpManifest());
  });

  app.post("/api/mira/create-context", async (req, res) => {
    try {
      const bodyTelegramId = req.body?.telegramId ?? req.body?.telegram_id;
      const hasInitData = Boolean(
        req.headers["x-telegram-init-data"] ?? req.body?.initData
      );

      // Mira server: explicit telegramId in body without Mini App auth
      if (bodyTelegramId != null && !hasInitData) {
        const telegramId = parseTelegramId(bodyTelegramId);
        if (telegramId === null) {
          res.status(400).json({ error: "telegramId required" });
          return;
        }
        res.json(await buildMiraContext(telegramId));
        return;
      }

      // Mini App handoff: validate Telegram initData, issue one-time token
      const telegramId = resolveTelegramId(req);
      if (!telegramId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const plan = await getPlanByTelegramId(telegramId);
      if (!plan) {
        res.json(await buildMiraContext(telegramId));
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
        withdrawal_address_set: portfolio.withdrawal_address_set,
        withdrawal_address_masked: portfolio.withdrawal_address_masked,
        cycle_blocked_reason: portfolio.cycle_blocked_reason,
        suggested_action: portfolio.suggested_action,
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

  app.options("/mcp", mcpCors);
  app.post("/mcp", mcpCors, async (req, res) => {
    try {
      const response = await handleMcpRequest(req.body ?? {});
      res.json(response);
    } catch (err) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: { code: -32603, message: (err as Error).message },
      });
    }
  });
}

export type { Request, Response };
