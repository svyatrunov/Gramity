export type StatusKind = "active" | "paused" | "running" | "success" | "failed" | "pending";

const CLASS: Record<StatusKind, string> = {
  active: "g-badge g-badge--active",
  paused: "g-badge g-badge--paused",
  running: "g-badge g-badge--running",
  success: "g-badge g-badge--success",
  failed: "g-badge g-badge--failed",
  pending: "g-badge g-badge--pending",
};

const DEFAULT_LABEL: Record<StatusKind, string> = {
  active: "Активна",
  paused: "Пауза",
  running: "Выполняется",
  success: "OK",
  failed: "Ошибка",
  pending: "…",
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
  return (
    <span className={CLASS[status] ?? CLASS.pending}>
      {pulse && (
        <span
          className="g-badge-dot"
          style={{ animation: pulse ? "pulse-dot 1.5s infinite" : undefined }}
        />
      )}
      {label ?? DEFAULT_LABEL[status]}
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
