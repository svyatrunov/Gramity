import { apiCall } from "./client";

export type MiraSource = "onboarding" | "dashboard";

export interface MiraContextResponse {
  token?: string;
  mira_deeplink?: string;
}

export function createMiraContext(source: MiraSource): Promise<MiraContextResponse> {
  return apiCall<MiraContextResponse>("/api/mira/create-context", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}
