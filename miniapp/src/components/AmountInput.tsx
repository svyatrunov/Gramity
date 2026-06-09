import React from "react";

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--tg-theme-hint-color, #ccc)",
  background: "var(--tg-theme-bg-color, #fff)",
  color: "var(--tg-theme-text-color, #000)",
  fontSize: 15,
  marginBottom: 4,
};

export function AmountInput({
  value,
  onChange,
  min = 0,
  max,
  label,
  prefix = "$",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  label?: string;
  prefix?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: 12,
            color: "var(--tg-theme-hint-color, #888)",
            marginBottom: 6,
          }}
        >
          {label}
        </div>
      )}
      <div style={{ position: "relative" }}>
        {prefix && (
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--tg-theme-hint-color, #888)",
            }}
          >
            {prefix}
          </span>
        )}
        <input
          style={{ ...INPUT, paddingLeft: prefix ? 28 : 12 }}
          type="number"
          min={min}
          max={max}
          step="any"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
