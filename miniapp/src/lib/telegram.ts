import { DEV_INIT_DATA } from "../config";

export const tg =
  typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;

const INIT_DATA_POLL_MS = 100;
const INIT_DATA_MAX_WAIT_MS = 3_000;

export function initTelegram(): void {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableClosingConfirmation?.();
    tg.BackButton?.hide();
    tg.setHeaderColor?.("#0B0B12");
    tg.setBackgroundColor?.("#0B0B12");
    if (tg.themeParams?.bg_color) {
      document.documentElement.style.setProperty(
        "--tg-theme-bg",
        tg.themeParams.bg_color,
      );
    }
  } catch (e) {
    console.error("[TG] WebApp init failed:", e);
  }
}

/** Parse telegram user id from initData query string (`user={"id":…}`). */
export function parseTelegramIdFromInitData(initData: string): number | null {
  if (!initData) return null;
  try {
    const userJson = new URLSearchParams(initData).get("user");
    if (!userJson) return null;
    const user = JSON.parse(userJson) as { id?: number };
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

export function buildDevInitData(telegramId: number): string {
  return (
    `user=${encodeURIComponent(
      JSON.stringify({
        id: telegramId,
        first_name: "Dev",
        username: "devuser",
      }),
    )}` +
    `&auth_date=${Math.floor(Date.now() / 1000)}&hash=devhash`
  );
}

function readUrlQueryId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("id");
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function getTelegramUser() {
  if (tg?.initDataUnsafe?.user) return tg.initDataUnsafe.user;
  const id = parseTelegramIdFromInitData(getInitData());
  if (id != null) return { id };
  return null;
}

/** Resolved telegram id: auth API → initData query → initDataUnsafe. */
export function getTelegramUserId(): number | null {
  const w = window as Window & { __userId?: number };
  if (typeof w.__userId === "number" && w.__userId > 0) return w.__userId;
  const fromInit = parseTelegramIdFromInitData(getInitData());
  if (fromInit != null) return fromInit;
  return tg?.initDataUnsafe?.user?.id ?? null;
}

function readInitDataOnce(): string {
  const live = tg?.initData?.trim();
  if (live && live.includes("hash=")) return live;

  const urlId = readUrlQueryId();
  if (urlId != null) {
    const devData = buildDevInitData(urlId);
    try {
      localStorage.setItem("gramity_dev_init_data", devData);
    } catch {
      /* ignore */
    }
    return devData;
  }

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

/** Telegram sometimes populates initData shortly after WebApp.ready(). */
export function getInitData(): string {
  return readInitDataOnce();
}

export function waitForInitData(
  maxWaitMs = INIT_DATA_MAX_WAIT_MS
): Promise<string> {
  initTelegram();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const data = readInitDataOnce();
      if (data.includes("hash=") || Date.now() - started >= maxWaitMs) {
        resolve(data);
        return;
      }
      setTimeout(tick, INIT_DATA_POLL_MS);
    };
    tick();
  });
}

export function hasTelegramAuth(): boolean {
  return getInitData().includes("hash=");
}
