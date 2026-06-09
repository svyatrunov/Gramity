import { z } from "zod";
import {
  getPlanByTelegramId,
  updatePlan,
  getPool,
  getCompletedCycles,
  getCycleStats,
} from "../db/index.js";
import {
  MIN_DCA_USDT,
  validatePlanAmount,
  normalizePlanFrequency,
  getNextPlanExecutionDate,
  formatPlanFrequency,
} from "../constants/dca.js";
import { executeDcaCycle } from "../execution/cycle.js";
import { createUserWallet, getUserWalletContext } from "../services/userWallet.js";
import { getUsdtBalance, getLastTxHash } from "../services/tonapi.js";
import { sendJettonTransfer } from "../services/jetton.js";
import { USDT_ADDRESS, USDT_DECIMALS } from "../config.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { sanitizeForMira, maskAddress } from "./sanitize.js";
import { parseTelegramId } from "./context.js";
import { getMcpManifest } from "./manifest.js";
import { notify } from "../bot/notifications.js";
import { hasWithdrawalAddress, normalizeTonAddress } from "../utils/tonAddress.js";

const telegramIdSchema = z
  .string()
  .max(20)
  .regex(/^\d+$/, "telegram_id must be numeric");

function tonTxUrl(hash: string | null | undefined): string | undefined {
  return hash ? `https://tonviewer.com/transaction/${hash}` : undefined;
}

const STRATEGY_MAP: Record<string, "full" | "stake_only" | "accumulate"> = {
  "TON+LP": "full",
  TON: "stake_only",
  STON: "accumulate",
};

function parseQuickMode(args: {
  quick_mode?: boolean;
  demo_mode?: boolean;
  mode?: string;
}): boolean {
  if (args.quick_mode === true || args.demo_mode === true) return true;
  const mode = String(args.mode ?? "").toLowerCase();
  return mode === "quick" || mode === "quick_start";
}

const getPortfolioSchema = z.object({ telegram_id: telegramIdSchema });
const createStrategySchema = z.object({
  telegram_id: telegramIdSchema,
  amount_usdt: z.coerce.number(),
  frequency: z.string(),
  strategy: z.enum(["TON+LP", "TON", "STON"]),
  quick_mode: z.boolean().optional(),
  demo_mode: z.boolean().optional(),
  mode: z.string().optional(),
  withdrawal_address: z.string().optional(),
});
const telegramOnlySchema = z.object({ telegram_id: telegramIdSchema });
const runNowSchema = z.object({
  telegram_id: telegramIdSchema,
  amount_usdt: z.coerce.number().optional(),
});
const withdrawSchema = z.object({
  telegram_id: telegramIdSchema,
  amount_usdt: z.coerce.number().optional(),
  withdrawal_address: z.string().optional(),
  new_address: z.string().optional(),
  to_address: z.string().optional(),
});
const updateFrequencySchema = z.object({
  telegram_id: telegramIdSchema,
  frequency: z.enum(["daily", "weekly", "monthly"]),
});
const updateAmountSchema = z.object({
  telegram_id: telegramIdSchema,
  amount_usdt: z.coerce.number(),
});
const setWithdrawalSchema = z.object({
  telegram_id: telegramIdSchema,
  ton_address: z.string().optional(),
  withdrawal_address: z.string().optional(),
  address: z.string().optional(),
  withdrawalAddress: z.string().optional(),
});
const getHistorySchema = z.object({
  telegram_id: telegramIdSchema,
  limit: z.coerce.number().optional(),
});

function zodError(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

export async function toolGetPortfolio(args: unknown) {
  const parsed = getPortfolioSchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) {
    return sanitizeForMira({
      telegram_id: String(telegramId),
      has_strategy: false,
      message: "No strategy found. Complete onboarding at https://t.me/GramityBot",
      onboarding_url: "https://t.me/GramityBot",
    });
  }
  const data = await buildMiraPortfolio(telegramId);
  return sanitizeForMira(data);
}

export async function toolCreateStrategy(args: unknown) {
  const parsed = createStrategySchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const isQuickMode = parseQuickMode(parsed.data);
  const amount = Number(parsed.data.amount_usdt);
  const amountError = validatePlanAmount(amount, isQuickMode);
  if (amountError) {
    throw new Error(
      `${amountError}: завершите онбординг в Mini App или пополните agent wallet`
    );
  }

  const normalizedFreq = normalizePlanFrequency(
    String(parsed.data.frequency ?? ""),
    isQuickMode
  );
  const strategyLabel = parsed.data.strategy;
  const strategyMode = STRATEGY_MAP[strategyLabel] ?? "full";

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

export async function toolPauseStrategy(args: unknown) {
  const parsed = telegramOnlySchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
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

export async function toolRunNow(args: unknown) {
  const parsed = runNowSchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  if (!hasWithdrawalAddress(plan.ton_address)) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address not set. Call set_withdrawal_address with a TON address (EQ…/UQ…), or ask user to set it in Mini App.",
      withdrawal_address_set: false,
      action: "set_withdrawal_address",
    });
  }

  const withdrawalAddress = plan.ton_address;
  const amountUsdt =
    parsed.data.amount_usdt != null
      ? Number(parsed.data.amount_usdt)
      : plan.usdt_amount;

  if (parsed.data.amount_usdt != null) {
    if (isNaN(amountUsdt) || amountUsdt < MIN_DCA_USDT) {
      throw new Error(`amount_usdt must be >= ${MIN_DCA_USDT}`);
    }
  } else if (!amountUsdt || isNaN(amountUsdt)) {
    throw new Error(
      "No amount_usdt in strategy — set via update_amount or create_strategy"
    );
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
      .sendMessage(telegramId, notify.cycleFailed(errMsg), {
        parse_mode: "Markdown",
      })
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
    lp_tokens_sent_to: maskAddress(withdrawalAddress),
  });
}

