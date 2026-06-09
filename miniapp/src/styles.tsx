import React from "react";

export const S = {
  root: { padding: 16, paddingBottom: 80 } as React.CSSProperties,
  card: {
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  } as React.CSSProperties,
  label: {
    fontSize: 12,
    color: "var(--tg-theme-hint-color, #888)",
    marginBottom: 4,
  } as React.CSSProperties,
  value: { fontSize: 24, fontWeight: 700 } as React.CSSProperties,
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    fontSize: 14,
  } as React.CSSProperties,
  btn: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  } as React.CSSProperties,
  btnSecondary: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "transparent",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
  } as React.CSSProperties,
  btnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  } as React.CSSProperties,
  warn: {
    background: "#fff3cd",
    color: "#856404",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  } as React.CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--tg-theme-hint-color, #888)",
    marginTop: 4,
  } as React.CSSProperties,
  segmented: {
    display: "flex",
    gap: 4,
    background: "var(--tg-theme-bg-color, #fff)",
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  } as React.CSSProperties,
  segment: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 4px",
    borderRadius: 8,
    border: "none",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "var(--tg-theme-button-color, #2481cc)" : "transparent",
    color: active
      ? "var(--tg-theme-button-text-color, #fff)"
      : "var(--tg-theme-text-color, #000)",
  }),
  stepBar: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
  } as React.CSSProperties,
  stepDot: (active: boolean): React.CSSProperties => ({
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: active
      ? "var(--tg-theme-button-color, #2481cc)"
      : "var(--tg-theme-hint-color, #ddd)",
    opacity: active ? 1 : 0.35,
  }),
};

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
        marginRight: 6,
      }}
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  success?: boolean;
  shake?: boolean;
}) {
  const base =
    variant === "secondary"
      ? S.btnSecondary
      : variant === "danger"
        ? { ...S.btn, background: "#c0392b" }
        : S.btn;

  return (
    <button
      type="button"
      style={{
        ...base,
        ...(disabled || loading ? S.btnDisabled : {}),
        ...(success ? { background: "#1e7e34" } : {}),
        animation: shake ? "shake 0.4s ease" : undefined,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
