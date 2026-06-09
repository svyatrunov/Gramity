import { RAILWAY_PUBLIC_URL } from "../config.js";
import {
  MIN_DCA_USDT,
  QUICK_MIN_USDT,
  QUICK_INTERVAL_KEYS,
  STANDARD_FREQUENCIES,
} from "../constants/dca.js";

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
        description: `Update an existing DCA strategy (plan must exist from Mini App onboarding). Standard mode: min $${MIN_DCA_USDT}, frequencies daily/weekly/biweekly/monthly. Quick Start: min $${QUICK_MIN_USDT}, intervals 10s/30s/60s, 2 cycles on mainnet. Set quick_mode=true (or demo_mode=true) to switch user to Quick Start. Does not set withdrawal address — use set_withdrawal_address if missing.`,
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
              description:
                "User's TON wallet (EQ… or UQ…). LP tokens and withdrawals go here.",
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
