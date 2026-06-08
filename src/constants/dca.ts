export const MIN_DCA_USDT = 10;
export const MIN_SCAN_USD = 5;
/** Quick Start on mainnet — real cycles, short interval */
export const QUICK_MIN_USDT = 2;
/** @deprecated use QUICK_MIN_USDT */
export const DEMO_MIN_USDT = QUICK_MIN_USDT;

export const QUICK_INTERVALS = {
  "10s": 10_000,
  "30s": 30_000,
  "60s": 60_000,
} as const;

export type QuickIntervalKey = keyof typeof QUICK_INTERVALS;

export const QUICK_INTERVAL_KEYS = Object.keys(QUICK_INTERVALS) as QuickIntervalKey[];

export type StandardFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export type PlanFrequency =
  | StandardFrequency
  | QuickIntervalKey
  | "minutely"
  | "hourly"
  | "demo";

export const STANDARD_FREQUENCIES: StandardFrequency[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
];

export const QUICK_FREQ_LABELS: Record<QuickIntervalKey, string> = {
  "10s": "every 10 seconds",
  "30s": "every 30 seconds",
  "60s": "every minute",
};

export function isQuickPlan(demoMode: boolean, frequency?: string): boolean {
  if (demoMode) return true;
  if (!frequency) return false;
  return frequency === "demo" || frequency in QUICK_INTERVALS;
}

export function quickIntervalMs(frequency: string): number | null {
  if (frequency in QUICK_INTERVALS) {
    return QUICK_INTERVALS[frequency as QuickIntervalKey];
  }
  if (frequency === "demo") return QUICK_INTERVALS["10s"];
  return null;
}

export function minPlanAmountUsdt(quickMode: boolean): number {
  return quickMode ? QUICK_MIN_USDT : MIN_DCA_USDT;
}

export function validatePlanAmount(
  amount: number,
  quickMode: boolean
): string | null {
  const min = minPlanAmountUsdt(quickMode);
  if (!amount || isNaN(amount)) {
    return `amount_usdt must be >= ${min}`;
  }
  if (amount < min) {
    return `amount_usdt must be >= ${min}`;
  }
  return null;
}

export function normalizePlanFrequency(
  raw: string,
  quickMode: boolean
): PlanFrequency {
  if (quickMode) {
    if (raw in QUICK_INTERVALS) return raw as QuickIntervalKey;
    return "10s";
  }
  const valid: PlanFrequency[] = [
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "minutely",
    "hourly",
  ];
  return valid.includes(raw as PlanFrequency) ? (raw as PlanFrequency) : "weekly";
}

export function getNextPlanExecutionDate(plan: {
  frequency: string;
  demo_mode?: boolean;
}): Date {
  const next = new Date();
  const quick = isQuickPlan(plan.demo_mode ?? false, plan.frequency);
  const intervalMs = quick ? quickIntervalMs(plan.frequency) : null;

  if (intervalMs != null) {
    next.setTime(next.getTime() + intervalMs);
    return next;
  }

  const frequency = plan.frequency;
  if (frequency === "minutely") next.setMinutes(next.getMinutes() + 1);
  else if (frequency === "hourly") next.setHours(next.getHours() + 1);
  else if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  else if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + 7);

  return next;
}

export function formatPlanFrequency(frequency: string, quickMode?: boolean): string {
  if (frequency in QUICK_INTERVALS) {
    return QUICK_FREQ_LABELS[frequency as QuickIntervalKey];
  }
  if (quickMode || frequency === "demo") return QUICK_FREQ_LABELS["10s"];
  const labels: Record<string, string> = {
    daily: "daily",
    weekly: "weekly",
    biweekly: "every 2 weeks",
    monthly: "monthly",
    minutely: "every minute",
    hourly: "every hour",
  };
  return labels[frequency] ?? frequency;
}

export const GAS_RESERVE_TON = 0.8;

/** swap + stake + LP add per cycle */
export const CYCLE_GAS_TON_ESTIMATE = 0.7;

export const ECONOMICS_HINT_THRESHOLD_USDT = 50;

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
