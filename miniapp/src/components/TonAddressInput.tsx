import { useState } from "react";
import { isValidTonAddress } from "../config";

export function TonAddressInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.length > 0 && !isValidTonAddress(value);

  return (
    <div style={{ marginBottom: 12 }}>
      <input
        className="g-input"
        style={{
          marginBottom: 0,
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 14,
          borderColor: invalid || error ? "var(--g-error-text)" : undefined,
        }}
        placeholder="UQ… или EQ… (48 символов)"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        spellCheck={false}
        autoComplete="off"
      />
      {(invalid || error) && (
        <div style={{ fontSize: 12, color: "var(--g-error-text)", marginTop: 4 }}>
          {error ?? "Неверный формат TON-адреса (UQ… или EQ…, 48 символов)"}
        </div>
      )}
    </div>
  );
}

export function validateTonAddressValue(value: string): boolean {
  return isValidTonAddress(value);
}
