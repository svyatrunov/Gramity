import { apiCall } from "./client";

export type StrategyType = "dca_ton" | "dca_tston" | "dca_lp";
export type StrategyStatus = "active" | "paused" | "stopped";
export type StrategyOutputMode = "reinvest" | "withdraw";

export interface StrategyInfo {
  id: number;
  strategy_type: StrategyType;
  amount_usdt: number;
  frequency: string;
  withdrawal_wallet: string | null;
  output_mode: StrategyOutputMode;
  status: StrategyStatus;
  total_cycles: number;
  total_invested: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
}

export interface CreateStrategyBody {
  strategy_type: StrategyType;
  amount_usdt: number;
  frequency: string;
  withdrawal_wallet?: string | null;
  output_mode?: StrategyOutputMode;
}

export interface CreateStrategyResponse {
  ok: boolean;
  strategy: StrategyInfo;
  deposit_address?: string;
}

export function fetchStrategies(): Promise<{ strategies: StrategyInfo[] }> {
  return apiCall<{ strategies: StrategyInfo[] }>("/api/strategies");
}

export function createStrategy(
  body: CreateStrategyBody
): Promise<CreateStrategyResponse> {
  return apiCall<CreateStrategyResponse>("/api/strategies", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function pauseStrategy(id: number): Promise<{ ok: boolean; strategy: StrategyInfo }> {
  return apiCall(`/api/strategies/${id}/pause`, { method: "POST" });
}

export function resumeStrategy(id: number): Promise<{ ok: boolean; strategy: StrategyInfo }> {
  return apiCall(`/api/strategies/${id}/resume`, { method: "POST" });
}

export function stopStrategy(id: number): Promise<{ ok: boolean }> {
  return apiCall(`/api/strategies/${id}/stop`, { method: "POST" });
}

/** Map legacy onboarding strategy_mode → new strategy_type (backward compat). */
export function legacyModeToStrategyType(
  mode: string
): StrategyType {
  if (mode === "stake_only") return "dca_tston";
  if (mode === "accumulate") return "dca_ton";
  return "dca_lp";
}

export const STRATEGY_TYPE_LABELS: Record<StrategyType, string> = {
  dca_ton: "Buy TON",
  dca_tston: "Stake (tsTON)",
  dca_lp: "LP DCA",
};
