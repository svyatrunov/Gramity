export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? "gramity_bot";

// DEV ONLY — never reaches production
export const DEV_INIT_DATA = import.meta.env.DEV
  ? `user=${encodeURIComponent(
      JSON.stringify({
        id: Number(import.meta.env.VITE_DEV_TG_ID ?? "0"),
        first_name: "Dev",
        username: "devuser",
      })
    )}&auth_date=${Math.floor(Date.now() / 1000)}&hash=devhash`
  : null;

export const MANIFEST_URL = `${window.location.origin}/app/tonconnect-manifest.json`;

export type StrategyMode = "full" | "stake_only" | "accumulate";

export const STRATEGY_MODE_LABELS: Record<StrategyMode, string> = {
  full: "TON+LP",
  stake_only: "Staking",
  accumulate: "STON",
};

export const STRATEGY_MODE_OPTIONS: Array<{ value: StrategyMode; label: string }> = [
  { value: "full", label: "TON+LP" },
  { value: "stake_only", label: "Stake" },
  { value: "accumulate", label: "STON" },
];

export const STANDARD_FREQUENCIES = ["daily", "weekly", "biweekly", "monthly"] as const;
export const QUICK_FREQUENCIES = ["10s", "30s", "60s"] as const;

export const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "biweekly", label: "Раз в 2 недели" },
  { value: "monthly", label: "Ежемесячно" },
] as const;

export const QUICK_FREQUENCY_OPTIONS = [
  { value: "10s", label: "10 сек" },
  { value: "30s", label: "30 сек" },
  { value: "60s", label: "60 сек" },
] as const;

export const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Ежедневно",
  weekly: "Еженедельно",
  biweekly: "Раз в 2 нед.",
  monthly: "Ежемесячно",
  "10s": "Каждые 10 сек",
  "30s": "Каждые 30 сек",
  "60s": "Каждую минуту",
};

export const TON_ADDRESS_RE = /^(UQ|EQ)[a-zA-Z0-9_-]{46}$/;

export function strategyModeLabel(mode: string | undefined): string {
  if (!mode) return "—";
  return STRATEGY_MODE_LABELS[mode as StrategyMode] ?? mode;
}

export function maskAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function isValidTonAddress(addr: string): boolean {
  return TON_ADDRESS_RE.test(addr.trim());
}

export function validateAmountUsdt(amount: number, demoMode: boolean): boolean {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
  const min = demoMode ? 2 : 5;
  return amount >= min && amount <= 10_000;
}

export function validateFrequency(freq: string, demoMode: boolean): boolean {
  const allowed = demoMode ? QUICK_FREQUENCIES : STANDARD_FREQUENCIES;
  return (allowed as readonly string[]).includes(freq);
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}
