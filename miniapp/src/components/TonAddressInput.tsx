import React, { useState } from "react";
import { isValidTonAddress } from "../config";

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--tg-theme-hint-color, #ccc)",
  background: "var(--tg-theme-bg-color, #fff)",
  color: "var(--tg-theme-text-color, #000)",
  fontSize: 14,
  fontFamily: "ui-monospace, monospace",
};

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
    <div>
      <input
        style={{
          ...INPUT,
          borderColor: invalid || error ? "#c0392b" : undefined,
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
        <div style={{ fontSize: 12, color: "#c0392b", marginTop: 4 }}>
          {error ?? "Неверный формат TON-адреса (UQ… или EQ…, 48 символов)"}
        </div>
      )}
    </div>
  );
}

export function validateTonAddressValue(value: string): boolean {
  return isValidTonAddress(value);
}
