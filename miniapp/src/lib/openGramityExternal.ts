/**
 * Single entry point for opening Gramity pages in the system browser from Telegram.
 * Prevents double-tab (window.open + tg.openLink) and logs open attempts.
 */

type TelegramWebApp = {
  initData?: string;
  openLink?: (url: string) => void;
};

function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function isInsideTelegramMiniApp(): boolean {
  const tg = getTelegramWebApp();
  return Boolean(tg?.initData && tg.initData.includes("hash="));
}

export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? "");
}

let lastOpenUrl = "";
let lastOpenAt = 0;
const OPEN_DEBOUNCE_MS = 4000;

function shouldSkipDuplicateOpen(url: string): boolean {
  const now = Date.now();
  if (url === lastOpenUrl && now - lastOpenAt < OPEN_DEBOUNCE_MS) {
    console.warn("[GramityOpen] skipped duplicate open within debounce window:", url);
    return true;
  }
  lastOpenUrl = url;
  lastOpenAt = now;
  return false;
}

/**
 * Open https URL in external browser from Telegram mini app.
 * Desktop: tg.openLink ONLY (window.open duplicates tabs on Telegram Desktop).
 * Mobile: tg.openLink.
 */
export function openGramityExternalUrl(url: string): void {
  const href = url.trim();
  if (!href) return;
  if (shouldSkipDuplicateOpen(href)) return;

  console.info("[GramityOpen] open external:", href.slice(0, 80));

  const tg = getTelegramWebApp();
  if (isInsideTelegramMiniApp() && tg?.openLink) {
    tg.openLink(href);
    return;
  }

  const popup = window.open(href, "_blank", "noopener,noreferrer");
  if (!popup) window.location.assign(href);
}
