import type { Context } from "grammy";

export type OnboardingStep =
  | "idle"
  | "waiting_wallet"
  | "waiting_deposit_confirm"
  | "waiting_amount"
  | "waiting_custom_amount"
  | "waiting_settings_amount"
  | "waiting_frequency"
  | "confirming";

export interface StrategyWizard {
  step:
    | "type"
    | "amount"
    | "custom_amount"
    | "frequency"
    | "wallet"
    | "output_or_wallet"
    | "confirm";
  strategy_type?: "dca_ton" | "dca_tston" | "dca_lp" | "dca_jetton";
  amount_usdt?: number;
  frequency?: string;
  withdrawal_wallet?: string;
  output_mode?: "reinvest" | "withdraw";
}

export type GramityContext = Context;
