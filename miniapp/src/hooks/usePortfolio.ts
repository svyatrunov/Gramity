import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchPortfolio, type PortfolioResponse } from "../api/portfolio";

const POLL_MS = 30_000;

export function usePortfolio(enabled = true) {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await fetchPortfolio();
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) {
        setError(
          e instanceof ApiError
            ? e
            : new ApiError("SERVER_ERROR", 0, "Что-то пошло не так")
        );
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      if (mounted.current) setLoading(false);
    }, 5_000);

    void refresh().finally(() => clearTimeout(timeout));
    const id = setInterval(() => void refresh(), POLL_MS);

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refresh();
    });

    return () => {
      mounted.current = false;
      clearTimeout(timeout);
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  return { data, loading, error, refresh };
}
