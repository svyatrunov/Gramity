import React, { useEffect, useState } from "react";
import { api, type PopularToken } from "../api";

const POPULAR_TOKENS: PopularToken[] = [
  { symbol: "TON", address: "ton", price_usd: null, decimals: 9 },
  { symbol: "tsTON", address: "EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav", price_usd: null, decimals: 9 },
  { symbol: "STON", address: "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmn32ehfw", price_usd: null, decimals: 9 },
  { symbol: "NOT", address: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT", price_usd: null, decimals: 9 },
];

const S: Record<string, React.CSSProperties> = {
  root: { padding: 16 },
  token: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 0",
    borderBottom: "1px solid var(--tg-theme-hint-color, #eee)",
    cursor: "pointer",
  },
  btn: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 13,
    cursor: "pointer",
  },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: 15,
    width: 90,
    marginRight: 8,
  },
};

export function BuyScreen() {
  const [tokens, setTokens] = useState<PopularToken[]>(POPULAR_TOKENS);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    api.popularTokens().then(setTokens).catch(() => {});
  }, []);

  const buy = async (token: PopularToken) => {
    const amt = parseFloat(amounts[token.symbol] ?? "");
    if (isNaN(amt) || amt <= 0) return;
    setLoading(token.symbol);
    try {
      await api.buyToken(token.address, amt);
      setMsgs((m) => ({ ...m, [token.symbol]: `✅ Покупка отправлена` }));
    } catch (e: unknown) {
      setMsgs((m) => ({ ...m, [token.symbol]: `❌ ${(e as Error).message}` }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={S.root}>
      <h3 style={{ marginBottom: 4 }}>Купить токены</h3>
      <p style={{ fontSize: 12, color: "var(--tg-theme-hint-color,#888)", marginBottom: 12 }}>
        Только верифицированные TON токены
      </p>

      {tokens.map((t) => (
        <div key={t.symbol}>
          <div style={S.token}>
            <div>
              <strong>{t.symbol}</strong>
              {t.price_usd != null && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--tg-theme-hint-color,#888)" }}>
                  ${t.price_usd.toFixed(4)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <input
                style={S.input}
                type="number"
                placeholder="USDT"
                value={amounts[t.symbol] ?? ""}
                onChange={(e) =>
                  setAmounts((a) => ({ ...a, [t.symbol]: e.target.value }))
                }
              />
              <button
                style={S.btn}
                onClick={() => buy(t)}
                disabled={loading === t.symbol}
              >
                {loading === t.symbol ? "..." : "Купить"}
              </button>
            </div>
          </div>
          {msgs[t.symbol] && (
            <div style={{ fontSize: 12, padding: "4px 0 8px" }}>{msgs[t.symbol]}</div>
          )}
        </div>
      ))}
    </div>
  );
}
