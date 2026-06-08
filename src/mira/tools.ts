import {
  getPlanByTelegramId,
  updatePlan,
  getPool,
  getCompletedCycles,
  getCycleStats,
} from "../db/index.js";
import {
  MIN_DCA_USDT,
  QUICK_MIN_USDT,
  QUICK_INTERVAL_KEYS,
  STANDARD_FREQUENCIES,
  validatePlanAmount,
  normalizePlanFrequency,
  getNextPlanExecutionDate,
  formatPlanFrequency,
} from "../constants/dca.js";
import { executeDcaCycle } from "../execution/cycle.js";
import { createUserWallet, getUserWalletContext } from "../services/userWallet.js";
import { getUsdtBalance, getLastTxHash } from "../services/tonapi.js";
import { sendJettonTransfer } from "../services/jetton.js";
import { RAILWAY_PUBLIC_URL, USDT_ADDRESS, USDT_DECIMALS } from "../config.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { sanitizeForMira, maskAddress, parseTelegramId } from "./utils.js";
import { notify } from "../bot/notifications.js";
import {
  normalizeTonAddress,
  hasWithdrawalAddress,
} from "../utils/tonAddress.js";

function tonTxUrl(hash: string | null | undefined): string | undefined {
  return hash ? `https://tonviewer.com/transaction/${hash}` : undefined;
}

const STRATEGY_MAP: Record<string, "full" | "stake_only" | "accumulate"> = {
  "TON+LP": "full",
  TON: "stake_only",
  STON: "accumulate",
};

function parseQuickMode(args: Record<string, unknown>): boolean {
  if (args.quick_mode === true || args.demo_mode === true) return true;
  const mode = String(args.mode ?? "").toLowerCase();
  return mode === "quick" || mode === "quick_start";
}

export async function toolGetPortfolio(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) {
    return sanitizeForMira({
      telegram_id: String(telegramId),
      has_strategy: false,
      message:
        "No strategy found. Complete onboarding at https://t.me/GramityBot",
      onboarding_url: "https://t.me/GramityBot",
    });
  }

  const data = await buildMiraPortfolio(telegramId);
  return sanitizeForMira(data);
}

export async function toolCreateStrategy(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const isQuickMode = parseQuickMode(args);
  const amount = Number(args.amount_usdt);
  const amountError = validatePlanAmount(amount, isQuickMode);
  if (amountError) {
    throw new Error(
      `${amountError}: завершите онбординг в Mini App или пополните agent wallet`
    );
  }

  const normalizedFreq = normalizePlanFrequency(
    String(args.frequency ?? ""),
    isQuickMode
  );

  const strategyLabel = String(args.strategy ?? "TON+LP");
  const strategyMode = STRATEGY_MAP[strategyLabel] ?? "full";

  // SECURITY: withdrawal_address from Mira is always ignored
  void args.withdrawal_address;

  const existing = await getPlanByTelegramId(telegramId);
  if (!existing) {
    throw new Error(
      "No Gramity plan found. User must complete onboarding in Mini App first."
    );
  }

  const originalWithdrawal = existing.ton_address;
  const withdrawalLine = hasWithdrawalAddress(originalWithdrawal)
    ? `Withdrawal: \`${maskAddress(originalWithdrawal)}\` _(locked)_\n\n`
    : `⚠️ Withdrawal address not set — cycles wait until user sets it via set_withdrawal_address or Mini App.\n\n`;
  const nextExec = getNextPlanExecutionDate({
    frequency: normalizedFreq,
    demo_mode: isQuickMode,
  });

  await getPool().query(
    `UPDATE plans SET
       usdt_amount = $2,
       frequency = $3,
       strategy_mode = $4,
       active = true,
       next_execution_at = $5,
       demo_mode = $6,
       max_cycles = $7
     WHERE telegram_id = $1`,
    [
      telegramId,
      amount,
      normalizedFreq,
      strategyMode,
      nextExec.toISOString(),
      isQuickMode,
      isQuickMode ? 2 : null,
    ]
  );

  const agentWallet = await createUserWallet(telegramId).catch(() => "");

  const { bot } = await import("../bot/index.js");
  const freqLabel = formatPlanFrequency(normalizedFreq, isQuickMode);
  const modeLabel = isQuickMode ? "Quick Start" : "Standard";

  await bot.api.sendMessage(
    telegramId,
    `✅ *Strategy updated via Mira*\n\n` +
      `Mode: ${modeLabel}\n` +
      `Strategy: ${strategyLabel}\n` +
      `Amount: $${amount.toFixed(0)} USDT / cycle\n` +
      `Frequency: ${freqLabel}\n` +
      withdrawalLine +
      `Deposit to agent wallet:\n\`${agentWallet}\`\n\n` +
      `/status — check position`,
    { parse_mode: "Markdown" }
  );

  return sanitizeForMira({
    ok: true,
    telegram_id: telegramId,
    amount_usdt: amount,
    frequency: normalizedFreq,
    frequency_label: freqLabel,
    strategy: strategyLabel,
    quick_mode: isQuickMode,
    demo_mode: isQuickMode,
    max_cycles: isQuickMode ? 2 : null,
    withdrawal_address_masked: hasWithdrawalAddress(originalWithdrawal)
      ? maskAddress(originalWithdrawal)
      : null,
    withdrawal_address_set: hasWithdrawalAddress(originalWithdrawal),
    agent_wallet_address: agentWallet,
    withdrawal_address_unchanged: true,
  });
}

