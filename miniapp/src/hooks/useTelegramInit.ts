import { useEffect, useMemo } from "react";
import { getInitData } from "../api/client";

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function useTelegramInit() {
  const user = useMemo((): TelegramUser | null => {
    const unsafe = window.Telegram?.WebApp?.initDataUnsafe?.user;
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
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    tg?.setBackgroundColor?.("#000000");
  }, []);

  return { user, initData: getInitData() };
}
