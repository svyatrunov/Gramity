/**
 * Gramity — Main Entry Point
 * Starts: HTTP server (health + Mini App API) + Telegram bot + Cron scheduler
 */

import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createHmac } from "crypto";
import path from "path";
import { startBot } from "./bot/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb, getUserWallets } from "./db/index.js";
import {
  PORT,
  USDT_ADDRESS,
  USDT_DECIMALS,
  TON_API_URL,
  BOT_WALLET_ADDRESS,
  OMNISTON_WS_URL,
} from "./config.js";
import { POPULAR_TON_JETTONS, logoUrlFor } from "./shared/popular-ton-jettons.js";
import { getAllVerifiedJettons, getTonBalance, getUsdtBalance } from "./services/tonapi.js";
import { createUserWallet, createNamedWallet, getUserWalletContext } from "./services/userWallet.js";
import { executeFullExit } from "./execution/exit.js";
import { sendJettonTransfer } from "./services/jetton.js";
import { registerMiraRoutes } from "./mira/routes.js";
import {
  MIN_DCA_USDT,
  MIN_SCAN_USD,
  QUICK_MIN_USDT,
  DEMO_MIN_USDT,
  GAS_RESERVE_TON,
  ECONOMICS_HINT_THRESHOLD_USDT,
  QUICK_INTERVAL_KEYS,
  minPlanAmountUsdt,
  validatePlanAmount,
  buildEconomicsHint,
  normalizePlanFrequency,
  getNextPlanExecutionDate,
  formatPlanFrequency,
} from "./constants/dca.js";

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Mira conversational layer (MCP + context handoff)
registerMiraRoutes(app);

// Serve Mini App static files at /app
const miniappDist = path.resolve(__dirname, "../dist-miniapp");
app.use("/app", express.static(miniappDist));

// Serve TonConnect manifest at root level for wallet compatibility
app.get("/tonconnect-manifest.json", (_req, res) => {
  res.sendFile(path.join(miniappDist, "tonconnect-manifest.json"));
});
app.use("/app", (_req, res, next) => {
  const filePath = path.join(miniappDist, "index.html");
  res.sendFile(filePath, (err) => {
    if (err) next(err);
  });
});

// Health check (required by Railway)
app.get(["/", "/health"], (_req, res) => {
  res.json({ status: "ok", service: "gramity", ts: Date.now() });
});