export async function toolPauseStrategy(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  await updatePlan(telegramId, { active: false });

  const { bot } = await import("../bot/index.js");
  await bot.api.sendMessage(
    telegramId,
    `⏸ *Strategy paused via Mira*\n\nYour funds in the pool keep working.\n/resume — resume anytime`,
    { parse_mode: "Markdown" }
  );

  return sanitizeForMira({
    ok: true,
    telegram_id: telegramId,
    status: "paused",
  });
}

export async function toolRunNow(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");
  if (!plan.ton_address) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address not set. Call set_withdrawal_address with a TON address (EQ…/UQ…), or ask user to set it in Mini App.",
      withdrawal_address_set: false,
      action: "set_withdrawal_address",
    });
  }

  const amountUsdt =
    args.amount_usdt != null ? Number(args.amount_usdt) : plan.usdt_amount;

  if (args.amount_usdt != null) {
    if (isNaN(amountUsdt) || amountUsdt < MIN_DCA_USDT) {
      throw new Error(`amount_usdt must be >= ${MIN_DCA_USDT}`);
    }
  } else if (!amountUsdt || isNaN(amountUsdt)) {
    throw new Error("No amount_usdt in strategy — set via update_amount or create_strategy");
  }

  const walletCtx = await getUserWalletContext(telegramId);
  const agentWalletBalance = await getUsdtBalance(walletCtx.address);

  if (agentWalletBalance < amountUsdt) {
    return sanitizeForMira({
      success: false,
      error: "Insufficient balance",
      required: amountUsdt,
      available: agentWalletBalance,
      top_up_address: walletCtx.address,
    });
  }

  const result = await executeDcaCycle(plan, amountUsdt);
  const { bot } = await import("../bot/index.js");

  if (result.status !== "success") {
    const errMsg = result.failedStep
      ? `Failed at ${result.failedStep}`
      : "Cycle failed";
    await bot.api
      .sendMessage(telegramId, notify.cycleFailed(errMsg), { parse_mode: "Markdown" })
      .catch(() => {});
    return sanitizeForMira({
      success: false,
      error: errMsg,
      amount_usdt: amountUsdt,
      tx_swap: tonTxUrl(result.txSwap),
      tx_stake: tonTxUrl(result.txStake),
      tx_lp: tonTxUrl(result.txLp),
    });
  }

  await bot.api
    .sendMessage(
      telegramId,
      notify.cycleComplete({
        amountUsdt,
        tonAmount: result.tonReceived,
        tsTonAmount: result.tstonReceived,
        lpTokensAdded: result.lpTokensAdded,
        txSwap: result.txSwap,
        txStake: result.txStake,
        txLp: result.txLp,
        cyclesDone: plan.cycles_completed + 1,
        totalCycles: plan.max_cycles,
      }),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    )
    .catch(() => {});

  return sanitizeForMira({
    success: true,
    amount_usdt: amountUsdt,
    tx_swap: tonTxUrl(result.txSwap),
    tx_stake: tonTxUrl(result.txStake),
    tx_lp: tonTxUrl(result.txLp),
    lp_tokens_sent_to: maskAddress(plan.ton_address),
  });
}

