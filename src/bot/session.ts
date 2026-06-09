import { Context, SessionFlavor } from "grammy";

export type OnboardingStep =
  | "idle"
  | "waiting_wallet"
  | "waiting_deposit_confirm"
  | "waiting_amount"
  | "waiting_custom_amount"
  | "waiting_settings_amount"
  | "waiting_frequency"
  | "confirming";

export interface UserSession {
  step: OnboardingStep;
  tonAddress?: string;
  /** Per-user isolated deposit wallet address (UQ format) */
  depositAddress?: string;
  usdtBalance?: number;
  amount?: number;
  frequency?: "weekly" | "biweekly" | "monthly" | "daily" | "minutely" | "hourly";
  /** @deprecated use NODE_ENV !== production for dev intervals */
  devMode?: boolean;
  strategyWizard?: {
    step: "type" | "amount" | "custom_amount" | "frequency" | "wallet" | "output_or_wallet" | "confirm";
    strategy_type?: "dca_ton" | "dca_tston" | "dca_lp";
    amount_usdt?: number;
    frequency?: string;
    withdrawal_wallet?: string;
    output_mode?: "reinvest" | "withdraw";
  };
}

export type GramityContext = Context & SessionFlavor<UserSession>;

export function initialSession(): UserSession {
  return { step: "idle" };
}
