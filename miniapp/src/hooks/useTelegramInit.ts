import { useEffect, useMemo } from "react";
import { getInitData, getTelegramUser, initTelegram } from "../lib/telegram";

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function useTelegramInit() {
  const user = useMemo((): TelegramUser | null => getTelegramUser(), []);

  useEffect(() => {
    initTelegram();
  }, []);

  return { user, initData: getInitData() };
}
