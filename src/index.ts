/**
 * Gramity — Main Entry Point
 * Starts: HTTP server (health + Mini App API) + Telegram bot + Cron scheduler
 */

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createHmac } from "crypto";
import { startBot } from "./bot/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb, getUserWallets } from "./db/index.js";
import { PORT, USDT_ADDRESS, USDT_DECIMALS, TON_API_URL } from "./config.js";
import { getAllVerifiedJettons, getTonBalance, getUsdtBalance } from "./services/tonapi.js";
import { createUserWallet, createNamedWallet, getUserWalletContext } from "./services/userWallet.js";
import { executeFullExit } from "./execution/exit.js";
import { sendJettonTransfer } from "./services/jetton.js";

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check (required by Railway)
app.get(["/", "/health"], (_req, res) => {
  res.json({ status: "ok", service: "gramity", ts: Date.now() });
});

// ─── Mini App REST API ─────────────────────────────────────────────────────────

/** Validate Telegram WebApp initData and return telegram_id */
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

/** Express middleware: authenticate via Telegram initData */
function tgAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const initData = (req.headers["x-telegram-init-data"] as string) ?? "";
  const telegramId = validateInitData(initData);
  if (!telegramId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as express.Request & { telegramId: number }).telegramId = telegramId;
  next();
}

// Portfolio
app.get("/api/portfolio", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { getPlanByTelegramId, getLastExecutions } = await import("./db/index.js");
    const { StonApiClient } = await import("@ston-fi/api");
    const { POOL_ADDRESS, STON_API_URL: STON_URL } = await import("./config.js");

    const walletCtx = await getUserWalletContext(telegramId).catch(() => null);
    const plan = await getPlanByTelegramId(telegramId).catch(() => null);

    const depositAddress = walletCtx?.address ?? "";
    const usdtBalance = depositAddress ? await getUsdtBalance(depositAddress) : 0;
    const tonNano = depositAddress ? await getTonBalance(depositAddress) : 0n;
    const tonBalance = Number(tonNano) / 1e9;

    let lpValue: number | null = null;
    if (depositAddress && plan) {
      try {
        const sc = new StonApiClient({ baseUrl: STON_URL });
        const wp = await sc.getWalletPool({ walletAddress: depositAddress, poolAddress: POOL_ADDRESS });
        if (wp?.lpBalance && wp.lpTotalSupplyUsd && wp.lpTotalSupply) {
          const share = Number(wp.lpBalance) / Number(wp.lpTotalSupply);
          lpValue = share * Number(wp.lpTotalSupplyUsd);
        }
      } catch { /* non-fatal */ }
    }

    const executions = plan ? await getLastExecutions(plan.id, 10) : [];

    res.json({
      depositAddress,
      usdtBalance,
      tonBalance,
      lpValue,
      totalValue: usdtBalance + (lpValue ?? 0),
      plan: plan
        ? {
            usdt_amount: plan.usdt_amount,
            frequency: plan.frequency,
            strategy_mode: plan.strategy_mode,
            active: plan.active,
            next_execution_at: plan.next_execution_at,
          }
        : null,
      executions: executions.map((e) => ({
        executed_at: e.executed_at,
        usdt_spent: e.usdt_spent,
        status: e.status,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Wallets list
app.get("/api/wallets", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const wallets = await getUserWallets(telegramId);
    const result = await Promise.all(
      wallets.map(async (w) => ({
        wallet_address: w.wallet_address,
        alias: w.alias,
        usdtBalance: await getUsdtBalance(w.wallet_address),
        created_at: w.created_at,
      }))
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create wallet
app.post("/api/wallets", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const alias = (req.body?.alias as string) ?? "New Wallet";
    const address = await createNamedWallet(telegramId, alias);
    res.json({ address });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Withdraw USDT
app.post("/api/withdraw/usdt", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { getPlanByTelegramId } = await import("./db/index.js");
    const plan = await getPlanByTelegramId(telegramId);
    if (!plan) { res.status(404).json({ error: "No plan" }); return; }

    const walletCtx = await getUserWalletContext(telegramId);
    const balance = await getUsdtBalance(walletCtx.address);
    if (balance < 0.01) { res.status(400).json({ error: "No USDT to withdraw" }); return; }

    const amountRaw = BigInt(Math.floor(balance * Math.pow(10, USDT_DECIMALS)));
    await sendJettonTransfer(walletCtx, USDT_ADDRESS, amountRaw, plan.ton_address);
    res.json({ sent: balance });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Withdraw all
app.post("/api/withdraw/all", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { getPlanByTelegramId, updatePlan } = await import("./db/index.js");
    const plan = await getPlanByTelegramId(telegramId);
    if (!plan) { res.status(404).json({ error: "No plan" }); return; }
    await updatePlan(telegramId, { active: false });
    const result = await executeFullExit(plan);
    res.json({ summary: result.summary });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Popular tokens (static list + prices from TonAPI)
app.get("/api/tokens/popular", async (_req, res) => {
  try {
    const TOKENS = [
      { symbol: "TON",   address: "ton" },
      { symbol: "tsTON", address: "EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav" },
      { symbol: "STON",  address: "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmn32ehfw" },
      { symbol: "NOT",   address: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT" },
      { symbol: "USDT",  address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs" },
    ];

    const addrs = TOKENS.map((t) => t.address).filter((a) => a !== "ton").join(",");
    const prices: Record<string, number | null> = {};
    try {
      const r = await fetch(
        `${TON_API_URL}/rates?tokens=${encodeURIComponent(addrs)}&currencies=usd`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (r.ok) {
        const d = (await r.json()) as { rates: Record<string, { prices?: { USD?: number } }> };
        for (const [k, v] of Object.entries(d.rates)) {
          prices[k] = v.prices?.USD ?? null;
        }
      }
    } catch { /* non-fatal */ }

    res.json(TOKENS.map((t) => ({
      symbol: t.symbol,
      address: t.address,
      price_usd: prices[t.address] ?? null,
      decimals: 9,
    })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Gas estimate
app.get("/api/gas/:action", async (req, res) => {
  const { getTonPriceUsd } = await import("./services/tonapi.js");
  const GAS_BY_ACTION: Record<string, number> = {
    transfer:   0.1,
    swap:       0.25,
    stake:      0.15,
    lp_add:     0.3,
    lp_remove:  0.5,
    full_exit:  1.5,
  };
  const gasTon = GAS_BY_ACTION[req.params.action] ?? 0.2;
  const tonPrice = await getTonPriceUsd().catch(() => 0);
  res.json({
    ton: gasTon,
    usd: tonPrice > 0 ? gasTon * tonPrice : null,
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const port = Number(PORT) || 3000;
app.listen(port, () => {
  console.log(`[HTTP] Server listening on port ${port}`);
});

// ─── Start bot + scheduler ────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════╗
║          GRAMITY — TON DCA Liquidity Bot                 ║
║          Starting up...                                  ║
╚══════════════════════════════════════════════════════════╝
`);

// Suppress unused import warnings — these are re-exported for side effects
void (createUserWallet as unknown);
void (getAllVerifiedJettons as unknown);

initDb()
  .then(() => {
    startScheduler();
    return startBot();
  })
  .catch((err) => {
    console.error("[FATAL] Startup failed:", err);
    process.exit(1);
  });
