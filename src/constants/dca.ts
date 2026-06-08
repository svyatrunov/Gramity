export const MIN_DCA_USDT = 10;
export const MIN_SCAN_USD = 5;
export const DEMO_MIN_USDT = 5;
export const GAS_RESERVE_TON = 0.8;

/** swap + stake + LP add per cycle */
export const CYCLE_GAS_TON_ESTIMATE = 0.7;

export const ECONOMICS_HINT_THRESHOLD_USDT = 50;

export function minPlanAmountUsdt(demoMode: boolean): number {
  return demoMode ? DEMO_MIN_USDT : MIN_DCA_USDT;
}

export function validatePlanAmount(
  amount: number,
  demoMode: boolean
): string | null {
  const min = minPlanAmountUsdt(demoMode);
  if (!amount || isNaN(amount)) {
    return `amount_usdt must be >= ${min}`;
  }
  if (amount < min) {
    return `amount_usdt must be >= ${min}`;
  }
  return null;
}

export type EconomicsHint = {
  gas_overhead_pct_estimate: number;
  recommended_frequency: "weekly" | "biweekly" | "monthly";
};

export function buildEconomicsHint(
  amountUsdt: number,
  tonPriceUsd: number
): EconomicsHint | undefined {
  if (amountUsdt >= ECONOMICS_HINT_THRESHOLD_USDT) return undefined;

  const gasUsd = CYCLE_GAS_TON_ESTIMATE * tonPriceUsd;
  const gas_overhead_pct_estimate = Math.min(
    99,
    Math.round((gasUsd / amountUsdt) * 100)
  );

  const recommended_frequency: EconomicsHint["recommended_frequency"] =
    amountUsdt < 20 ? "biweekly" : "weekly";

  return { gas_overhead_pct_estimate, recommended_frequency };
}
