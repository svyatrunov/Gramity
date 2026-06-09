import { getInitData } from "./telegram";

/** Fire-and-forget breadcrumb for server-side diagnosis (no initData in body). */
export function diagClient(
  stage: string,
  extra?: { ms?: number; error?: string }
): void {
  try {
    const initData = getInitData();
    void fetch("/api/diag/client", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
      },
      body: JSON.stringify({ stage, ...extra }),
    });
  } catch {
    /* ignore */
  }
}
