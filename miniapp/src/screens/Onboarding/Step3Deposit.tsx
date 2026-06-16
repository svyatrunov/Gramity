import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { fetchOnboardingWallet } from "../../api/onboarding";
import { createMiraContext } from "../../api/mira";
import { ApiError } from "../../api/client";
import { useToast } from "../../components/Toast";
import type { EconomicsHint } from "../../api/plans";
import { ActionButton } from "../../styles";

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
    <section className="g-card">
      {showBack && onBack && (
        <button type="button" className="g-btn g-btn--ghost" onClick={onBack} style={{ marginBottom: 12 }}>
          Назад
        </button>
      )}

      {economicsHint && (
        <div className="g-alert" style={{ color: "var(--g-text)", borderColor: "var(--g-border)" }}>
          Gas overhead ~{economicsHint.gas_overhead_pct_estimate ?? "?"}%.
          Рекомендуется: {economicsHint.recommended_frequency ?? "weekly"}
        </div>
      )}

      <div className="g-label">Отправьте USDT (TON) на адрес агента</div>
      {amountUsdt > 0 && (
        <p className="g-hint" style={{ marginBottom: 12 }}>
          Минимум: баланс должен покрыть хотя бы 1 цикл (${amountUsdt.toFixed(2)})
        </p>
      )}

      {depositAddress && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <QRCodeSVG value={depositAddress} size={180} level="M" />
        </div>
      )}

      <div className="g-mono-box">{depositAddress || "—"}</div>

      <ActionButton variant="secondary" onClick={copyAddress}>
        {copied ? "Скопировано" : "Скопировать адрес"}
      </ActionButton>

      <div className="g-row" style={{ marginTop: 8 }}>
        <span>USDT на кошельке</span>
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>${usdtBalance.toFixed(2)}</strong>
      </div>

      {deposited && (
        <div className="g-alert g-alert--success" style={{ marginTop: 12, textAlign: "center" }}>
          Депозит обнаружен
        </div>
      )}

      {deposited && (
        <ActionButton onClick={onGoDashboard} success>
          Открыть портфель
        </ActionButton>
      )}

      <ActionButton variant="secondary" loading={miraLoading} onClick={() => void openMira()}>
        Спросить Mira
      </ActionButton>
    </section>
  );
}
