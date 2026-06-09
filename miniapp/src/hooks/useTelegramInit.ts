import { useEffect, useMemo } from "react";
import { getInitData, getTelegramUser, initTelegram } from "../lib/telegram";

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function useTelegramInit() {
  const user = useMemo((): TelegramUser | null => {
    const unsafe = getTelegramUser();
    if (unsafe) return unsafe;

    const initData = getInitData();
    if (!initData) return null;
    try {
      const params = new URLSearchParams(initData);
      const userParam = params.get("user");
      if (!userParam) return null;
      return JSON.parse(userParam) as TelegramUser;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    initTelegram();
  }, []);

  return { user, initData: getInitData() };
}