export async function toolWithdraw(args: unknown) {
  const parsed = withdrawSchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  if (!hasWithdrawalAddress(plan.ton_address)) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address not set. Call set_withdrawal_address first, or ask user to set it in Mini App.",
      withdrawal_address_set: false,
      action: "set_withdrawal_address",
    });
  }

  const withdrawalAddress = plan.ton_address;
  const newAddress =
    parsed.data.withdrawal_address ??
    parsed.data.new_address ??
    parsed.data.to_address;
  if (newAddress != null && String(newAddress) !== withdrawalAddress) {
    return sanitizeForMira({
      success: false,
      error:
        "Withdrawal address is locked at setup and cannot be changed via AI commands.",
      current_address: maskAddress(withdrawalAddress),
    });
  }

  const walletCtx = await getUserWalletContext(telegramId);
  const balance = await getUsdtBalance(walletCtx.address);
  let amountUsdt =
    parsed.data.amount_usdt != null ? Number(parsed.data.amount_usdt) : balance;

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
    withdrawalAddress
  );
  const txHash = await getLastTxHash(walletCtx.address, 5_000);
  const { bot } = await import("../bot/index.js");
  await bot.api
    .sendMessage(
      telegramId,
      `✅ *$${amountUsdt.toFixed(2)} USDT withdrawn via Mira*\n\n` +
        `To: \`${maskAddress(withdrawalAddress)}\` _(locked)_`,
      { parse_mode: "Markdown" }
    )
    .catch(() => {});

  return sanitizeForMira({
    success: true,
    amount_usdt: amountUsdt,
    sent_to: maskAddress(withdrawalAddress),
    tx: tonTxUrl(txHash),
    note: "Address is locked and cannot be changed via Mira",
  });
}

export async function toolUpdateFrequency(args: unknown) {
  const parsed = updateFrequencySchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) throw new Error("No plan found");

  const nextCycle = getNextPlanExecutionDate({
    frequency: parsed.data.frequency,
    demo_mode: false,
  });
  await updatePlan(telegramId, {
    frequency: parsed.data.frequency,
    next_execution_at: nextCycle.toISOString(),
  });

  return sanitizeForMira({
    updated: true,
    frequency: parsed.data.frequency,
    next_cycle: nextCycle.toISOString(),
  });
}

export async function toolUpdateAmount(args: unknown) {
  const parsed = updateAmountSchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const amountUsdt = Number(parsed.data.amount_usdt);
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

export async function toolGetHistory(args: unknown) {
  const parsed = getHistorySchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const limit =
    parsed.data.limit != null ? Number(parsed.data.limit) : 5;
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

export async function toolResumeStrategy(args: unknown) {
  const parsed = telegramOnlySchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
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

export async function toolSetWithdrawalAddress(args: unknown) {
  const parsed = setWithdrawalSchema.safeParse(args);
  if (!parsed.success) throw new Error(zodError(parsed.error));
  const telegramId = parseTelegramId(parsed.data.telegram_id);
  if (telegramId === null) throw new Error("telegram_id required");

  const raw =
    parsed.data.ton_address ??
    parsed.data.withdrawal_address ??
    parsed.data.address ??
    parsed.data.withdrawalAddress;
  if (raw == null || String(raw).trim() === "") {
    throw new Error("ton_address required (EQ… or UQ… TON wallet)");
  }

  const normalized = normalizeTonAddress(String(raw));
  if (!normalized) {
    throw new Error("Invalid TON withdrawal address. Use EQ… or UQ… format.");
  }

  const plan = await getPlanByTelegramId(telegramId);
  if (!plan) {
    throw new Error(
      "No plan found. User must complete onboarding in Mini App first."
    );
  }

  if (hasWithdrawalAddress(plan.ton_address)) {
    const lockedAddress = plan.ton_address;
    return sanitizeForMira({
      success: false,
      error: "Withdrawal address is already set and locked.",
      withdrawal_address_set: true,
      withdrawal_address_masked: maskAddress(lockedAddress),
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

export { getMcpManifest };

const TOOL_HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
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
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data),
      },
    ],
  };
}

export async function handleMcpRequest(body: {
  jsonrpc?: string;
  method?: string;
  params?: { name?: string; arguments?: unknown };
  id?: number | string | null;
}) {
  const id = body.id ?? null;

  if (body.method === "tools/list") {
    const manifest = getMcpManifest();
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: manifest.tools },
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
