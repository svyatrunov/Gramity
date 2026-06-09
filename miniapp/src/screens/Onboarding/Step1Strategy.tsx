import { useEffect, useState } from "react";
import {
  FREQUENCY_OPTIONS,
  QUICK_FREQUENCY_OPTIONS,
  STRATEGY_MODE_OPTIONS,
  validateAmountUsdt,
  validateFrequency,
  type StrategyMode,
} from "../../config";
import { fetchDcaLimits } from "../../api/plans";
import { AmountInput } from "../../components/AmountInput";
import { ActionButton, S } from "../../styles";

export interface StrategyFormState {
  amount_usdt: string;
  frequency: string;
  strategy_mode: StrategyMode;
  demo_mode: boolean;
}

export function Step1Strategy({
  value,
  onChange,
  onNext,
}: {
  value: StrategyFormState;
  onChange: (v: StrategyFormState) => void;
  onNext: () => void;
}) {
  const [minUsdt, setMinUsdt] = useState(5);
  const [quickMin, setQuickMin] = useState(2);

  useEffect(() => {
    fetchDcaLimits()
      .then((l) => {
        if (l.min_dca_usdt != null) setMinUsdt(l.min_dca_usdt);
        if (l.quick_min_usdt != null) setQuickMin(l.quick_min_usdt);
        else if (l.demo_min_usdt != null) setQuickMin(l.demo_min_usdt);
      })
      .catch(() => {
        /* defaults */
      });
  }, []);

  const min = value.demo_mode ? quickMin : minUsdt;
  const amount = parseFloat(value.amount_usdt);
  const amountOk = validateAmountUsdt(amount, value.demo_mode);
  const freqOk = validateFrequency(value.frequency, value.demo_mode);

  const freqOptions = value.demo_mode ? QUICK_FREQUENCY_OPTIONS : FREQUENCY_OPTIONS;

  const handleNext = () => {
    if (!amountOk || !freqOk) return;
    onNext();
  };

  return (
    <div style={S.card}>
      <AmountInput
        label={`Сумма за цикл (мин. $${min}, макс. $10 000)`}
        value={value.amount_usdt}
        onChange={(v) => onChange({ ...value, amount_usdt: v })}
        max={10_000}
      />

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={value.demo_mode}
          onChange={(e) => {
            const demo = e.target.checked;
            onChange({
              ...value,
              demo_mode: demo,
              frequency: demo ? "10s" : "weekly",
            });
          }}
        />
        Quick Start (демо, 2 цикла)
      </label>

      <div style={S.label}>Частота</div>
      <select
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--tg-theme-hint-color, #ccc)",
          background: "var(--tg-theme-bg-color, #fff)",
          color: "var(--tg-theme-text-color, #000)",
          fontSize: 15,
          marginBottom: 12,
        }}
        value={value.frequency}
        onChange={(e) => onChange({ ...value, frequency: e.target.value })}
      >
        {freqOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div style={S.label}>Режим стратегии</div>
      <div style={S.segmented}>
        {STRATEGY_MODE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            style={S.segment(value.strategy_mode === o.value)}
            onClick={() => onChange({ ...value, strategy_mode: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <ActionButton disabled={!amountOk || !freqOk} onClick={handleNext}>
        Далее →
      </ActionButton>
    </div>
  );
}
