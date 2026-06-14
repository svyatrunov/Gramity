import {
  clearBotState,
  getBotState,
  setBotState,
  type BotStateRow,
} from "../db/index.js";
import type { OnboardingStep, StrategyWizard } from "./context.js";

export interface ParsedBotState {
  step: OnboardingStep;
  tonAddress?: string;
  depositAddress?: string;
  usdtBalance?: number;
  amount?: number;
  frequency?: string;
  strategyWizard?: StrategyWizard;
}

export function botTgId(ctx: { from?: { id?: number } }): string | null {
  const id = ctx.from?.id;
  return id != null ? String(id) : null;
}

function parseRow(row: BotStateRow | null): ParsedBotState {
  const extra = (row?.extra ?? {}) as Record<string, unknown>;
  return {
    step: (row?.step as OnboardingStep) ?? "idle",
    tonAddress: row?.ton_address ?? undefined,
    amount: row?.amount != null ? Number(row.amount) : undefined,
    frequency: row?.frequency ?? undefined,
    depositAddress:
      typeof extra.deposit_address === "string"
        ? extra.deposit_address
        : undefined,
    usdtBalance:
      typeof extra.usdt_balance === "number" ? extra.usdt_balance : undefined,
    strategyWizard: extra.strategy_wizard as StrategyWizard | undefined,
  };
}

export async function readState(
  telegramId: string | number
): Promise<ParsedBotState> {
  const row = await getBotState(String(telegramId));
  return parseRow(row);
}

export async function writeState(
  telegramId: string | number,
  patch: Partial<ParsedBotState>
): Promise<void> {
  const tid = String(telegramId);
  const dbPatch: Parameters<typeof setBotState>[1] = {};

  if (patch.step !== undefined) dbPatch.step = patch.step;
  if (patch.tonAddress !== undefined) dbPatch.ton_address = patch.tonAddress;
  if (patch.amount !== undefined) dbPatch.amount = patch.amount;
  if (patch.frequency !== undefined) dbPatch.frequency = patch.frequency;

  const touchesExtra =
    "depositAddress" in patch ||
    "usdtBalance" in patch ||
    "strategyWizard" in patch;

  if (touchesExtra) {
    const current = await getBotState(tid);
    const extra = { ...((current?.extra ?? {}) as Record<string, unknown>) };
    if ("depositAddress" in patch) {
      extra.deposit_address = patch.depositAddress;
    }
    if ("usdtBalance" in patch) {
      extra.usdt_balance = patch.usdtBalance;
    }
    if ("strategyWizard" in patch) {
      if (patch.strategyWizard === undefined) {
        delete extra.strategy_wizard;
      } else {
        extra.strategy_wizard = patch.strategyWizard;
      }
    }
    dbPatch.extra = extra;
  }

  await setBotState(tid, dbPatch);
}

export async function resetState(telegramId: string | number): Promise<void> {
  await clearBotState(String(telegramId));
}

export async function clearStrategyWizard(
  telegramId: string | number
): Promise<void> {
  await writeState(telegramId, { strategyWizard: undefined });
}