export async function toolWithdraw(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");
  if (!plan.ton_address) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address not set. Call set_withdrawal_address first, or ask user to set it in Mini App.",
      withdrawal_address_set: false,
      action: "set_withdrawal_address",
    });
  }

  const newAddress =
    args.withdrawal_address ?? args.new_address ?? args.to_address;
  if (newAddress != null && String(newAddress) !== plan.ton_address) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address is locked at setup and cannot be changed via AI commands.",
      current_address: maskAddress(plan.ton_address),
    });
  }

  const walletCtx = await getUserWalletContext(telegramId);
  const balance = await getUsdtBalance(walletCtx.address);

  let amountUsdt =
    args.amount_usdt != null ? Number(args.amount_usdt) : balance;

  if (isNaN(amountUsdt) || amountUsdt <= 0) {
    return sanitizeForMira({
      success: false,
      error: "No USDT available to withdraw",
      available: balance,
    });
  }

  if (amountUsdt > balance) {
    return sanitizeForMira({
      success: false,
      error: "Insufficient balance",
      required: amountUsdt,
      available: balance,
    });
  }

  const amountRaw = BigInt(
    Math.floor(amountUsdt * Math.pow(10, USDT_DECIMALS))
  );

  await sendJettonTransfer(
    walletCtx,
    USDT_ADDRESS,
    amountRaw,
    plan.ton_address
  );

  const txHash = await getLastTxHash(walletCtx.address, 5_000);

  const { bot } = await import("../bot/index.js");
  await bot.api
    .sendMessage(
      telegramId,
      `✅ *$${amountUsdt.toFixed(2)} USDT withdrawn via Mira*\n\n` +
        `To: \`${maskAddress(plan.ton_address)}\` _(locked)_`,
      { parse_mode: "Markdown" }
    )
    .catch(() => {});

  return sanitizeForMira({
    success: true,
    amount_usdt: amountUsdt,
    sent_to: maskAddress(plan.ton_address),
    tx: tonTxUrl(txHash),
    note: "Address is locked and cannot be changed via Mira",
  });
}

export async function toolUpdateFrequency(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const frequency = String(args.frequency ?? "");
  const allowed = ["daily", "weekly", "monthly"];
  if (!allowed.includes(frequency)) {
    throw new Error(`frequency must be one of: ${allowed.join(", ")}`);
  }

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  const nextCycle = getNextPlanExecutionDate({
    frequency,
    demo_mode: false,
  });

  await updatePlan(telegramId, {
    frequency: frequency as typeof plan.frequency,
    next_execution_at: nextCycle.toISOString(),
  });

  return sanitizeForMira({
    updated: true,
    frequency,
    next_cycle: nextCycle.toISOString(),
  });
}

export async function toolUpdateAmount(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const amountUsdt = Number(args.amount_usdt);
  if (isNaN(amountUsdt) || amountUsdt < MIN_DCA_USDT) {
    throw new Error(`amount_usdt must be >= ${MIN_DCA_USDT}`);
  }

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  await updatePlan(telegramId, { usdt_amount: amountUsdt });

  return sanitizeForMira({
    updated: true,
    amount_usdt: amountUsdt,
    next_cycle_amount: amountUsdt,
  });
}

export async function toolGetHistory(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const limit = args.limit != null ? Number(args.limit) : 5;
  const safeLimit = isNaN(limit) || limit < 1 ? 5 : Math.min(limit, 50);

  const [cycles, stats] = await Promise.all([
    getCompletedCycles(telegramId, safeLimit),
    getCycleStats(telegramId),
  ]);

  return sanitizeForMira({
    total_cycles: stats.total_cycles,
    total_invested_usdt: stats.total_invested_usdt,
    cycles: cycles.map((c) => ({
      date: c.executed_at.slice(0, 10),
      amount_usdt: c.amount_usdt,
      ton_received: c.ton_received,
      tx_swap: tonTxUrl(c.tx_swap),
      tx_lp: tonTxUrl(c.tx_lp),
    })),
  });
}

