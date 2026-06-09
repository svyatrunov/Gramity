import { API_BASE, DEV_INIT_DATA } from "../config";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public userMessage: string
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_ERROR: "Откройте приложение из Telegram-бота",
  TOKEN_EXPIRED: "Сессия истекла — перезапустите приложение",
  NO_INIT_DATA: "Откройте приложение из Telegram-бота",
  SERVER_ERROR: "Что-то пошло не так",
  withdrawal_address_required: "Укажите адрес вывода TON",
  "Invalid ton_address": "Неверный формат TON-адреса",
  "Invalid TON withdrawal address": "Неверный формат TON-адреса",
};

export function sanitizeUserError(code: string, raw?: string): string {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (raw && ERROR_MESSAGES[raw]) return ERROR_MESSAGES[raw];
  return "Что-то пошло не так";
}

export function getInitData(): string {
  const tgData = window.Telegram?.WebApp?.initData;
  if (tgData && tgData.includes("hash=")) return tgData;
  if (DEV_INIT_DATA) return DEV_INIT_DATA;
  return "";
}

export async function apiCall<T>(path: string, options: RequestInit = {}): Promise<T> {
  const initData = getInitData();

  if (!initData && !import.meta.env.DEV) {
    throw new ApiError("NO_INIT_DATA", 0, sanitizeUserError("NO_INIT_DATA"));
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("SERVER_ERROR", 0, "Ошибка соединения");
  }

  if (res.status === 401) {
    throw new ApiError("AUTH_ERROR", 401, sanitizeUserError("AUTH_ERROR"));
  }
  if (res.status === 410) {
    throw new ApiError("TOKEN_EXPIRED", 410, sanitizeUserError("TOKEN_EXPIRED"));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const code = body.error ?? "SERVER_ERROR";
    throw new ApiError(code, res.status, sanitizeUserError(code, body.message));
  }

  return res.json() as Promise<T>;
}

/** @deprecated use apiCall */
export const apiFetch = apiCall;
