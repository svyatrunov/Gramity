import { useEffect, useState } from "react";
import { pausePlan, resumePlan, runNow, withdrawUsdt } from "../../api/actions";
import { ApiError } from "../../api/client";
import { useToast } from "../../components/Toast";
import type { PortfolioResponse } from "../../api/portfolio";
import { ActionButton } from "../../styles";
import { AmountInput } from "../../components/AmountInput";

export function ActionsBar({
  data,
  onRefresh,
  onOptimisticActive,
}: {
  data: PortfolioResponse | null;
  onRefresh: () => void;
  onOptimisticActive: (active: boolean) => void;
}) {
  const { showToast } = useToast();
  const plan = data?.plan;
  const usdtBalance = data?.usdtBalance ?? 0;

  const [pauseLoading, setPauseLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runCooldown, setRunCooldown] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  const isActive = plan?.active ?? false;
  const canRunNow =
    isActive &&
    (plan?.withdrawal_address_set ?? false) &&
    !plan?.is_running &&
    !runCooldown;

  useEffect(() => {
    if (!runCooldown) return;
    const id = setTimeout(() => setRunCooldown(false), 10_000);
    return () => clearTimeout(id);
  }, [runCooldown]);

  const handleApiError = (e: unknown) => {
    if (e instanceof ApiError) {
      showToast(e.userMessage, "error");
    } else {
      showToast("Что-то пошло не так", "error");
    }
  };

  const togglePause = async () => {
    setPauseLoading(true);
    const nextActive = !isActive;
    onOptimisticActive(nextActive);
    try {
      if (isActive) {
        await pausePlan();
      } else {
        await resumePlan();
      }
      onRefresh();
    } catch (e) {
      onOptimisticActive(isActive);
      handleApiError(e);
    } finally {
      setPauseLoading(false);
    }
  };

  const handleRunNow = async () => {
    setRunLoading(true);
    setRunCooldown(true);
    try {
      await runNow(1);
      showToast("Цикл запущен. Проверьте Telegram.", "success");
    } catch (e) {
      setRunCooldown(false);
      handleApiError(e);
    } finally {
      setRunLoading(false);
    }
  };

  const handleWithdrawUsdt = async () => {
    const amount = parseFloat(withdrawAmount);
    if (Number.isNaN(amount) || !Number.isFinite(amount) || amount <= 0) {
      showToast("Укажите сумму больше 0", "error");
      return;
    }
    if (amount > usdtBalance) {
      showToast("Сумма превышает баланс", "error");
      return;
    }
    setWithdrawLoading(true);
    try {
      await withdrawUsdt(amount);
      showToast(`Выведено $${amount.toFixed(2)} USDT`, "success");
      setWithdrawOpen(false);
      setWithdrawAmount("");
      onRefresh();
    } catch (e) {
      handleApiError(e);
    } finally {
      setWithdrawLoading(false);
    }
  };

  return (
    <section className="g-card g-section">
      <ActionButton loading={pauseLoading} onClick={() => void togglePause()}>
        {isActive ? "Поставить на паузу" : "Возобновить"}
      </ActionButton>

      {isActive && (plan?.withdrawal_address_set ?? false) && !plan?.is_running && (
        <ActionButton
          loading={runLoading}
          disabled={!canRunNow}
          variant="secondary"
          onClick={() => void handleRunNow()}
        >
          Запустить сейчас
        </ActionButton>
      )}

      <ActionButton variant="secondary" onClick={() => setWithdrawOpen(true)}>
        Вывести USDT
      </ActionButton>

      {withdrawOpen && (
        <div className="g-sheet-backdrop" onClick={() => setWithdrawOpen(false)}>
          <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 className="g-sheet-title">Вывод USDT</h3>
            <AmountInput
              label={`Сумма (макс. $${usdtBalance.toFixed(2)})`}
              value={withdrawAmount}
              onChange={setWithdrawAmount}
              max={usdtBalance}
            />
            <ActionButton loading={withdrawLoading} onClick={() => void handleWithdrawUsdt()}>
              Подтвердить
            </ActionButton>
          </div>
        </div>
      )}
    </section>
  );
}