export async function toolResumeStrategy(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  if (plan.active) {
    return sanitizeForMira({
      resumed: true,
      next_cycle: plan.next_execution_at,
    });
  }

  const nextCycle = getNextPlanExecutionDate({
    frequency: plan.frequency,
    demo_mode: plan.demo_mode,
  });
  await updatePlan(telegramId, {
    active: true,
    next_execution_at: nextCycle.toISOString(),
  });

  const { bot } = await import("../bot/index.js");
  await bot.api.sendMessage(
    telegramId,
    `▶️ *Strategy resumed via Mira*\n\nNext cycle scheduled.\n/status — view position`,
    { parse_mode: "Markdown" }
  );

  return sanitizeForMira({
    resumed: true,
    next_cycle: nextCycle.toISOString(),
  });
}

export async function toolSetWithdrawalAddress(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const raw =
    args.ton_address ??
    args.withdrawal_address ??
    args.address ??
    args.withdrawalAddress;
  if (raw == null || String(raw).trim() === "") {
    throw new Error("ton_address required (EQ… or UQ… TON wallet)");
  }

  const normalized = normalizeTonAddress(String(raw));
  if (!normalized) {
    throw new Error("Invalid TON withdrawal address. Use EQ… or UQ… format.");
  }

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) {
    throw new Error("No plan found. User must complete onboarding in Mini App first.");
  }
  if (hasWithdrawalAddress(plan.ton_address)) {
    return sanitizeForMira({
      success: false,
      error: "Withdrawal address is already set and locked.",
      withdrawal_address_set: true,
      withdrawal_address_masked: maskAddress(plan.ton_address),
    });
  }

  await updatePlan(telegramId, { ton_address: normalized });

  const { bot } = await import("../bot/index.js");
  await bot.api
    .sendMessage(
      telegramId,
      `✅ *Withdrawal address set via Mira*\n\n` +
        `\`${normalized.slice(0, 8)}…${normalized.slice(-6)}\`\n\n` +
        `DCA cycles can now run. Address is locked.`,
      { parse_mode: "Markdown" }
    )
    .catch(() => {});

  return sanitizeForMira({
    success: true,
    withdrawal_address_set: true,
    withdrawal_address_masked: maskAddress(normalized),
    note: "Address is now locked. Cycles will proceed on schedule when funded.",
  });
}

