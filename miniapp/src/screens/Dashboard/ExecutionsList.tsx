import { formatRelativeTime } from "../../config";
import { executionStatusBadge, StatusBadge } from "../../components/StatusBadge";
import type { ExecutionInfo } from "../../api/portfolio";
import { S } from "../../styles";

export function ExecutionsList({ executions }: { executions?: ExecutionInfo[] }) {
  const list = (executions ?? []).slice(0, 5);

  if (list.length === 0) {
    return (
      <div style={S.card}>
        <div style={S.label}>Последние циклы</div>
        <p style={S.hint}>Пока нет циклов</p>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 12 }}>Последние циклы</div>
      {list.map((e, i) => {
        const date = formatRelativeTime(e.executed_at);
        const tx = e.tx_swap;
        const txShort = tx ? `${tx.slice(0, 6)}…${tx.slice(-4)}` : null;

        return (
          <div
            key={i}
            style={{
              ...S.row,
              borderBottom:
                i < list.length - 1
                  ? "1px solid var(--tg-theme-hint-color, #eee)"
                  : undefined,
              paddingBottom: 8,
            }}
          >
            <span style={{ fontSize: 13 }}>{date}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusBadge
                status={executionStatusBadge(e.status)}
                label={e.status ?? "—"}
              />
              {e.usdt_spent != null ? `$${e.usdt_spent}` : "—"}
              {txShort && (
                <a
                  href={`https://tonviewer.com/transaction/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 11,
                    color: "var(--tg-theme-link-color, #2481cc)",
                  }}
                >
                  {txShort}
                </a>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
