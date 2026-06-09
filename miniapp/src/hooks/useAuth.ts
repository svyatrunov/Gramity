import { useEffect, useState } from "react";
import { API_BASE } from "../config";
import { initTelegram, waitForInitData } from "../lib/telegram";
import { diagClient } from "../lib/diagClient";

export interface AuthUser {
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

const AUTH_TIMEOUT_MS = 5_000;

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError((prev) => prev ?? "auth_timeout");
        diagClient("auth_timeout");
      }
    }, AUTH_TIMEOUT_MS);

    async function authenticate() {
      const t0 = Date.now();
      diagClient("auth_start");
      try {
        initTelegram();
        const initData = await waitForInitData();
        if (!initData.includes("hash=")) {
          diagClient("auth_no_init_data", { ms: Date.now() - t0 });
          setError("no_init_data");
          return;
        }

        diagClient("auth_init_data_ready", { ms: Date.now() - t0 });

        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 8_000);

        const res = await fetch(`${API_BASE}/api/auth/telegram`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
          signal: controller.signal,
        });
        clearTimeout(fetchTimeout);

        if (!res.ok) {
          throw new Error(`auth failed: ${res.status}`);
        }

        const data = (await res.json()) as {
          userId?: number;
          user: AuthUser & { telegramId?: number };
        };
        if (!cancelled) {
          const u = data.user;
          const telegramId = data.userId ?? u.telegramId ?? u.telegram_id;
          (window as Window & { __userId?: number }).__userId = telegramId;
          setUser({
            telegram_id: telegramId,
            username: u.username,
            first_name: u.first_name,
            last_name: u.last_name,
          });
          diagClient("auth_ok", { ms: Date.now() - t0 });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "unknown");
          diagClient("auth_fail", {
            ms: Date.now() - t0,
            error: e instanceof Error ? e.message : "unknown",
          });
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    }

    void authenticate();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  return { user, loading, error };
}
