import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Step1Strategy, type StrategyFormState } from "./Step1Strategy";
import { Step2Withdrawal } from "./Step2Withdrawal";
import { Step3Deposit } from "./Step3Deposit";
import type { EconomicsHint } from "../../api/plans";
import { S } from "../../styles";

export interface OnboardingPlanResult {
  plan_id?: string;
  agent_wallet_address?: string;
  deposit_address?: string;
  amount_usdt?: number;
  economics_hint?: EconomicsHint;
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [strategy, setStrategy] = useState<StrategyFormState>({
    amount_usdt: "10",
    frequency: "weekly",
    strategy_mode: "full",
    demo_mode: false,
  });
  const [tonAddress, setTonAddress] = useState("");
  const [planResult, setPlanResult] = useState<OnboardingPlanResult | null>(null);

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const blockBack = () => {
      if (step >= 2) {
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("popstate", blockBack);
    return () => window.removeEventListener("popstate", blockBack);
  }, [step]);

  return (
    <div style={S.root}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Настройка стратегии</h1>
      <p style={{ ...S.hint, marginBottom: 16 }}>Шаг {step} из 3</p>

      <div style={S.stepBar}>
        {[1, 2, 3].map((n) => (
          <div key={n} style={S.stepDot(step >= n)} />
        ))}
      </div>

      {step === 1 && (
        <Step1Strategy
          value={strategy}
          onChange={setStrategy}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2Withdrawal
          strategy={strategy}
          tonAddress={tonAddress}
          onAddressChange={setTonAddress}
          onSuccess={(result) => {
            setPlanResult(result);
            setStep(3);
          }}
        />
      )}

      {step === 3 && planResult && (
        <Step3Deposit
          depositAddress={planResult.deposit_address ?? planResult.agent_wallet_address ?? ""}
          amountUsdt={Number(strategy.amount_usdt)}
          economicsHint={planResult.economics_hint}
          onGoDashboard={() => navigate("/dashboard", { replace: true })}
        />
      )}
    </div>
  );
}
