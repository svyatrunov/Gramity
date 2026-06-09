import { apiCall } from "./client";
import type { StrategyMode } from "../config";

export interface EconomicsHint {
  gas_overhead_pct_estimate?: number;
  recommended_frequency?: string;
}

export interface CreatePlanBody {
  ton_address: string;
  amount_usdt: number;
  frequency: string;
  strategy_mode: StrategyMode;
  demo_mode?: boolean;
}

export interface CreatePlanResponse {
  ok?: boolean;
  plan_id?: string;
  agent_wallet_address?: string;
  deposit_address?: string;
  economics_hint?: EconomicsHint;
  demo_mode?: boolean;
}

export interface DcaLimits {
  min_dca_usdt?: number;
  quick_min_usdt?: number;
  demo_min_usdt?: number;
  quick_intervals?: string[];
}

export function createPlan(body: CreatePlanBody): Promise<CreatePlanResponse> {
  return apiCall<CreatePlanResponse>("/api/plans", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchDcaLimits(): Promise<DcaLimits> {
  return apiCall<DcaLimits>("/api/dca/limits");
}
