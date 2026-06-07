import React, { useEffect, useState } from "react";
import { api, type Portfolio } from "../api";

const S: Record<string, React.CSSProperties> = {
  root: { padding: 16 },
  card: {
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  btn: {
    width: "100%",
    padding: "13px 0",
    borderRadius: 10,
    border: "none",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 15,
    cursor: "pointer",
    marginBottom: 10,
  },
  btnRed: {
    background: "#e53935",
  },
  fee: { fontSize: 12, color: "var(--tg-theme-hint-color, #888)", marginBottom: 16 },
  success: { color: "green", marginTop: 8 },
  error: { color: "red", marginTop: 8 },
};

export function WithdrawScreen() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [gas, setGas] = useState<{ ton: number; usd: number | null } | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.portfolio().then(setPortfolio).catch(console.error);
    api.gasEstimate("transfer").then(setGas).catch(console.error);
  }, []);

  const withdrawUsdt = async () => {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const r = await api.withdrawUsdt();
      setMsg(`✅ Отправлено $${r.sent.toFixed(2)} USDT`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const withdrawAll = async () => {
    if (!confirm("Выйти из LP и анстейкнуть tsTON? Это займёт несколько минут.")) return;
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const r = await api.withdrawAll();
      setMsg(`✅ Отправлено: ${r.summary.join(", ")}`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.root}>
      <h3 style={{ marginBottom: 12 }}>Вывод средств</h3>

      {portfolio && (
        <div style={S.card}>
          <div>Свободный USDT: <strong>${portfolio.usdtBalance.toFixed(2)}</strong></div>
          <div>TON в кошельке: <strong>{portfolio.tonBalance.toFixed(3)} TON</strong></div>
          {portfolio.lpValue != null && (
            <div>LP позиция: <strong>${portfolio.lpValue.toFixed(2)}</strong></div>
          )}
        </div>
      )}

      {gas && (
        <div style={S.fee}>
          Комиссия сети: ~{gas.ton.toFixed(3)} TON
          {gas.usd != null && ` (~$${gas.usd.toFixed(3)})`}
        </div>
      )}

      <button style={S.btn} onClick={withdrawUsdt} disabled={loading}>
        {loading ? "..." : "💵 Вывести USDT"}
      </button>

      <button
        style={{ ...S.btn, ...S.btnRed }}
        onClick={withdrawAll}
        disabled={loading}
      >
        {loading ? "..." : "📤 Вывести всё (LP + tsTON + USDT)"}
      </button>

      {msg && <div style={S.success}>{msg}</div>}
      {error && <div style={S.error}>{error}</div>}
    </div>
  );
}
