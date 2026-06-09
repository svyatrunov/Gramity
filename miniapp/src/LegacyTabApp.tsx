import React, { useState } from "react";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { WalletsScreen } from "./screens/WalletsScreen";
import { WithdrawScreen } from "./screens/WithdrawScreen";
import { BuyScreen } from "./screens/BuyScreen";

type Screen = "portfolio" | "wallets" | "withdraw" | "buy";

const TAB_STYLE: React.CSSProperties = {
  display: "flex",
  borderTop: "1px solid var(--tg-theme-hint-color, #ccc)",
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "var(--tg-theme-bg-color, #fff)",
};

const TAB_BTN: React.CSSProperties = {
  flex: 1,
  padding: "10px 4px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  fontSize: 11,
  color: "var(--tg-theme-hint-color, #999)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
};

/** Legacy tab navigation — preserved for backward compatibility */
export function LegacyTabApp() {
  const [screen, setScreen] = useState<Screen>("portfolio");

  const tabs: Array<{ id: Screen; label: string; emoji: string }> = [
    { id: "portfolio", label: "Портфель", emoji: "📊" },
    { id: "wallets", label: "Кошельки", emoji: "👛" },
    { id: "withdraw", label: "Вывод", emoji: "💸" },
    { id: "buy", label: "Купить", emoji: "🛒" },
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      {screen === "portfolio" && <PortfolioScreen />}
      {screen === "wallets" && <WalletsScreen />}
      {screen === "withdraw" && <WithdrawScreen />}
      {screen === "buy" && <BuyScreen />}

      <div style={TAB_STYLE}>
        {tabs.map((t) => (
          <button
            key={t.id}
            style={{
              ...TAB_BTN,
              color:
                screen === t.id
                  ? "var(--tg-theme-link-color, #2481cc)"
                  : "var(--tg-theme-hint-color, #999)",
            }}
            onClick={() => setScreen(t.id)}
          >
            <span style={{ fontSize: 20 }}>{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
