import { Context, SessionFlavor } from "grammy";

export type OnboardingStep =
  | "idle"
  | "waiting_wallet"
  | "waiting_deposit_confirm"
  | "waiting_amount"
  | "waiting_custom_amount"
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
  /** Enabled via /dev — shows test frequencies in prod */
  devMode?: boolean;
}

export type GramityContext = Context & SessionFlavor<UserSession>;

export function initialSession(): UserSession {
  return { step: "idle" };
}
