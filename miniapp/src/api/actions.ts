import { apiCall } from "./client";

export function pausePlan(): Promise<{ ok?: boolean; active?: boolean }> {
  return apiCall("/api/plan/pause", { method: "POST", body: "{}" });
}

export function resumePlan(): Promise<{ ok?: boolean; active?: boolean }> {
  return apiCall("/api/plan/resume", { method: "POST", body: "{}" });
}

export function runNow(cycles = 1): Promise<{ ok?: boolean; message?: string }> {
  return apiCall("/api/run-now", {
    method: "POST",
    body: JSON.stringify({ cycles }),
  });
}

export function withdrawUsdt(amount: number): Promise<{ sent?: number }> {
  return apiCall("/api/withdraw/usdt", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });
}
