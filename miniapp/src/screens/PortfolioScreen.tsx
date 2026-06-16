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
  label: { fontSize: 12, color: "var(--tg-theme-hint-color, #888)", marginBottom: 4 },
  value: { fontSize: 24, fontWeight: 700 },
  sub: { fontSize: 13, color: "var(--tg-theme-hint-color, #888)", marginTop: 2 },
  row: { display: "flex", justifyContent: "space-between", marginBottom: 6 },
};

export function PortfolioScreen() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.portfolio().then(setData).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <div style={{ padding: 16, color: "red" }}>{err}</div>;
  if (!data) return <div style={{ padding: 16 }}>Загрузка...</div>;

  const freq: Record<string, string> = {
    weekly: "еженедельно",
    biweekly: "раз в 2 нед.",
    monthly: "раз в месяц",
    minutely: "каждую минуту",
    hourly: "каждый час",
  };

  const mode: Record<string, string> = {
    full: "Полная (LP + стейк)",
    stake_only: "Только стейкинг",
    accumulate: "Только TON",
  };

  return (
    <div style={S.root}>
      <div style={S.card}>
        <div style={S.label}>Общий баланс</div>
        <div style={S.value}>${data.totalValue.toFixed(2)}</div>
        <div style={S.sub}>
          USDT: ${data.usdtBalance.toFixed(2)} · TON: {data.tonBalance.toFixed(3)}
          {data.lpValue != null && ` · LP: $${data.lpValue.toFixed(2)}`}
        </div>
      </div>

      {data.plan && (
        <div style={S.card}>
          <div style={S.label}>Стратегия</div>
          <div style={S.row}>
            <span>Статус</span>
            <strong>{data.plan.active ? "🟢 Активна" : "⏸ Пауза"}</strong>
          </div>
          <div style={S.row}>
            <span>Режим</span>
            <span>{mode[data.plan.strategy_mode] ?? data.plan.strategy_mode}</span>
          </div>
          <div style={S.row}>
            <span>Цикл</span>
            <span>
              ${data.plan.usdt_amount} {freq[data.plan.frequency] ?? data.plan.frequency}
            </span>
          </div>
          <div style={S.row}>
            <span>Следующий запуск</span>
            <span>
              {new Date(data.plan.next_execution_at).toLocaleDateString("ru-RU")}
            </span>
          </div>
        </div>
      )}

      {data.executions.length > 0 && (
        <div style={S.card}>
          <div style={S.label}>История циклов</div>
          {data.executions.slice(0, 5).map((e, i) => (
            <div key={i} style={S.row}>
              <span>{new Date(e.executed_at).toLocaleDateString("ru-RU")}</span>
              <span>
                {e.usdt_spent != null ? `$${e.usdt_spent}` : "—"} · {e.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
