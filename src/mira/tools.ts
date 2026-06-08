import {
  getPlanByTelegramId,
  updatePlan,
  getPool,
} from "../db/index.js";
import { MIN_DCA_USDT } from "../constants/dca.js";
import { createUserWallet } from "../services/userWallet.js";
import { RAILWAY_PUBLIC_URL } from "../config.js";
import { buildMiraPortfolio } from "./portfolio.js";
import { sanitizeForMira, maskAddress } from "./utils.js";

type FreqType = "weekly" | "biweekly" | "monthly" | "daily";

const STRATEGY_MAP: Record<string, "full" | "stake_only" | "accumulate"> = {
  "TON+LP": "full",
  TON: "stake_only",
  STON: "accumulate",
};

function parseTelegramId(raw: unknown): number | null {
  const id = Number(raw);
  if (!id || isNaN(id)) return null;
  return id;
}

function getNextExecutionDate(frequency: FreqType): Date {
  const next = new Date();
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  else next.setDate(next.getDate() + 7);
  return next;
}

export async function toolGetPortfolio(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (!telegramId) throw new Error("telegram_id required");

  const data = await buildMiraPortfolio(telegramId);
  return sanitizeForMira(data);
}

export async function toolCreateStrategy(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (!telegramId) throw new Error("telegram_id required");

  const amount = Number(args.amount_usdt);
  if (!amount || isNaN(amount) || amount < MIN_DCA_USDT) {
    throw new Error(
      `amount_usdt must be >= ${MIN_DCA_USDT}: завершите онбординг в Mini App или пополните agent wallet`
    );
  }

  const frequency = String(args.frequency ?? "weekly") as FreqType;
  const validFreqs: FreqType[] = ["daily", "weekly", "biweekly", "monthly"];
  const normalizedFreq = validFreqs.includes(frequency) ? frequency : "weekly";

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
  const nextExec = getNextExecutionDate(normalizedFreq);

  await getPool().query(
    `UPDATE plans SET
       usdt_amount = $2,
       frequency = $3,
       strategy_mode = $4,
       active = true,
       next_execution_at = $5
     WHERE telegram_id = $1`,
    [telegramId, amount, normalizedFreq, strategyMode, nextExec.toISOString()]
  );

  const agentWallet = await createUserWallet(telegramId).catch(() => "");

  const { bot } = await import("../bot/index.js");
  const FREQ_LABELS: Record<string, string> = {
    daily: "daily",
    weekly: "weekly",
    biweekly: "every 2 weeks",
    monthly: "monthly",
  };

  await bot.api.sendMessage(
    telegramId,
    `✅ *Strategy updated via Mira*\n\n` +
      `Strategy: ${strategyLabel}\n` +
      `Amount: $${amount.toFixed(0)} USDT / cycle\n` +
      `Frequency: ${FREQ_LABELS[normalizedFreq] ?? normalizedFreq}\n` +
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
    strategy: strategyLabel,
    withdrawal_address_masked: maskAddress(originalWithdrawal),
    agent_wallet_address: agentWallet,
    withdrawal_address_unchanged: true,
  });
}

export async function toolPauseStrategy(args: Record<string, unknown>) {
  const telegramId = parseTelegramId(args.telegram_id);
  if (!telegramId) throw new Error("telegram_id required");

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
      min_amount_usdt: MIN_DCA_USDT,
      demo_available: true,
      onboarding_required: true,
    },
    tools: [
      {
        name: "get_portfolio",
        description:
          "Returns portfolio summary, usdt_balance, can_run_next_cycle, next_cycle_requires_usdt, and masked withdrawal address. Use top_up_hint when can_run_next_cycle is false.",
        inputSchema: {
          type: "object",
          required: ["telegram_id"],
          properties: { telegram_id: { type: "string" } },
        },
      },
      {
        name: "create_strategy",
        description:
          `Update an existing DCA strategy (min $${MIN_DCA_USDT} USDT/cycle). Requires completed Mini App onboarding — cannot create plans or change withdrawal address via Mira.`,
        inputSchema: {
          type: "object",
          required: ["telegram_id", "amount_usdt", "frequency", "strategy"],
          properties: {
            telegram_id: { type: "string" },
            amount_usdt: { type: "number", minimum: MIN_DCA_USDT },
            frequency: { type: "string" },
            strategy: { type: "string" },
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
};

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
    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}
