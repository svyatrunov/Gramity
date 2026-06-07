import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useEffect } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        sendData: (data: string) => void;
        close: () => void;
        ready: () => void;
        initData: string;
      };
    };
  }
}

export function ConnectWallet() {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
  }, []);

  useEffect(() => {
    if (wallet) {
      const address = wallet.account.address;
      const payload = JSON.stringify({
        type: "wallet_connected",
        address: address,
        walletName: wallet.device.appName,
      });

      setTimeout(() => {
        window.Telegram?.WebApp?.sendData(payload);
        window.Telegram?.WebApp?.close();
      }, 1500);
    }
  }, [wallet]);

  // Suppress unused variable warning
  void tonConnectUI;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0E0E12",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 16 }}>💎</div>
      <h1
        style={{ color: "#fff", fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}
      >
        Gramity
      </h1>
      <p
        style={{
          color: "#8B8B9B",
          fontSize: 14,
          textAlign: "center",
          marginBottom: 40,
        }}
      >
        Подключи кошелёк, чтобы получать выведенные средства
      </p>

      {!wallet ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <TonConnectButton />
          <p style={{ color: "#8B8B9B", fontSize: 12, textAlign: "center" }}>
            Поддерживаются: Tonkeeper, MyTonWallet и другие
          </p>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <p style={{ color: "#4ADE80", fontSize: 18, fontWeight: 600 }}>
            Кошелёк подключён
          </p>
          <p style={{ color: "#8B8B9B", fontSize: 12, marginTop: 8 }}>
            Закрываю...
          </p>
        </div>
      )}

      <p
        style={{
          color: "#8B8B9B",
          fontSize: 11,
          marginTop: 48,
          textAlign: "center",
        }}
      >
        Gramity не хранит приватные ключи.
        <br />
        Только адрес для получения средств.
      </p>
    </div>
  );
}
