import { apiCall } from "./client";

export interface PlanInfo {
  usdt_amount?: number;
  frequency?: string;
  strategy_mode?: string;
  active?: boolean;
  is_running?: boolean;
  consecutive_failures?: number;
  next_execution_at?: string;
  ton_address?: string | null;
  withdrawal_address_set?: boolean;
  cycles_completed?: number;
}

export interface ExecutionInfo {
  executed_at?: string;
  usdt_spent?: number | null;
  status?: string;
  tx_swap?: string | null;
}

export interface PortfolioResponse {
  depositAddress?: string;
  usdtBalance?: number;
  tonBalance?: number;
  lpValue?: number | null;
  totalValue?: number;
  est_value_usd?: number;
  plan?: PlanInfo | null;
  executions?: ExecutionInfo[];
}

export function fetchPortfolio(): Promise<PortfolioResponse> {
  return apiCall<PortfolioResponse>("/api/portfolio");
}

export function getPortfolio(): Promise<PortfolioResponse> {
  return fetchPortfolio();
}
