export type StatusKind = "active" | "paused" | "running" | "success" | "failed" | "pending";

const STYLES: Record<StatusKind, { bg: string; color: string; label: string }> = {
  active: { bg: "#e8f8ef", color: "#1e7e34", label: "Активна" },
  paused: { bg: "#fff3cd", color: "#856404", label: "Пауза" },
  running: { bg: "#e7f1ff", color: "#2481cc", label: "Выполняется" },
  success: { bg: "#e8f8ef", color: "#1e7e34", label: "OK" },
  failed: { bg: "#fde8e8", color: "#c0392b", label: "Ошибка" },
  pending: { bg: "#f0f0f0", color: "#666", label: "…" },
};

export function StatusBadge({
  status,
  label,
  pulse,
}: {
  status: StatusKind;
  label?: string;
  pulse?: boolean;
}) {
  const s = STYLES[status] ?? STYLES.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        animation: pulse ? "pulse 1.5s infinite" : undefined,
      }}
    >
      {label ?? s.label}
    </span>
  );
}

export function executionStatusBadge(status: string | undefined): StatusKind {
  if (!status) return "pending";
  if (status === "success") return "success";
  if (status === "failed" || status === "error") return "failed";
  if (status === "running" || status === "in_progress") return "running";
  return "pending";
}
