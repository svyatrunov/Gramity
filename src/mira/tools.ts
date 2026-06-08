import {
  getPlanByTelegramId,
  updatePlan,
  getPool,
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
import { createUserWallet } from "../services/userWallet.js";
import { RAILWAY_PUBLIC_URL } from "../config.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { sanitizeForMira, maskAddress, parseTelegramId } from "./utils.js";

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
      "No Gramity plan found. User must complete onboarding in Mini App first (withdrawal address is locked there)."
    );
  }

  const originalWithdrawal = existing.ton_address;
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
      `Withdrawal: \`${maskAddress(originalWithdrawal)}\` _(locked)_\n\n` +
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
    withdrawal_address_masked: maskAddress(originalWithdrawal),
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

export function getMcpManifest() {
  const base = RAILWAY_PUBLIC_URL;
  return {
    name: "gramity",
    version: "1.0.0",
    description:
      "Gramity — custodial DCA executor on TON mainnet. Post-onboarding control plane via Mira; onboarding must be completed in Mini App first. No funds flow through Mira.",
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
    },
    tools: [
      {
        name: "get_portfolio",
        description:
          "Returns portfolio summary, usdt_balance, can_run_next_cycle, next_cycle_requires_usdt, quick_mode flag, and masked withdrawal address. Use top_up_hint when can_run_next_cycle is false.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: { telegram_id: { type: "string" } },
        },
      },
      {
        name: "create_strategy",
        description:
          `Update an existing DCA strategy. Standard mode: min $${MIN_DCA_USDT}, frequencies daily/weekly/biweekly/monthly. Quick Start: min $${QUICK_MIN_USDT}, intervals 10s/30s/60s, 2 cycles on mainnet. Set quick_mode=true (or demo_mode=true) to switch user to Quick Start.`,
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
