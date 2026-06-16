import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TonConnectUIProvider, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { createPlan } from "../../api/plans";
import { ApiError } from "../../api/client";
import { MANIFEST_URL, validateAmountUsdt, validateFrequency } from "../../config";
import { TonAddressInput, validateTonAddressValue } from "../../components/TonAddressInput";
import { ActionButton } from "../../styles";
import type { OnboardingPlanResult } from "./index";
import type { StrategyFormState } from "./Step1Strategy";

function Step2Inner({
  strategy,
  tonAddress,
  onAddressChange,
  onSuccess,
}: {
  strategy: StrategyFormState;
  tonAddress: string;
  onAddressChange: (v: string) => void;
  onSuccess: (result: OnboardingPlanResult) => void;
}) {
  const navigate = useNavigate();
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [walletConnected, setWalletConnected] = useState(false);

  useEffect(() => {
    if (wallet?.account.address) {
      onAddressChange(wallet.account.address);
      setWalletConnected(true);
    }
  }, [wallet, onAddressChange]);

  const valid = validateTonAddressValue(tonAddress);

  const handleConfirm = async () => {
    if (!valid) return;

    const amount = parseFloat(strategy.amount_usdt);
    if (
      !validateAmountUsdt(amount, strategy.demo_mode) ||
      !validateFrequency(strategy.frequency, strategy.demo_mode)
    ) {
      setInlineError("Проверьте сумму и частоту на шаге 1");
      return;
    }

    setLoading(true);
    setInlineError(null);
    try {
      const res = await createPlan({
        ton_address: tonAddress,
        amount_usdt: amount,
        frequency: strategy.frequency,
        strategy_mode: strategy.strategy_mode,
        demo_mode: strategy.demo_mode,
      });

      onSuccess({
        plan_id: res.plan_id,
        agent_wallet_address: res.agent_wallet_address,
        deposit_address: res.deposit_address ?? res.agent_wallet_address,
        amount_usdt: amount,
        economics_hint: res.economics_hint ?? undefined,
      });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          setInlineError("Адрес уже задан, перенаправление…");
          setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
          return;
        }
        if (
          e.code === "withdrawal_address_required" ||
          e.code === "Invalid ton_address" ||
          e.code === "Invalid TON withdrawal address"
        ) {
          setInlineError(e.userMessage);
          return;
        }
        setInlineError(e.userMessage);
      } else {
        setInlineError("Что-то пошло не так");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="g-card">
      <div className="g-alert g-alert--warn">
        Этот адрес постоянный и не может быть изменён позже.
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="g-label">Подключить TonConnect</div>
        <ActionButton variant="secondary" onClick={() => tonConnectUI.openModal()}>
          Connect TON Wallet
        </ActionButton>
        {walletConnected && valid && (
          <p className="g-hint" style={{ marginTop: 8, color: "var(--g-success-text)" }}>
            Кошелёк подключён
          </p>
        )}
      </div>

      <div className="g-label">или введите адрес вручную</div>
      <TonAddressInput value={tonAddress} onChange={onAddressChange} />

      {inlineError && (
        <div className="g-alert g-alert--error" style={{ marginTop: 8 }}>
          {inlineError}
        </div>
      )}

      <ActionButton loading={loading} disabled={!valid} onClick={() => void handleConfirm()}>
        Подтвердить
      </ActionButton>
    </section>
  );
}

export function Step2Withdrawal(props: {
  strategy: StrategyFormState;
  tonAddress: string;
  onAddressChange: (v: string) => void;
  onSuccess: (result: OnboardingPlanResult) => void;
}) {
  return (
    <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
      <Step2Inner {...props} />
    </TonConnectUIProvider>
  );
}
