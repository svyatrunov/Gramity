import { formatRelativeTime } from "../../config";
import { executionStatusBadge, StatusBadge } from "../../components/StatusBadge";
import type { ExecutionInfo } from "../../api/portfolio";

export function ExecutionsList({ executions }: { executions?: ExecutionInfo[] }) {
  const list = (executions ?? []).slice(0, 5);

  if (list.length === 0) {
    return (
      <section className="g-card g-section">
        <div className="g-section-label">Последние циклы</div>
        <p className="g-hint">Пока нет циклов</p>
      </section>
    );
  }

  return (
    <section className="g-card g-section">
      <div className="g-section-label">Последние циклы</div>
      {list.map((e, i) => {
        const date = formatRelativeTime(e.executed_at);
        const tx = e.tx_swap;
        const txShort = tx ? `${tx.slice(0, 6)}…${tx.slice(-4)}` : null;

        return (
          <div
            key={i}
            className="g-row"
            style={i === 0 ? { borderTop: "none", paddingTop: 0 } : undefined}
          >
            <span>{date}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <StatusBadge status={executionStatusBadge(e.status)} label={e.status ?? "—"} />
              {e.usdt_spent != null ? `$${e.usdt_spent}` : "—"}
              {txShort && (
                <a
                  href={`https://tonviewer.com/transaction/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="g-link"
                  style={{ fontSize: 11 }}
                >
                  {txShort}
                </a>
              )}
            </span>
          </div>
        );
      })}
    </section>
  );
}
