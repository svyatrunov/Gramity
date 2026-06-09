export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        setBackgroundColor?: (color: string) => void;
        close: () => void;
        sendData: (data: string) => void;
        openTelegramLink: (url: string) => void;
        colorScheme?: "light" | "dark";
        themeParams?: Record<string, string>;
      };
    };
  }
}
