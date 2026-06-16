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
    <div style={{ marginBottom: 12 }}>
      {label && <div className="g-label">{label}</div>}
      <div style={{ position: "relative" }}>
        {prefix && (
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--g-text-muted)",
              fontWeight: 600,
            }}
          >
            {prefix}
          </span>
        )}
        <input
          className="g-input"
          style={{
            marginBottom: 0,
            paddingLeft: prefix ? 28 : undefined,
            fontVariantNumeric: "tabular-nums",
          }}
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
