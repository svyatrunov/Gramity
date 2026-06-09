import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOnboardingWallet } from "../../api/onboarding";
import { createMiraContext } from "../../api/mira";
import { ApiError } from "../../api/client";
import { useToast } from "../../components/Toast";
import type { EconomicsHint } from "../../api/plans";
import { ActionButton, S } from "../../styles";

export function Step3Deposit({
  depositAddress,
  amountUsdt,
  onGoDashboard,
  showBack,
  onBack,
  economicsHint,
}: {
  depositAddress: string;
  amountUsdt: number;
  onGoDashboard: () => void;
  showBack?: boolean;
  onBack?: () => void;
  economicsHint?: EconomicsHint | null;
}) {
  const { showToast } = useToast();
  const [usdtBalance, setUsdtBalance] = useState(0);
  const [copied, setCopied] = useState(false);
  const [miraLoading, setMiraLoading] = useState(false);

  useEffect(() => {
    if (!depositAddress) return;

    const poll = async () => {
      try {
        const w = await fetchOnboardingWallet(true);
        setUsdtBalance(w.usdt_balance ?? 0);
      } catch {
        /* retry on next tick */
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => clearInterval(id);
  }, [depositAddress]);

  const copyAddress = () => {
    if (!depositAddress) return;
    void navigator.clipboard.writeText(depositAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openMira = async () => {
    setMiraLoading(true);
    try {
      const res = await createMiraContext("onboarding");
      if (res.mira_deeplink) {
        window.Telegram?.WebApp?.openTelegramLink(res.mira_deeplink);
      } else {
        showToast("Mira недоступна", "error");
      }
    } catch (e) {
      showToast(
        e instanceof ApiError ? e.userMessage : "Что-то пошло не так",
        "error"
      );
    } finally {
      setMiraLoading(false);
    }
  };

  const deposited = usdtBalance > 0;

  return (
    <div style={S.card}>
      {showBack && onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            border: "none",
            background: "none",
            color: "var(--tg-theme-link-color, #2481cc)",
            fontSize: 14,
            marginBottom: 12,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ← Назад
        </button>
      )}

      {economicsHint && (
        <div
          style={{
            fontSize: 13,
            padding: 10,
            borderRadius: 8,
            background: "var(--tg-theme-bg-color, #fff)",
            marginBottom: 12,
          }}
        >
          Gas overhead ~{economicsHint.gas_overhead_pct_estimate ?? "?"}%.
          Рекомендуется: {economicsHint.recommended_frequency ?? "weekly"}
        </div>
      )}

      <div style={S.label}>Отправьте USDT (TON) на адрес агента</div>
      {amountUsdt > 0 && (
        <p style={{ ...S.hint, marginBottom: 12 }}>
          Минимум: баланс должен покрыть хотя бы 1 цикл (${amountUsdt.toFixed(2)})
        </p>
      )}

      {depositAddress && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <QRCodeSVG value={depositAddress} size={180} level="M" />
        </div>
      )}

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: "var(--tg-theme-bg-color, #fff)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          wordBreak: "break-all",
          marginBottom: 12,
        }}
      >
        {depositAddress || "—"}
      </div>

      <ActionButton variant="secondary" onClick={copyAddress}>
        {copied ? "✓ Скопировано" : "Скопировать адрес"}
      </ActionButton>

      <div style={{ ...S.row, marginTop: 16 }}>
        <span>USDT на кошельке</span>
        <strong>${usdtBalance.toFixed(2)}</strong>
      </div>

      {deposited && (
        <div
          style={{
            background: "#e8f8ef",
            color: "#1e7e34",
            padding: 12,
            borderRadius: 8,
            marginTop: 12,
            textAlign: "center",
          }}
        >
          ✅ Депозит обнаружен
        </div>
      )}

      {deposited && (
        <ActionButton onClick={onGoDashboard} success>
          Открыть Dashboard
        </ActionButton>
      )}

      <ActionButton
        variant="secondary"
        loading={miraLoading}
        onClick={() => void openMira()}
      >
        🤖 Ask Mira
      </ActionButton>
    </div>
  );
}
