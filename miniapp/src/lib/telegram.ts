import { DEV_INIT_DATA } from "../config";

export const tg =
  typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0B0B12");
  tg.setBackgroundColor?.("#0B0B12");
}

export function getTelegramUser() {
  if (!tg?.initDataUnsafe?.user) return null;
  return tg.initDataUnsafe.user;
}

export function getInitData(): string {
  const live = tg?.initData?.trim();
  if (live && live.includes("hash=")) return live;
  if (import.meta.env.DEV && DEV_INIT_DATA) return DEV_INIT_DATA;
  if (import.meta.env.DEV) {
    try {
      return localStorage.getItem("gramity_dev_init_data") ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function hasTelegramAuth(): boolean {
  return getInitData().includes("hash=");
}
