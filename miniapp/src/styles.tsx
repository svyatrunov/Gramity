import React from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="g-page-header">
      <div>
        <h1 className="g-page-title">{title}</h1>
        {subtitle ? <p className="g-page-subtitle">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** @deprecated Prefer CSS classes from app.css (g-*). Kept for gradual migration. */
export const S = {
  root: {} as React.CSSProperties,
  card: {} as React.CSSProperties,
  label: {} as React.CSSProperties,
  value: {} as React.CSSProperties,
  row: {} as React.CSSProperties,
  btn: {} as React.CSSProperties,
  btnSecondary: {} as React.CSSProperties,
  btnDisabled: {} as React.CSSProperties,
  warn: {} as React.CSSProperties,
  hint: {} as React.CSSProperties,
  segmented: {} as React.CSSProperties,
  segment: (_active: boolean) => ({} as React.CSSProperties),
  stepBar: {} as React.CSSProperties,
  stepDot: (_active: boolean) => ({} as React.CSSProperties),
};

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={["g-page", "g-enter", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
        verticalAlign: "middle",
      }}
      aria-hidden
    />
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  loading,
  variant = "primary",
  success,
  shake,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  success?: boolean;
  shake?: boolean;
  className?: string;
}) {
  const classes = [
    variant === "ghost" ? "g-btn g-btn--ghost" : "g-btn",
    variant === "secondary" ? "g-btn--secondary" : "",
    variant === "danger" ? "g-btn--danger" : "",
    success ? "g-btn--success" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      style={shake ? { animation: "shake 0.4s ease" } : undefined}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