// Latest mainnet swap tx for judges / README (redirects to tonviewer when available)
app.get("/api/example-tx", async (_req, res) => {
  try {
    const { getPool } = await import("./db/index.js");
    const result = await getPool().query(
      `SELECT tx_swap FROM executions
       WHERE tx_swap IS NOT NULL AND status = 'success'
       ORDER BY executed_at DESC LIMIT 1`
    );
    const hash = result.rows[0]?.tx_swap as string | undefined;
    if (hash) {
      res.redirect(302, `https://tonviewer.com/transaction/${hash}`);
      return;
    }
    res.json({
      hash: null,
      message: "No mainnet swap yet. Fund agent wallet and run /test in @GramityBot.",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

// Popular tokens (shared registry + prices from TonAPI)
app.get("/api/tokens/popular", async (_req, res) => {
  try {
    const addrs = POPULAR_TON_JETTONS.map((t) => t.address)
      .filter((a) => a !== "ton")
      .join(",");
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

    res.json(
      POPULAR_TON_JETTONS.map((t) => ({
        symbol: t.symbol,
        address: t.address,
        price_usd: t.address === "ton" ? (prices["ton"] ?? null) : (prices[t.address] ?? null),
        decimals: 9,
        logo_url: logoUrlFor(t),
        logo_id: t.logoId,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Cross-chain deposit config — returns per-user agentic wallet as deposit destination
app.get("/api/deposit/config", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { createUserWallet } = await import("./services/userWallet.js");
    const depositAddress = await createUserWallet(telegramId);

    res.json({
      depositAddress,                        // per-user agentic wallet — bridge destination
      botWalletAddress: BOT_WALLET_ADDRESS,  // kept for backward compat
      omnistonWsUrl: OMNISTON_WS_URL,
      tonUsdtAddress: USDT_ADDRESS,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// EVM deposit session — JWT for MetaMask in-app browser (no initData in URL)
app.post("/api/evm-deposit/session", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { createEvmDepositSession } = await import("./services/evmDepositSession.js");
    const session = await createEvmDepositSession(telegramId);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/evm-deposit/session", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    const { resolveDepositToken, getEvmDepositConfigForSession, updateEvmDepositSession } =
      await import("./services/evmDepositSession.js");
    const resolved = resolveDepositToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }
    updateEvmDepositSession(resolved.session.id, { status: "opened" });
    res.json(getEvmDepositConfigForSession(resolved.session));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/evm-deposit/status", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    const { resolveDepositToken } = await import("./services/evmDepositSession.js");
    const resolved = resolveDepositToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }
    const { session } = resolved;
    res.json({
      status: session.status,
      txHash: session.txHash ?? null,
      amount: session.amount ?? null,
      sourceChain: session.sourceChain ?? null,
      sourceToken: session.sourceToken ?? null,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/evm-deposit/deposit-initiated", async (req, res) => {
  try {
    const { token, txHash, amount, sourceChain, sourceToken } = req.body ?? {};
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }
    if (!txHash || typeof txHash !== "string") {
      res.status(400).json({ error: "txHash required" });
      return;
    }

    const { resolveDepositToken, updateEvmDepositSession } =
      await import("./services/evmDepositSession.js");
    const resolved = resolveDepositToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }

    const telegramId = resolved.telegramId;
    updateEvmDepositSession(resolved.session.id, {
      status: "completed",
      txHash,
      amount: amount != null ? Number(amount) : undefined,
      sourceChain: sourceChain != null ? String(sourceChain) : undefined,
      sourceToken: sourceToken != null ? String(sourceToken) : undefined,
    });

    const { bot } = await import("./bot/index.js");
    const amt = amount != null ? String(amount) : "?";
    const chain = sourceChain != null ? String(sourceChain) : "?";
    const tokenSym = sourceToken != null ? String(sourceToken) : "?";

    await bot.api.sendMessage(
      telegramId,
      `🌉 *Cross-chain deposit sent*\n\n` +
        `Amount: ${amt} ${tokenSym}\n` +
        `Network: ${chain}\n` +
        `Tx: \`${txHash.slice(0, 10)}…${txHash.slice(-8)}\`\n\n` +
        `_Funds will arrive on TON after bridge confirmation (usually 5–15 min)._`,
      { parse_mode: "Markdown" }
    );

    console.log(
      `[DEPOSIT] EVM session completed user=${telegramId} chain=${chain} token=${tokenSym} tx=${txHash}`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/evm-deposit/order-update", async (req, res) => {
  try {
    const { token, quoteId, orderStatus, phase, message } = req.body ?? {};
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }

    const { resolveDepositToken } = await import("./services/evmDepositSession.js");
    const resolved = resolveDepositToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }

    const telegramId = resolved.telegramId;
    console.log(
      `[DEPOSIT] EVM order update user=${telegramId} quote=${quoteId ?? "?"} status=${orderStatus ?? "?"} phase=${phase ?? "?"}`
    );

    await notifyDepositOrderUpdate(telegramId, {
      quoteId,
      orderStatus,
      phase,
      message,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// EVM wallet connect session — MetaMask in-app browser (no MWP relay in Telegram WebView)
app.post("/api/evm-wallet/session", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { createEvmWalletSession } = await import("./services/evmWalletSession.js");
    const session = createEvmWalletSession(telegramId);
    console.log(`[EVM-WALLET] Session created user=${telegramId} id=${session.sessionId}`);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/evm-wallet/session", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    const { resolveWalletToken, updateEvmWalletSession } =
      await import("./services/evmWalletSession.js");
    const resolved = resolveWalletToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }
    updateEvmWalletSession(resolved.session.id, { status: "opened" });
    res.json({ status: resolved.session.status, expiresAt: resolved.session.expiresAt });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/evm-wallet/status", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    const { resolveWalletToken } = await import("./services/evmWalletSession.js");
    const resolved = resolveWalletToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }
    const { session } = resolved;
    res.json({
      status: session.status,
      evmAddress: session.evmAddress ?? null,
      chainId: session.chainId ?? null,
      balanceStatus: session.balanceStatus ?? null,
      walletBalance: session.walletBalance ?? null,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/evm-wallet/balances", tgAuth, async (req, res) => {
  try {
    const address = String(req.query.address ?? "");
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: "Invalid EVM address" });
      return;
    }

    const { fetchEvmWalletBalances } = await import("./services/evmWalletSession.js");
    const walletBalance = await fetchEvmWalletBalances(address);
    res.json(walletBalance);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/evm-wallet/connected", async (req, res) => {
  try {
    const { token, address, chainId } = req.body ?? {};
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }
    if (!address || typeof address !== "string") {
      res.status(400).json({ error: "address required" });
      return;
    }

    const { resolveWalletToken, updateEvmWalletSession } =
      await import("./services/evmWalletSession.js");
    const resolved = resolveWalletToken(token);
    if (!resolved) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }

    const session = resolved.session;
    if (session.status === "connected" && session.evmAddress === address) {
      res.json({ ok: true, already: true });
      return;
    }
    if (session.status !== "pending" && session.status !== "opened") {
      res.status(409).json({ error: `Session not open for connect (status=${session.status})` });
      return;
    }

    updateEvmWalletSession(resolved.session.id, {
      status: "connected",
      evmAddress: address,
      chainId: chainId != null ? Number(chainId) : undefined,
      balanceStatus: "pending",
    });

    console.log(
      `[EVM-WALLET] Connected user=${resolved.telegramId} address=${address.slice(0, 10)}…`
    );

    const { fetchAndStoreEvmWalletBalances } =
      await import("./services/evmWalletSession.js");
    void fetchAndStoreEvmWalletBalances(resolved.session.id, address);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/debug-log", tgAuth, (req, res) => {
  const telegramId = (req as express.Request & { telegramId: number }).telegramId;
  const { tag, message, data } = req.body ?? {};
  console.log(`[CLIENT ${telegramId}] ${tag ?? "log"}: ${message ?? ""}`, data ?? "");
  res.json({ ok: true });
});

async function notifyDepositOrderUpdate(
  telegramId: number,
  body: {
    quoteId?: string;
    orderStatus?: string;
    phase?: string;
    message?: string;
  }
): Promise<void> {
  const { quoteId, orderStatus, phase, message } = body;
  if (!orderStatus || !phase) return;

  const isTerminal =
    orderStatus === "TRADE_STATUS_FULLY_FILLED" ||
    orderStatus === "TRADE_STATUS_PARTIALLY_FILLED" ||
    orderStatus === "TRADE_STATUS_CANCELLED" ||
    orderStatus === "TRADE_STATUS_FAILED";
  if (!isTerminal) return;

  const { bot } = await import("./bot/index.js");
  const shortId = quoteId ? `${quoteId.slice(0, 8)}…` : "?";

  if (orderStatus === "TRADE_STATUS_FULLY_FILLED") {
    await bot.api.sendMessage(
      telegramId,
      `✅ *Cross-chain order completed*\n\n` +
        `Quote: \`${shortId}\`\n` +
        `${message ?? "USDT is on the way to your agent wallet."}\n\n` +
        `_Balance updates within a few minutes._`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (orderStatus === "TRADE_STATUS_PARTIALLY_FILLED") {
    await bot.api.sendMessage(
      telegramId,
      `⚠️ *Cross-chain order partially filled*\n\n` +
        `Quote: \`${shortId}\`\n` +
        `${message ?? "Part of the deposit was settled."}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  await bot.api.sendMessage(
    telegramId,
    `❌ *Cross-chain order ${phase}*\n\n` +
      `Quote: \`${shortId}\`\n` +
      `${message ?? orderStatus}`,
    { parse_mode: "Markdown" }
  );
}

// Omniston orderTrack terminal status (after orderRegisterSignedOrder)
app.post("/api/deposit-order-update", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { quoteId, orderStatus, phase, message } = req.body ?? {};

    console.log(
      `[DEPOSIT] Order update user=${telegramId} quote=${quoteId ?? "?"} status=${orderStatus ?? "?"} phase=${phase ?? "?"}`
    );

    await notifyDepositOrderUpdate(telegramId, {
      quoteId,
      orderStatus,
      phase,
      message,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Notify bot after cross-chain deposit tx confirmed
app.post("/api/deposit-initiated", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { txHash, amount, sourceChain, sourceToken } = req.body ?? {};

    if (!txHash || typeof txHash !== "string") {
      res.status(400).json({ error: "txHash required" });
      return;
    }

    const { bot } = await import("./bot/index.js");
    const amt = amount != null ? String(amount) : "?";
    const chain = sourceChain != null ? String(sourceChain) : "?";
    const token = sourceToken != null ? String(sourceToken) : "?";

    await bot.api.sendMessage(
      telegramId,
      `🌉 *Cross-chain deposit sent*\n\n` +
        `Amount: ${amt} ${token}\n` +
        `Network: ${chain}\n` +
        `Tx: \`${txHash.slice(0, 10)}…${txHash.slice(-8)}\`\n\n` +
        `_Funds will arrive on TON after bridge confirmation (usually 5–15 min)._`,
      { parse_mode: "Markdown" }
    );

    console.log(
      `[DEPOSIT] Cross-chain initiated user=${telegramId} chain=${chain} token=${token} tx=${txHash}`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/dca/limits", (_req, res) => {
  res.json({
    min_dca_usdt: MIN_DCA_USDT,
    min_scan_usd: MIN_SCAN_USD,
    quick_min_usdt: QUICK_MIN_USDT,
    demo_min_usdt: DEMO_MIN_USDT,
    quick_intervals: QUICK_INTERVAL_KEYS,
    gas_reserve_ton: GAS_RESERVE_TON,
    economics_hint_threshold_usdt: ECONOMICS_HINT_THRESHOLD_USDT,
  });
});

// Create / update DCA plan from Mini App
app.post("/api/plans", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const { ton_address, amount_usdt, frequency, strategy, demo_mode } = req.body ?? {};

    if (!ton_address || typeof ton_address !== "string") {
      res.status(400).json({ error: "ton_address is required" });
      return;
    }
    const isQuickMode = demo_mode === true || demo_mode === "true";
    const amount = Number(amount_usdt);
    const amountError = validatePlanAmount(amount, isQuickMode);
    if (amountError) {
      res.status(400).json({
        error: amountError,
        min_usdt: minPlanAmountUsdt(isQuickMode),
        quick_mode: isQuickMode,
        demo_mode: isQuickMode,
      });
      return;
    }

    const normalizedFreq = normalizePlanFrequency(String(frequency ?? ""), isQuickMode);
    const nextExec = getNextPlanExecutionDate({
      frequency: normalizedFreq,
      demo_mode: isQuickMode,
    });

    const { upsertPlan } = await import("./db/index.js");
    const plan = await upsertPlan({
      telegram_id:       telegramId,
      ton_address:       String(ton_address),
      agent_wallet:      null,
      usdt_amount:       amount,
      frequency:         normalizedFreq,
      strategy_mode:     "full",
      active:            true,
      next_execution_at: nextExec.toISOString(),
      demo_mode:         isQuickMode,
      cycles_completed:  0,
      max_cycles:        isQuickMode ? 2 : null,
    });

    const depositAddress = await createUserWallet(telegramId);

    const { startDepositPoller } = await import("./bot/depositPoller.js");
    startDepositPoller(telegramId, depositAddress);

    const STRATEGY_LABELS: Record<string, string> = {
      ton: "TON + Stake + LP",
      ston: "STON accumulation",
    };

    const { bot } = await import("./bot/index.js");
    const { InlineKeyboard } = await import("grammy");
    const { RAILWAY_PUBLIC_URL } = await import("./config.js");
    const depositUrl = `${RAILWAY_PUBLIC_URL}/app/deposit.html?wallet=${encodeURIComponent(depositAddress)}`;

    const strategyLabel = STRATEGY_LABELS[String(strategy)] ?? "TON + Stake + LP";
    const freqLabel = formatPlanFrequency(normalizedFreq, isQuickMode);
    const planKb = new InlineKeyboard()
      .text("📊 Track Status", "status_check")
      .row()
      .url("🤖 Manage with Mira", "https://t.me/mira");

    if (isQuickMode) {
      await bot.api.sendMessage(
        telegramId,
        `🚀 *Quick Start activated*\n\n` +
          `2 cycles × $${amount.toFixed(0)} USDT\n` +
          `Interval: ${freqLabel}\n` +
          `Withdrawal: \`${String(ton_address).slice(0, 8)}…${String(ton_address).slice(-6)}\`\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `*FUND YOUR AGENT WALLET*\n` +
          `Send USDT here to start:\n\n` +
          `\`${depositAddress}\`\n\n` +
          `First cycle runs shortly after deposit.\n` +
          `━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: "Markdown", reply_markup: planKb }
      );
    } else {
      await bot.api.sendMessage(
        telegramId,
        `✅ *DCA Strategy Created!*\n\n` +
          `Strategy:  ${strategyLabel}\n` +
          `Amount:    $${amount.toFixed(0)} USDT / ${freqLabel}\n` +
          `Est. APY:  ~5.4%\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `*FUND YOUR AGENT WALLET*\n` +
          `Send USDT here to start:\n\n` +
          `\`${depositAddress}\`\n\n` +
          `First cycle runs within 24h of deposit.\n\n` +
          `━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: "Markdown", reply_markup: planKb }
      );
    }

    console.log(`[API/plans] Strategy created user=${telegramId} amount=${amount} freq=${normalizedFreq} quick=${isQuickMode}`);

    const { getTonPriceUsd } = await import("./services/tonapi.js");
    const tonPrice = await getTonPriceUsd().catch(() => 5);
    const economics_hint = isQuickMode ? undefined : buildEconomicsHint(amount, tonPrice);

    res.json({
      ok: true,
      message: isQuickMode ? "Quick Start strategy created" : "Strategy created successfully",
      plan_id: plan.id,
      agent_wallet_address: depositAddress,
      amount_usdt: amount,
      deposit_address: depositAddress,
      deposit_url: depositUrl,
      quick_mode: isQuickMode,
      demo_mode: isQuickMode,
      ...(economics_hint ? { economics_hint } : {}),
    });
  } catch (err) {
    console.error("[API/plans] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Kick off up to 3 DCA test cycles immediately — no scheduler touch
app.post("/api/test-run", tgAuth, async (req, res) => {
  try {
    const telegramId = (req as express.Request & { telegramId: number }).telegramId;
    const cycles = Math.min(Math.max(parseInt(String(req.body?.cycles ?? 3)), 1), 3);

    const { handleTestRun } = await import("./bot/handlers/test.js");
    const { bot } = await import("./bot/index.js");

    // Respond immediately — test runs async
    res.json({ ok: true, message: `Starting ${cycles} test cycles. Watch your Telegram for results.` });

    // Fire and forget
    handleTestRun(
      telegramId,
      async (text, extra) => { await bot.api.sendMessage(telegramId, text, extra as object); },
      cycles
    ).catch((err) => console.error("[TEST_RUN] Error:", err));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

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