export function getMcpManifest() {
  const base = RAILWAY_PUBLIC_URL;
  return {
    name: "gramity",
    version: "1.0.0",
    description:
      "Gramity — custodial DCA executor on TON mainnet. Post-onboarding control plane via Mira; onboarding must be completed in Mini App first. Withdrawal address is optional at onboarding and can be set later via set_withdrawal_address or Mini App; once set it is locked. No funds flow through Mira.",
    endpoint: `${base}/mcp`,
    constraints: {
      mainnet: true,
      custodial: true,
      no_funds_via_mira: true,
      standard_min_amount_usdt: MIN_DCA_USDT,
      quick_min_amount_usdt: QUICK_MIN_USDT,
      quick_intervals: QUICK_INTERVAL_KEYS,
      standard_frequencies: STANDARD_FREQUENCIES,
      onboarding_required: true,
      withdrawal_address_optional_at_onboarding: true,
      withdrawal_address_locked_after_set: true,
      cycles_blocked_until_withdrawal_address_set: true,
    },
    tools: [
      {
        name: "get_portfolio",
        description:
          "Returns portfolio summary with frequency, amount_usdt, status, next_cycle, cycles_completed, total_invested_usdt, agent_wallet_balance_usdt, can_run_now, can_run_next_cycle, withdrawal_address_set, and masked withdrawal_address (null if not set). If withdrawal_address_set is false, cycles are blocked until set_withdrawal_address is called.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: { telegram_id: { type: "string" } },
        },
      },
      {
        name: "create_strategy",
        description:
          `Update an existing DCA strategy (plan must exist from Mini App onboarding). Standard mode: min $${MIN_DCA_USDT}, frequencies daily/weekly/biweekly/monthly. Quick Start: min $${QUICK_MIN_USDT}, intervals 10s/30s/60s, 2 cycles on mainnet. Set quick_mode=true (or demo_mode=true) to switch user to Quick Start. Does not set withdrawal address — use set_withdrawal_address if missing.`,
        inputSchema: {
          type: "object",
          required: ["telegram_id", "amount_usdt", "frequency", "strategy"],
          properties: {
            telegram_id: { type: "string" },
            amount_usdt: { type: "number", minimum: QUICK_MIN_USDT },
            frequency: {
              type: "string",
              description:
                "Standard: daily|weekly|biweekly|monthly. Quick Start: 10s|30s|60s",
            },
            strategy: { type: "string", enum: ["TON+LP", "TON", "STON"] },
            quick_mode: {
              type: "boolean",
              description: "true = Quick Start (2 cycles, short interval)",
            },
            demo_mode: {
              type: "boolean",
              description: "Alias for quick_mode",
            },
            mode: {
              type: "string",
              enum: ["standard", "quick", "quick_start"],
              description: "Alternative to quick_mode boolean",
            },
          },
        },
      },
      {
        name: "pause_strategy",
        description: "Pause the active DCA strategy.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: { telegram_id: { type: "string" } },
        },
      },
      {
        name: "resume_strategy",
        description: "Resume a paused DCA strategy.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: { telegram_id: { type: "string" } },
        },
      },
      {
        name: "run_now",
        description:
          "Immediately execute one DCA cycle: Omniston swap → Tonstakers → STON.fi LP. Requires withdrawal_address_set=true. Fails with action=set_withdrawal_address if address not set yet.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: {
            telegram_id: { type: "string" },
            amount_usdt: { type: "number", minimum: MIN_DCA_USDT },
          },
        },
      },
      {
        name: "withdraw",
        description:
          "Send available USDT from agent wallet to user's withdrawal address. Requires withdrawal_address_set=true. Cannot change an already locked address.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: {
            telegram_id: { type: "string" },
            amount_usdt: { type: "number" },
          },
        },
      },
      {
        name: "update_frequency",
        description:
          "Change how often DCA cycles run. Does not change amount or strategy.",
        inputSchema: {
          type: "object",
          required: ["telegram_id", "frequency"],
          properties: {
            telegram_id: { type: "string" },
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly"],
            },
          },
        },
      },
      {
        name: "update_amount",
        description:
          "Change the USDT amount per DCA cycle. Min $10. Does not affect frequency.",
        inputSchema: {
          type: "object",
          required: ["telegram_id", "amount_usdt"],
          properties: {
            telegram_id: { type: "string" },
            amount_usdt: { type: "number", minimum: MIN_DCA_USDT },
          },
        },
      },
      {
        name: "set_withdrawal_address",
        description:
          "Set the user's TON withdrawal wallet (EQ…/UQ…) when not yet configured. Optional during Mini App onboarding; required before DCA cycles or withdraw. Can only be called once — address is locked after set. Ignored if address already set.",
        inputSchema: {
          type: "object",
          required: ["telegram_id", "ton_address"],
          properties: {
            telegram_id: { type: "string" },
            ton_address: {
              type: "string",
              description: "User's TON wallet (EQ… or UQ…). LP tokens and withdrawals go here.",
            },
            withdrawal_address: {
              type: "string",
              description: "Alias for ton_address",
            },
          },
        },
      },
      {
        name: "get_history",
        description:
          "Returns last N completed DCA cycles with amounts and transaction links.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: {
            telegram_id: { type: "string" },
            limit: { type: "number", default: 5 },
          },
        },
      },
    ],
  };
}

const TOOL_HANDLERS: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  get_portfolio: toolGetPortfolio,
  create_strategy: toolCreateStrategy,
  pause_strategy: toolPauseStrategy,
  resume_strategy: toolResumeStrategy,
  run_now: toolRunNow,
  withdraw: toolWithdraw,
  update_frequency: toolUpdateFrequency,
  update_amount: toolUpdateAmount,
  get_history: toolGetHistory,
  set_withdrawal_address: toolSetWithdrawalAddress,
};

function wrapToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data),
      },
    ],
  };
}

export async function handleMcpRequest(body: {
  jsonrpc?: string;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
  id?: number | string | null;
}) {
  const id = body.id ?? null;

  if (body.method === "tools/list") {
    const manifest = getMcpManifest();
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: manifest.tools,
      },
    };
  }

  if (body.method !== "tools/call") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${body.method}` },
    };
  }

  const toolName = body.params?.name;
  const toolArgs = body.params?.arguments ?? {};

  if (!toolName || !TOOL_HANDLERS[toolName]) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: `Unknown tool: ${toolName}` },
    };
  }

  try {
    const result = await TOOL_HANDLERS[toolName](toolArgs);
    return { jsonrpc: "2.0", id, result: wrapToolResult(result) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}
