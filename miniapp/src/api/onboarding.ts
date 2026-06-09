import { apiCall } from "./client";

export interface OnboardingWalletResponse {
  agent_wallet_address?: string;
  deposit_address?: string;
  usdt_balance?: number;
  ton_balance?: number;
  min_dca_usdt?: number;
  gas_reserve_ton?: number;
}

export function fetchOnboardingWallet(seedGas = false): Promise<OnboardingWalletResponse> {
  const q = seedGas ? "?seed_gas=1" : "";
  return apiCall<OnboardingWalletResponse>(`/api/onboarding/wallet${q}`);
}
